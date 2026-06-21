from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import hashlib
import json
from .calculations import supertrend
from .config import ScannerConfig, SuperTrendConfig, WatchlistRow
from .market_data import CsvMarketDataProvider, PriceBar
from .storage import atomic_write_json, read_json
SUPER_ID = 'daily-supertrend'
SMA_ID = 'nasdaq-sma200-3x'

def event_id(strategy_id: str, event_type: str, date_text: str, ticker: str) -> str:
    material = f'{strategy_id}|{event_type}|{date_text}|{ticker}'.encode()
    return f'{strategy_id}:{hashlib.sha256(material).hexdigest()[:24]}'

def _empty_strategy(strategy_id: str, name: str, enabled: bool, summary: str, parameters: dict[str, Any], configured: bool=True) -> dict[str, Any]:
    return {'strategyId': strategy_id, 'name': name, 'enabled': enabled, 'configured': configured, 'status': 'disabled' if not enabled else 'awaiting_data', 'ruleSummary': summary, 'parameters': parameters, 'currentState': 'disabled' if not enabled else 'awaiting_data', 'modelValue': None, 'returnPercent': None, 'drawdownPercent': None, 'exposurePercent': 0, 'equitySnapshots': [], 'virtualPositions': [], 'closedVirtualTrades': [], 'events': [], 'latestEvent': None, 'dataFreshness': None}

class ScannerEngine:

    def __init__(self, config: ScannerConfig, provider: CsvMarketDataProvider, state_dir: Path, output_dir: Path) -> None:
        self.config = config
        self.provider = provider
        self.state_dir = state_dir
        self.output_dir = output_dir
        self.state_path = state_dir / 'model_state_v1.json'
        self.state: dict[str, Any] = read_json(self.state_path, {'version': 1, 'strategies': {}, 'eventIds': []})

    def _known_event_ids(self) -> set[str]:
        return set(self.state.get('eventIds', []))

    def _persist(self, snapshot: dict[str, Any]) -> None:
        self.state['eventIds'] = sorted({event['eventId'] for strategy in snapshot['strategies'] for event in strategy['events']} | self._known_event_ids())[-10000:]
        atomic_write_json(self.state_path, self.state)
        atomic_write_json(self.output_dir / 'multi_strategy_v1.json', snapshot)

    def scan(self, rebuild_history: bool=False) -> dict[str, Any]:
        if rebuild_history:
            self.state = {'version': 1, 'strategies': {}, 'eventIds': []}
        generated_at = datetime.now(timezone.utc).isoformat()
        errors: list[dict[str, str]] = []
        strategies: list[dict[str, Any]] = []
        for builder in (self._scan_supertrend, self._scan_sma):
            try:
                strategies.append(builder())
            except Exception as error:
                strategy_id = SUPER_ID if builder == self._scan_supertrend else SMA_ID
                safe_message = f'{type(error).__name__}: strategy scan failed safely; durable state was preserved.'
                errors.append({'strategyId': strategy_id, 'message': safe_message})
                strategies.append(_empty_strategy(strategy_id, 'Daily SuperTrend' if strategy_id == SUPER_ID else 'Nasdaq SMA200 Regime — 3x', True, 'Scanner error; previous durable state was preserved.', {}))
                strategies[-1]['status'] = 'error'
                scanner_error = _event(event_id(strategy_id, 'scannerError', generated_at[:10], 'SCANNER'), strategy_id, 'scannerError', generated_at, 'SCANNER', 'SCANNER', safe_message)
                strategies[-1]['events'] = [scanner_error]
                strategies[-1]['latestEvent'] = scanner_error
        has_strategy_errors = bool(errors)
        rebuild_required = [item for item in strategies if item.get('status') == 'rebuild_required']
        for item in rebuild_required:
            errors.append({'strategyId': item['strategyId'], 'message': 'Strategy configuration changed; previous virtual state is preserved and --rebuild-history is required.'})
        cache_fallbacks = sorted(getattr(self.provider, 'cache_fallbacks', set()))
        if cache_fallbacks:
            errors.append({'message': f"Cached market data used after a bounded provider failure: {', '.join(cache_fallbacks)}."})
        enabled = [item for item in strategies if item['enabled']]
        freshness_values = [item['dataFreshness'] for item in enabled if item.get('dataFreshness')]
        latest_freshness = max(freshness_values) if freshness_values else None
        stale = False
        if latest_freshness:
            try:
                stale = datetime.now(timezone.utc) - datetime.fromisoformat(latest_freshness).replace(tzinfo=timezone.utc) > timedelta(days=4)
            except ValueError:
                stale = True
        status = 'error' if has_strategy_errors else 'rebuild_required' if rebuild_required else 'not_configured' if not enabled else 'degraded' if cache_fallbacks else 'stale' if stale else 'current'
        snapshot = {'schemaVersion': 'multi_strategy_v1', 'generatedAt': generated_at, 'scanner': {'name': 'RiSKYiNVESTOR integrated scanner', 'version': '1.0.0', 'status': status, 'errors': errors, 'dataFreshness': {'generatedAt': latest_freshness or generated_at, 'staleAfterMinutes': 5760}}, 'strategies': strategies}
        self._persist(snapshot)
        return snapshot

    def _fetch(self, ticker: str) -> list[PriceBar]:
        return sorted(self.provider.fetch(ticker), key=lambda bar: bar.day)

    def _configuration_guard(self, strategy_id: str, fingerprint: str, result: dict[str, Any]) -> dict[str, Any] | None:
        durable = self.state.setdefault('strategies', {}).get(strategy_id)
        if not durable:
            return None
        stored = durable.get('configFingerprint')
        if stored == fingerprint:
            return None
        now = datetime.now(timezone.utc).isoformat()
        if not (durable.get('rebuildRequired') and durable.get('pendingFingerprint') == fingerprint):
            archive = {'strategyId': strategy_id, 'archivedAt': now, 'configFingerprint': stored, 'pendingFingerprint': fingerprint, 'state': _json_clone(durable)}
            self.state.setdefault('archivedStrategies', []).append(archive)
            self.state['archivedStrategies'] = self.state['archivedStrategies'][-20:]
        durable['rebuildRequired'] = True
        durable['pendingFingerprint'] = fingerprint
        durable['rebuildRequiredAt'] = durable.get('rebuildRequiredAt') or now
        message = 'Configuration changed after this virtual state was built. Existing model state is preserved for inspection and no new scanner data is mixed in. Run the scanner with --rebuild-history to rebuild this strategy chronologically from historical bars.'
        events = list(durable.get('events', []))
        positions = durable.get('positions', [])
        if isinstance(positions, dict):
            positions = list(positions.values())
        result.update({'status': 'rebuild_required', 'currentState': 'rebuild_required', 'ruleSummary': f"{result['ruleSummary']} {message}", 'modelValue': durable.get('modelValue'), 'returnPercent': durable.get('returnPercent'), 'drawdownPercent': durable.get('drawdownPercent'), 'exposurePercent': durable.get('exposurePercent', 0), 'equitySnapshots': durable.get('equity', []), 'virtualPositions': positions, 'closedVirtualTrades': durable.get('closed', []), 'events': events, 'regimeChangeEvents': durable.get('regimeChangeEvents'), 'latestEvent': events[-1] if events else None, 'dataFreshness': durable.get('dataFreshness'), 'rebuildRequired': True})
        for key in ('cash', 'investedValue'):
            if durable.get(key) is not None:
                result[key] = durable[key]
        for key in ('regimeStartDate', 'referenceTicker', 'executionTicker', 'lastEvaluatedMarketPeriod', 'lastCostAccrualDate'):
            if key in durable:
                result[key] = durable[key]
        return result

    def _scan_supertrend(self) -> dict[str, Any]:
        config = self.config.supertrend
        parameters = {'timeframe': config.timeframe, 'atrPeriod': config.atr_period, 'multiplier': config.multiplier, 'modelStartingCapital': config.model_starting_capital, 'allocationPolicy': config.allocation_policy, 'maximumConcurrentPositions': config.maximum_concurrent_positions, 'transactionCostPercent': config.transaction_cost_percent, 'watchlist': [{'signalTicker': row.signal_ticker, 'executionTicker': row.execution_ticker, 'enabled': row.enabled, 'allocationWeight': row.allocation_weight} for row in config.watchlist]}
        result = _empty_strategy(SUPER_ID, 'Daily SuperTrend', config.enabled, f'Daily SuperTrend using ATR {config.atr_period} and {config.multiplier:g}× multiplier. Every historical transition is replayed chronologically in its independent virtual strategy book.', parameters, configured=any((row.signal_ticker and row.execution_ticker for row in config.watchlist)))
        if not config.enabled:
            return result
        fingerprint = _fingerprint(SUPER_ID, parameters)
        guarded = self._configuration_guard(SUPER_ID, fingerprint, result)
        if guarded is not None:
            return guarded
        enabled_rows = [row for row in config.watchlist if row.enabled]
        total_weight = sum((row.allocation_weight for row in enabled_rows)) or 1
        row_data: dict[str, dict[str, Any]] = {}
        transitions: dict[date, list[dict[str, Any]]] = {}
        market_days: set[date] = set()
        freshness: list[str] = []
        for row in enabled_rows:
            signal_bars = self._fetch(row.signal_ticker)
            execution_bars = self._fetch(row.execution_ticker)
            if signal_bars:
                freshness.append(signal_bars[-1].day.isoformat())
            if execution_bars:
                freshness.append(execution_bars[-1].day.isoformat())
                market_days.update((bar.day for bar in execution_bars))
            points = supertrend(signal_bars, config.atr_period, config.multiplier)
            if not points or not execution_bars:
                continue
            row_key = _row_key(row)
            row_data[row_key] = {'row': row, 'executionBars': execution_bars}
            previous_state = 'out'
            for point in points:
                point_day = date.fromisoformat(point.date)
                market_days.add(point_day)
                if point.state != previous_state:
                    transitions.setdefault(point_day, []).append({'row': row, 'rowKey': row_key, 'state': point.state, 'previousState': previous_state})
                previous_state = point.state
        if not row_data or not market_days:
            if freshness:
                result['dataFreshness'] = max(freshness)
            return result
        cash = config.model_starting_capital
        positions: dict[str, dict[str, Any]] = {}
        closed: list[dict[str, Any]] = []
        events: list[dict[str, Any]] = []
        equity: list[dict[str, Any]] = []
        for current_day in sorted(market_days):
            todays_transitions = sorted(transitions.get(current_day, []), key=lambda item: (item['row'].signal_ticker, item['row'].execution_ticker))
            for transition in todays_transitions:
                row = transition['row']
                row_key = transition['rowKey']
                execution_bars = row_data[row_key]['executionBars']
                execution_bar = _price_on_or_before(execution_bars, current_day)
                if execution_bar is None:
                    continue
                if transition['state'] == 'in':
                    if row_key in positions:
                        continue
                    if len(positions) >= config.maximum_concurrent_positions:
                        continue
                    allocation = _supertrend_allocation(config, row, total_weight)
                    if allocation <= 0 or cash + 1e-06 < allocation:
                        continue
                    cost = allocation * config.transaction_cost_percent / 100
                    quantity = max(0.0, (allocation - cost) / execution_bar.close)
                    if quantity <= 0:
                        continue
                    opened = current_day.isoformat()
                    position = {'positionId': event_id(SUPER_ID, 'position', opened, row_key), 'label': 'Virtual model position', 'signalTicker': row.signal_ticker, 'executionTicker': row.execution_ticker, 'state': 'in', 'entryTimestamp': opened, 'entryPrice': execution_bar.close, 'latestPrice': execution_bar.close, 'quantity': quantity, 'allocation': allocation, 'openPnlValue': -cost, 'openPnlPercent': -cost / allocation * 100, 'daysHeld': 0, 'latestSignal': 'entry', 'reason': 'SuperTrend changed from out to in.'}
                    positions[row_key] = position
                    cash = max(0.0, cash - allocation)
                    identifier = event_id(SUPER_ID, 'entry', opened, row_key)
                    events.append(_event(identifier, SUPER_ID, 'entry', opened, row.signal_ticker, row.execution_ticker, 'SuperTrend changed from out to in.'))
                elif transition['state'] == 'out' and row_key in positions:
                    position = positions[row_key]
                    proceeds = position['quantity'] * execution_bar.close
                    cost = proceeds * config.transaction_cost_percent / 100
                    proceeds -= cost
                    pnl = proceeds - position['allocation']
                    closed_at = current_day.isoformat()
                    entry_day = datetime.fromisoformat(position['entryTimestamp']).date()
                    closed.append({**position, 'state': 'closed', 'exitTimestamp': closed_at, 'exitPrice': execution_bar.close, 'latestPrice': execution_bar.close, 'openPnlValue': pnl, 'openPnlPercent': pnl / max(position['allocation'], 1e-06) * 100, 'daysHeld': (current_day - entry_day).days, 'pnlValue': pnl, 'pnlPercent': pnl / max(position['allocation'], 1e-06) * 100, 'exitReason': 'SuperTrend changed from in to out.'})
                    cash += proceeds
                    del positions[row_key]
                    identifier = event_id(SUPER_ID, 'exit', closed_at, row_key)
                    events.append(_event(identifier, SUPER_ID, 'exit', closed_at, row.signal_ticker, row.execution_ticker, 'SuperTrend changed from in to out.'))
            invested = _refresh_supertrend_positions(positions, row_data, current_day)
            equity.append({'date': current_day.isoformat(), 'value': cash + invested})
        invested = _refresh_supertrend_positions(positions, row_data, sorted(market_days)[-1])
        model_value = cash + invested
        peak = max((item['value'] for item in equity))
        durable = {'configFingerprint': fingerprint, 'rebuildRequired': False, 'capital': config.model_starting_capital, 'cash': cash, 'investedValue': invested, 'modelValue': model_value, 'returnPercent': (model_value / config.model_starting_capital - 1) * 100, 'drawdownPercent': (model_value / peak - 1) * 100, 'exposurePercent': invested / max(model_value, 1e-06) * 100, 'positions': positions, 'closed': closed, 'equity': _dedupe_equity(equity), 'events': events, 'dataFreshness': max(freshness) if freshness else None, 'currentState': 'in_market' if positions else 'out_of_market'}
        self.state.setdefault('strategies', {})[SUPER_ID] = durable
        result.update({'status': 'current', 'currentState': durable['currentState'], 'modelValue': durable['modelValue'], 'returnPercent': durable['returnPercent'], 'drawdownPercent': durable['drawdownPercent'], 'exposurePercent': durable['exposurePercent'], 'cash': durable['cash'], 'investedValue': durable['investedValue'], 'equitySnapshots': durable['equity'], 'virtualPositions': list(positions.values()), 'closedVirtualTrades': closed, 'events': events, 'latestEvent': events[-1] if events else None, 'dataFreshness': durable['dataFreshness']})
        return result

    def _scan_sma(self) -> dict[str, Any]:
        config = self.config.sma
        parameters = {'referenceTicker': config.reference_ticker, 'riskOnTicker': config.risk_on_ticker, 'riskOffMode': config.risk_off_mode, 'riskOffTicker': config.risk_off_ticker, 'smaLength': config.sma_length, 'reviewCadence': config.review_cadence, 'riskOnThresholdPercent': config.risk_on_threshold_percent, 'riskOffThresholdPercent': config.risk_off_threshold_percent, 'modelStartingCapital': config.model_starting_capital, 'transactionCostPercent': config.transaction_cost_percent, 'annualInstrumentCostPercent': config.annual_instrument_cost_percent}
        result = _empty_strategy(SMA_ID, 'Nasdaq SMA200 Regime — 3x', config.enabled, f'Independent {config.sma_length}-day SMA regime. Risk-on and risk-off thresholds are evaluated only on the configured {config.review_cadence} cadence.', parameters, configured=bool(config.reference_ticker and config.risk_on_ticker))
        if not config.enabled:
            return result
        fingerprint = _fingerprint(SMA_ID, parameters)
        guarded = self._configuration_guard(SMA_ID, fingerprint, result)
        if guarded is not None:
            return guarded
        reference = self._fetch(config.reference_ticker)
        price_histories: dict[str, list[PriceBar]] = {config.risk_on_ticker: self._fetch(config.risk_on_ticker)}
        if config.risk_off_mode == 'instrument' and config.risk_off_ticker:
            price_histories[config.risk_off_ticker] = self._fetch(config.risk_off_ticker)
        evaluation_points = _sma_evaluation_points(reference, config.sma_length, config.review_cadence)
        if not reference or not price_histories[config.risk_on_ticker]:
            return result
        if not evaluation_points:
            result['dataFreshness'] = reference[-1].day.isoformat()
            return result
        cash = config.model_starting_capital
        state = 'risk_off'
        current_ticker: str | None = None
        quantity = 0.0
        entry_price: float | None = None
        entry_date: date | None = None
        regime_start_date: str | None = None
        allocation = 0.0
        last_cost_accrual_date: date | None = None
        total_cost = 0.0
        closed: list[dict[str, Any]] = []
        events: list[dict[str, Any]] = []
        equity: list[dict[str, Any]] = []
        last_distance = 0.0
        last_evaluated_period: str | None = None
        for index, period_key in evaluation_points:
            day = reference[index].day
            average = _sma_at(reference, index, config.sma_length)
            if average is None:
                continue
            distance = (reference[index].close / average - 1) * 100
            last_distance = distance
            last_evaluated_period = period_key
            if current_ticker and quantity > 0:
                quantity, last_cost_accrual_date, accrued = _accrue_cost(quantity, current_ticker, last_cost_accrual_date, day, price_histories, config.annual_instrument_cost_percent)
                total_cost += accrued
            desired = state
            if distance >= config.risk_on_threshold_percent:
                desired = 'risk_on'
            elif distance <= config.risk_off_threshold_percent:
                desired = 'risk_off'
            desired_ticker = _sma_execution_ticker(config, desired)
            if desired != state or desired_ticker != current_ticker:
                if current_ticker and quantity > 0 and (entry_price is not None):
                    price_bar = _price_on_or_before(price_histories[current_ticker], day)
                    if price_bar is not None:
                        proceeds = quantity * price_bar.close
                        proceeds -= proceeds * config.transaction_cost_percent / 100
                        pnl = proceeds - allocation
                        closed.append({'positionId': event_id(SMA_ID, 'position', entry_date.isoformat() if entry_date else day.isoformat(), current_ticker), 'label': 'Virtual model position', 'signalTicker': config.reference_ticker, 'executionTicker': current_ticker, 'state': 'closed', 'entryTimestamp': entry_date.isoformat() if entry_date else None, 'entryPrice': entry_price, 'exitTimestamp': day.isoformat(), 'exitPrice': price_bar.close, 'quantity': quantity, 'allocation': allocation, 'pnlValue': pnl, 'pnlPercent': pnl / max(allocation, 1e-06) * 100, 'exitReason': f"SMA regime changed to {desired.replace('_', ' ')}."})
                        cash = proceeds
                    quantity = 0.0
                    entry_price = None
                    entry_date = None
                    allocation = 0.0
                    last_cost_accrual_date = None
                state = desired
                current_ticker = desired_ticker
                regime_start_date = day.isoformat()
                if desired_ticker:
                    price_bar = _price_on_or_before(price_histories[desired_ticker], day)
                    if price_bar is not None and cash > 0:
                        allocation = cash
                        cost = allocation * config.transaction_cost_percent / 100
                        quantity = max(0.0, (allocation - cost) / price_bar.close)
                        entry_price = price_bar.close
                        entry_date = day
                        cash = 0.0
                        last_cost_accrual_date = day
                    else:
                        current_ticker = None
                identifier = event_id(SMA_ID, desired, day.isoformat(), desired_ticker or 'cash')
                events.append(_event(identifier, SMA_ID, 'entry' if desired == 'risk_on' else 'exit', day.isoformat(), config.reference_ticker, desired_ticker or 'CASH', f"Reference closed {distance:.2f}% from its {config.sma_length}-day average; regime changed to {desired.replace('_', ' ')}."))
            invested = _position_value(price_histories, current_ticker, quantity, day)
            equity.append({'date': day.isoformat(), 'value': cash + invested})
        latest_reference_day = reference[-1].day
        if current_ticker and quantity > 0:
            quantity, last_cost_accrual_date, accrued = _accrue_cost(quantity, current_ticker, last_cost_accrual_date, latest_reference_day, price_histories, config.annual_instrument_cost_percent)
            total_cost += accrued
        invested = _position_value(price_histories, current_ticker, quantity, latest_reference_day)
        if equity and equity[-1]['date'] != latest_reference_day.isoformat():
            equity.append({'date': latest_reference_day.isoformat(), 'value': cash + invested})
        model_value = cash + invested
        peak = max((item['value'] for item in equity)) if equity else model_value
        latest_price = _price_on_or_before(price_histories[current_ticker], latest_reference_day).close if current_ticker and _price_on_or_before(price_histories[current_ticker], latest_reference_day) else None
        position = [{'positionId': f'{SMA_ID}:current', 'label': 'Virtual model position', 'signalTicker': config.reference_ticker, 'executionTicker': current_ticker, 'state': state, 'entryTimestamp': entry_date.isoformat() if entry_date else None, 'entryPrice': entry_price, 'latestPrice': latest_price, 'quantity': quantity, 'allocation': allocation, 'openPnlValue': invested - allocation, 'openPnlPercent': (invested / max(allocation, 1e-06) - 1) * 100, 'daysHeld': (latest_reference_day - entry_date).days if entry_date else 0, 'latestSignal': state, 'reason': f'Reference is {last_distance:.2f}% from SMA{config.sma_length}.'}] if current_ticker and quantity > 0 else []
        durable = {'configFingerprint': fingerprint, 'rebuildRequired': False, 'state': state, 'currentState': state, 'regimeStartDate': regime_start_date, 'referenceTicker': config.reference_ticker, 'executionTicker': current_ticker or 'CASH', 'cash': cash, 'quantity': quantity, 'entryPrice': entry_price, 'entryDate': entry_date.isoformat() if entry_date else None, 'allocation': allocation, 'investedValue': invested, 'modelValue': model_value, 'returnPercent': (model_value / config.model_starting_capital - 1) * 100, 'drawdownPercent': (model_value / peak - 1) * 100, 'exposurePercent': invested / max(model_value, 1e-06) * 100, 'equity': _dedupe_equity(equity), 'events': events, 'regimeChangeEvents': events, 'closed': closed, 'positions': position, 'lastEvaluatedMarketPeriod': last_evaluated_period, 'lastCostAccrualDate': last_cost_accrual_date.isoformat() if last_cost_accrual_date else None, 'totalInstrumentCost': total_cost, 'dataFreshness': latest_reference_day.isoformat()}
        self.state.setdefault('strategies', {})[SMA_ID] = durable
        result.update({'status': 'current', 'currentState': durable['currentState'], 'regimeStartDate': durable['regimeStartDate'], 'referenceTicker': config.reference_ticker, 'executionTicker': durable['executionTicker'], 'lastEvaluatedMarketPeriod': last_evaluated_period, 'lastCostAccrualDate': durable['lastCostAccrualDate'], 'modelValue': model_value, 'cash': cash, 'investedValue': invested, 'returnPercent': durable['returnPercent'], 'drawdownPercent': durable['drawdownPercent'], 'exposurePercent': durable['exposurePercent'], 'equitySnapshots': durable['equity'], 'virtualPositions': position, 'closedVirtualTrades': closed, 'events': events, 'regimeChangeEvents': events, 'latestEvent': events[-1] if events else None, 'dataFreshness': latest_reference_day.isoformat()})
        return result

def _event(identifier: str, strategy_id: str, event_type: str, occurred_at: str, signal_ticker: str, execution_ticker: str, reason: str) -> dict[str, Any]:
    return {'eventId': identifier, 'strategyId': strategy_id, 'eventType': event_type, 'occurredAt': occurred_at, 'signalTicker': signal_ticker, 'executionTicker': execution_ticker, 'reason': reason}

def _dedupe_equity(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date = {str(item['date']): item for item in values}
    return [by_date[key] for key in sorted(by_date)][-5000:]

def _fingerprint(strategy_id: str, parameters: dict[str, Any]) -> str:
    material = json.dumps({'strategyId': strategy_id, 'parameters': parameters}, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(material).hexdigest()

def _json_clone(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))

def _row_key(row: WatchlistRow) -> str:
    return f'{row.signal_ticker}|{row.execution_ticker}'

def _price_on_or_before(bars: list[PriceBar], target: date) -> PriceBar | None:
    candidate: PriceBar | None = None
    for bar in bars:
        if bar.day > target:
            break
        candidate = bar
    return candidate

def _supertrend_allocation(config: SuperTrendConfig, row: WatchlistRow, total_weight: float) -> float:
    if config.allocation_policy == 'equal_weight':
        return config.model_starting_capital / config.maximum_concurrent_positions
    return config.model_starting_capital * row.allocation_weight / total_weight

def _refresh_supertrend_positions(positions: dict[str, dict[str, Any]], row_data: dict[str, dict[str, Any]], current_day: date) -> float:
    invested = 0.0
    for row_key, position in positions.items():
        execution_bar = _price_on_or_before(row_data[row_key]['executionBars'], current_day)
        if execution_bar is None:
            continue
        current_value = position['quantity'] * execution_bar.close
        entry_day = datetime.fromisoformat(position['entryTimestamp']).date()
        position['latestPrice'] = execution_bar.close
        position['openPnlValue'] = current_value - position['allocation']
        position['openPnlPercent'] = (current_value / max(position['allocation'], 1e-06) - 1) * 100
        position['daysHeld'] = (current_day - entry_day).days
        invested += current_value
    return invested

def _sma_at(reference: list[PriceBar], index: int, length: int) -> float | None:
    if index + 1 < length:
        return None
    window = reference[index - length + 1:index + 1]
    return sum((bar.close for bar in window)) / length

def _sma_evaluation_points(reference: list[PriceBar], length: int, cadence: str) -> list[tuple[int, str]]:
    if cadence == 'daily':
        return [(index, reference[index].day.isoformat()) for index in range(length - 1, len(reference))]
    weekly: dict[tuple[int, int], int] = {}
    order: list[tuple[int, int]] = []
    for index, bar in enumerate(reference):
        year, week, _ = bar.day.isocalendar()
        key = (year, week)
        if key not in weekly:
            order.append(key)
        weekly[key] = index
    points: list[tuple[int, str]] = []
    latest_key = order[-1] if order else None
    for key in order:
        index = weekly[key]
        if index + 1 < length:
            continue
        is_latest_partial_week = key == latest_key and reference[index].day.weekday() < 4
        if is_latest_partial_week:
            continue
        points.append((index, f'{key[0]}-W{key[1]:02d}'))
    return points

def _sma_execution_ticker(config: Any, desired: str) -> str | None:
    if desired == 'risk_on':
        return config.risk_on_ticker
    if config.risk_off_mode == 'instrument':
        return config.risk_off_ticker
    return None

def _accrue_cost(quantity: float, ticker: str, last_date: date | None, through_date: date, price_histories: dict[str, list[PriceBar]], annual_percent: float) -> tuple[float, date | None, float]:
    if quantity <= 0 or annual_percent <= 0 or last_date is None:
        return (quantity, last_date, 0.0)
    accrued = 0.0
    newest = last_date
    for bar in price_histories.get(ticker, []):
        if bar.day <= last_date or bar.day > through_date:
            continue
        position_value = quantity * bar.close
        daily_cost = position_value * annual_percent / 100 / 365
        if daily_cost > 0 and bar.close > 0:
            quantity = max(0.0, quantity - daily_cost / bar.close)
            accrued += daily_cost
        newest = bar.day
    return (quantity, newest, accrued)

def _position_value(price_histories: dict[str, list[PriceBar]], ticker: str | None, quantity: float, day: date) -> float:
    if not ticker or quantity <= 0:
        return 0.0
    price_bar = _price_on_or_before(price_histories.get(ticker, []), day)
    return quantity * price_bar.close if price_bar else 0.0
