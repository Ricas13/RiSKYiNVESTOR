from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import hashlib
import json
from .calculations import supertrend
from .config import SanityCheckConfig, ScannerConfig, SuperTrendConfig, WatchlistRow
from .market_data import CsvMarketDataProvider, PriceBar
from .storage import atomic_write_json, read_json
SUPER_ID = 'daily-supertrend'
SMA_ID = 'nasdaq-sma200-3x'

def event_id(strategy_id: str, event_type: str, date_text: str, ticker: str) -> str:
    material = f'{strategy_id}|{event_type}|{date_text}|{ticker}'.encode()
    return f'{strategy_id}:{hashlib.sha256(material).hexdigest()[:24]}'

def _empty_strategy(strategy_id: str, name: str, enabled: bool, summary: str, parameters: dict[str, Any], configured: bool=True) -> dict[str, Any]:
    return {'strategyId': strategy_id, 'name': name, 'enabled': enabled, 'configured': configured, 'status': 'disabled' if not enabled else 'awaiting_data', 'ruleSummary': summary, 'parameters': parameters, 'currentState': 'disabled' if not enabled else 'awaiting_data', 'modelValue': None, 'returnPercent': None, 'drawdownPercent': None, 'exposurePercent': 0, 'equitySnapshots': [], 'virtualPositions': [], 'closedVirtualTrades': [], 'events': [], 'latestEvent': None, 'dataFreshness': None, 'warnings': [], 'diagnostics': []}

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
        warnings = _scanner_warnings(strategies)
        snapshot = {'schemaVersion': 'multi_strategy_v1', 'generatedAt': generated_at, 'scanner': {'name': 'RiSKYiNVESTOR integrated scanner', 'version': '1.0.0', 'status': status, 'errors': errors, 'warnings': warnings, 'dataFreshness': {'generatedAt': latest_freshness or generated_at, 'staleAfterMinutes': 5760}}, 'strategies': strategies}
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
        result.update({'status': 'rebuild_required', 'currentState': 'rebuild_required', 'ruleSummary': f"{result['ruleSummary']} {message}", 'modelValue': durable.get('modelValue'), 'returnPercent': durable.get('returnPercent'), 'drawdownPercent': durable.get('drawdownPercent'), 'exposurePercent': durable.get('exposurePercent', 0), 'equitySnapshots': durable.get('equity', []), 'virtualPositions': positions, 'closedVirtualTrades': durable.get('closed', []), 'events': events, 'regimeChangeEvents': durable.get('regimeChangeEvents'), 'latestEvent': events[-1] if events else None, 'dataFreshness': durable.get('dataFreshness'), 'warnings': durable.get('warnings', []), 'diagnostics': durable.get('diagnostics', []), 'rebuildRequired': True})
        for key in ('cash', 'investedValue'):
            if durable.get(key) is not None:
                result[key] = durable[key]
        for key in ('regimeStartDate', 'referenceTicker', 'executionTicker', 'lastEvaluatedMarketPeriod', 'lastCostAccrualDate'):
            if key in durable:
                result[key] = durable[key]
        return result

    def _scan_supertrend(self) -> dict[str, Any]:
        config = self.config.supertrend
        parameters = {'indicatorName': 'AdaptiveSuperTrendSignals', 'tradingViewCompatible': True, 'parityMode': 'tradingview_adaptive_supertrend_signals', 'timeframe': config.timeframe, 'referenceTimeframe': config.reference_timeframe, 'atrLength': config.atr_period, 'atrPeriod': config.atr_period, 'smoothing': config.smoothing, 'switchStoploss': config.switch_stoploss, 'useConfirmed': config.use_confirmed, 'legacyMultiplier': config.multiplier, 'modelStartingCapital': config.model_starting_capital, 'allocationPolicy': config.allocation_policy, 'maximumConcurrentPositions': config.maximum_concurrent_positions, 'transactionCostPercent': config.transaction_cost_percent, 'watchlist': [{'signalTicker': row.signal_ticker, 'executionTicker': row.execution_ticker, 'enabled': row.enabled, 'allocationWeight': row.allocation_weight} for row in config.watchlist]}
        result = _empty_strategy(SUPER_ID, 'Daily SuperTrend', config.enabled, f'AdaptiveSuperTrendSignals parity mode using ATR {config.atr_period}, {config.smoothing} smoothing, daily reference timeframe and confirmed candles. Every historical transition is replayed chronologically in its independent virtual strategy book.', parameters, configured=any((row.signal_ticker and row.execution_ticker for row in config.watchlist)))
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
        quality_warnings: list[dict[str, Any]] = []
        diagnostics: list[dict[str, Any]] = []
        for row in enabled_rows:
            signal_bars = self._fetch(row.signal_ticker)
            execution_bars = self._fetch(row.execution_ticker)
            quality_warnings.extend(
                _market_data_pair_warnings(
                    row,
                    signal_bars,
                    execution_bars,
                    self.config.sanity,
                )
            )
            if signal_bars:
                freshness.append(signal_bars[-1].day.isoformat())
            if execution_bars:
                freshness.append(execution_bars[-1].day.isoformat())
                market_days.update((bar.day for bar in execution_bars))
            entry_points = supertrend(
                signal_bars,
                config.atr_period,
                config.multiplier,
                smoothing=config.smoothing,
                switch_stoploss=config.switch_stoploss,
                use_confirmed=config.use_confirmed,
            )
            exit_points = supertrend(
                execution_bars,
                config.atr_period,
                config.multiplier,
                smoothing=config.smoothing,
                switch_stoploss=config.switch_stoploss,
                use_confirmed=config.use_confirmed,
            )
            if not entry_points or not exit_points or not execution_bars:
                continue
            row_key = _row_key(row)
            row_data[row_key] = {'row': row, 'executionBars': execution_bars}
            previous_entry_state = 'out'
            for point in entry_points:
                point_day = date.fromisoformat(point.date)
                market_days.add(point_day)
                if point.state != previous_entry_state:
                    diagnostics.append(_supertrend_diagnostic(row, point, previous_entry_state, row.signal_ticker))
                    if previous_entry_state == 'out' and point.state == 'in':
                        transitions.setdefault(point_day, []).append({'row': row, 'rowKey': row_key, 'action': 'entry', 'calculationTicker': row.signal_ticker})
                previous_entry_state = point.state
            previous_exit_state = 'out'
            for point in exit_points:
                point_day = date.fromisoformat(point.date)
                market_days.add(point_day)
                if point.state != previous_exit_state:
                    diagnostics.append(_supertrend_diagnostic(row, point, previous_exit_state, row.execution_ticker))
                    if previous_exit_state == 'in' and point.state == 'out':
                        transitions.setdefault(point_day, []).append({'row': row, 'rowKey': row_key, 'action': 'exit', 'calculationTicker': row.execution_ticker})
                previous_exit_state = point.state
        if not row_data or not market_days:
            if freshness:
                result['dataFreshness'] = max(freshness)
            result['warnings'] = _dedupe_warnings(quality_warnings)
            return result
        cash = config.model_starting_capital
        positions: dict[str, dict[str, Any]] = {}
        closed: list[dict[str, Any]] = []
        events: list[dict[str, Any]] = []
        equity: list[dict[str, Any]] = []
        for current_day in sorted(market_days):
            todays_transitions = sorted(transitions.get(current_day, []), key=lambda item: (item['row'].signal_ticker, item['row'].execution_ticker, 0 if item['action'] == 'exit' else 1))
            for transition in todays_transitions:
                row = transition['row']
                row_key = transition['rowKey']
                execution_bars = row_data[row_key]['executionBars']
                execution_bar = _price_on_or_before(execution_bars, current_day)
                if execution_bar is None:
                    continue
                if transition['action'] == 'entry':
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
                    position = {'positionId': event_id(SUPER_ID, 'position', opened, row_key), 'label': 'Virtual model position', 'signalTicker': row.signal_ticker, 'executionTicker': row.execution_ticker, 'state': 'in', 'entryTimestamp': opened, 'entryPrice': execution_bar.close, 'latestPrice': execution_bar.close, 'quantity': quantity, 'allocation': allocation, 'openPnlValue': -cost, 'openPnlPercent': -cost / allocation * 100, 'daysHeld': 0, 'latestSignal': 'entry', 'reason': 'SuperTrend BUY on signal ticker; opened leveraged execution ticker.'}
                    positions[row_key] = position
                    cash = max(0.0, cash - allocation)
                    identifier = event_id(SUPER_ID, 'entry', opened, row_key)
                    events.append(_event(identifier, SUPER_ID, 'entry', opened, row.signal_ticker, row.execution_ticker, 'SuperTrend BUY on signal ticker; opened leveraged execution ticker.', calculation_ticker=transition['calculationTicker']))
                elif transition['action'] == 'exit' and row_key in positions:
                    position = positions[row_key]
                    proceeds = position['quantity'] * execution_bar.close
                    cost = proceeds * config.transaction_cost_percent / 100
                    proceeds -= cost
                    pnl = proceeds - position['allocation']
                    closed_at = current_day.isoformat()
                    entry_day = datetime.fromisoformat(position['entryTimestamp']).date()
                    closed.append({**position, 'state': 'closed', 'exitTimestamp': closed_at, 'exitPrice': execution_bar.close, 'latestPrice': execution_bar.close, 'openPnlValue': pnl, 'openPnlPercent': pnl / max(position['allocation'], 1e-06) * 100, 'daysHeld': (current_day - entry_day).days, 'pnlValue': pnl, 'pnlPercent': pnl / max(position['allocation'], 1e-06) * 100, 'exitReason': 'SuperTrend SELL on execution ticker; closed leveraged position.'})
                    cash += proceeds
                    del positions[row_key]
                    identifier = event_id(SUPER_ID, 'exit', closed_at, row_key)
                    events.append(_event(identifier, SUPER_ID, 'exit', closed_at, row.signal_ticker, row.execution_ticker, 'SuperTrend SELL on execution ticker; closed leveraged position.', calculation_ticker=transition['calculationTicker']))
            invested = _refresh_supertrend_positions(positions, row_data, current_day)
            equity.append({'date': current_day.isoformat(), 'value': cash + invested})
        invested = _refresh_supertrend_positions(positions, row_data, sorted(market_days)[-1])
        model_value = cash + invested
        peak = max((item['value'] for item in equity))
        durable = {'configFingerprint': fingerprint, 'rebuildRequired': False, 'capital': config.model_starting_capital, 'cash': cash, 'investedValue': invested, 'modelValue': model_value, 'returnPercent': (model_value / config.model_starting_capital - 1) * 100, 'drawdownPercent': (model_value / peak - 1) * 100, 'exposurePercent': invested / max(model_value, 1e-06) * 100, 'positions': positions, 'closed': closed, 'equity': _dedupe_equity(equity), 'events': events, 'dataFreshness': max(freshness) if freshness else None, 'currentState': 'in_market' if positions else 'out_of_market', 'warnings': [], 'diagnostics': diagnostics[-100:]}
        result.update({'status': 'current', 'currentState': durable['currentState'], 'modelValue': durable['modelValue'], 'returnPercent': durable['returnPercent'], 'drawdownPercent': durable['drawdownPercent'], 'exposurePercent': durable['exposurePercent'], 'cash': durable['cash'], 'investedValue': durable['investedValue'], 'equitySnapshots': durable['equity'], 'virtualPositions': list(positions.values()), 'closedVirtualTrades': closed, 'events': events, 'latestEvent': events[-1] if events else None, 'dataFreshness': durable['dataFreshness'], 'diagnostics': durable['diagnostics']})
        _apply_performance_warnings(result, self.config.sanity, quality_warnings)
        durable['positions'] = {
            _row_key(
                WatchlistRow(
                    signal_ticker=position['signalTicker'],
                    execution_ticker=position['executionTicker'],
                    enabled=True,
                    allocation_weight=1,
                )
            ): position
            for position in result['virtualPositions']
        }
        durable['closed'] = result['closedVirtualTrades']
        durable['warnings'] = result['warnings']
        self.state.setdefault('strategies', {})[SUPER_ID] = durable
        return result

    def _scan_sma(self) -> dict[str, Any]:
        return self._scan_sma_book()

    def _scan_sma_book(self) -> dict[str, Any]:
        config = self.config.sma
        parameters = {
            'referenceTicker': config.reference_ticker,
            'riskOnTicker': config.risk_on_ticker,
            'watchlist': [
                {
                    'signalTicker': row.signal_ticker,
                    'executionTicker': row.execution_ticker,
                    'enabled': row.enabled,
                    'allocationWeight': row.allocation_weight,
                }
                for row in config.watchlist
            ],
            'riskOffMode': config.risk_off_mode,
            'riskOffTicker': config.risk_off_ticker,
            'smaLength': config.sma_length,
            'reviewCadence': config.review_cadence,
            'riskOnThresholdPercent': config.risk_on_threshold_percent,
            'riskOffThresholdPercent': config.risk_off_threshold_percent,
            'modelStartingCapital': config.model_starting_capital,
            'transactionCostPercent': config.transaction_cost_percent,
            'annualInstrumentCostPercent': config.annual_instrument_cost_percent,
        }
        rows, legacy_single_pair = _sma_effective_rows(config)
        result = _empty_strategy(
            SMA_ID,
            'Nasdaq SMA200 Regime — 3x',
            config.enabled,
            (
                f'Independent {config.sma_length}-day SMA regime. Each enabled '
                'ticker pair is evaluated from its unleveraged signal ticker '
                'and holds only its configured execution ticker when risk-on.'
            ),
            parameters,
            configured=bool(rows),
        )
        if not config.enabled:
            return result
        fingerprint = _fingerprint(SMA_ID, parameters)
        guarded = self._configuration_guard(SMA_ID, fingerprint, result)
        if guarded is not None:
            return guarded
        if not rows:
            return result

        row_capital = config.model_starting_capital / len(rows)
        row_results: list[dict[str, Any]] = []
        freshness: list[str] = []
        quality_warnings: list[dict[str, Any]] = []
        for row in rows:
            reference = self._fetch(row.signal_ticker)
            execution = self._fetch(row.execution_ticker)
            quality_warnings.extend(
                _market_data_pair_warnings(
                    row,
                    reference,
                    execution,
                    self.config.sanity,
                )
            )
            if reference:
                freshness.append(reference[-1].day.isoformat())
            if execution:
                freshness.append(execution[-1].day.isoformat())
            risk_off_ticker = (
                config.risk_off_ticker
                if legacy_single_pair
                and config.risk_off_mode == 'instrument'
                and config.risk_off_ticker
                else None
            )
            price_histories: dict[str, list[PriceBar]] = {
                row.execution_ticker: execution
            }
            if risk_off_ticker:
                price_histories[risk_off_ticker] = self._fetch(risk_off_ticker)
                if price_histories[risk_off_ticker]:
                    freshness.append(
                        price_histories[risk_off_ticker][-1].day.isoformat()
                    )
            row_results.append(
                _scan_sma_row(
                    config,
                    row,
                    row_capital,
                    reference,
                    price_histories,
                    risk_off_ticker,
                )
            )

        usable_results = [item for item in row_results if item['dataFreshness']]
        if not usable_results:
            if freshness:
                result['dataFreshness'] = max(freshness)
            result['warnings'] = _dedupe_warnings(quality_warnings)
            return result

        cash = sum(item['cash'] for item in row_results)
        invested = sum(item['investedValue'] for item in row_results)
        model_value = cash + invested
        equity = _combine_sma_equity(row_results)
        peak = max((item['value'] for item in equity), default=model_value)
        events = sorted(
            [event for item in row_results for event in item['events']],
            key=lambda item: (
                item['occurredAt'],
                item['signalTicker'],
                item['executionTicker'],
            ),
        )
        positions = sorted(
            [position for item in row_results for position in item['positions']],
            key=lambda item: (item['signalTicker'], item['executionTicker']),
        )
        closed = sorted(
            [trade for item in row_results for trade in item['closed']],
            key=lambda item: (
                str(item.get('exitTimestamp')),
                str(item.get('signalTicker')),
                str(item.get('executionTicker')),
            ),
        )
        current_state = _sma_book_state(row_results)
        latest_event = events[-1] if events else None
        data_freshness = max(item['dataFreshness'] for item in usable_results)
        legacy_reference = rows[0].signal_ticker if legacy_single_pair else None
        legacy_execution = (
            positions[0]['executionTicker']
            if legacy_single_pair and positions
            else rows[0].execution_ticker
            if legacy_single_pair
            else None
        )
        durable = {
            'configFingerprint': fingerprint,
            'rebuildRequired': False,
            'state': current_state,
            'currentState': current_state,
            'regimeStartDate': latest_event['occurredAt'] if latest_event else None,
            'referenceTicker': legacy_reference,
            'executionTicker': legacy_execution
            or ('CASH' if legacy_single_pair else None),
            'cash': cash,
            'investedValue': invested,
            'modelValue': model_value,
            'returnPercent': (model_value / config.model_starting_capital - 1)
            * 100,
            'drawdownPercent': (model_value / peak - 1) * 100 if peak else 0,
            'exposurePercent': invested / max(model_value, 1e-06) * 100,
            'equity': _dedupe_equity(equity),
            'events': events,
            'regimeChangeEvents': events,
            'closed': closed,
            'positions': positions,
            'lastEvaluatedMarketPeriod': max(
                (
                    str(item['lastEvaluatedMarketPeriod'])
                    for item in row_results
                    if item['lastEvaluatedMarketPeriod']
                ),
                default=None,
            ),
            'lastCostAccrualDate': max(
                (
                    str(item['lastCostAccrualDate'])
                    for item in row_results
                    if item['lastCostAccrualDate']
                ),
                default=None,
            ),
            'totalInstrumentCost': sum(
                item['totalInstrumentCost'] for item in row_results
            ),
            'dataFreshness': data_freshness,
            'warnings': [],
        }
        result.update(
            {
                'status': 'current',
                'currentState': durable['currentState'],
                'regimeStartDate': durable['regimeStartDate'],
                'referenceTicker': durable['referenceTicker'],
                'executionTicker': durable['executionTicker'],
                'lastEvaluatedMarketPeriod': durable['lastEvaluatedMarketPeriod'],
                'lastCostAccrualDate': durable['lastCostAccrualDate'],
                'modelValue': model_value,
                'cash': cash,
                'investedValue': invested,
                'returnPercent': durable['returnPercent'],
                'drawdownPercent': durable['drawdownPercent'],
                'exposurePercent': durable['exposurePercent'],
                'equitySnapshots': durable['equity'],
                'virtualPositions': positions,
                'closedVirtualTrades': closed,
                'events': events,
                'regimeChangeEvents': events,
                'latestEvent': latest_event,
                'dataFreshness': data_freshness,
            }
        )
        _apply_performance_warnings(result, self.config.sanity, quality_warnings)
        durable['positions'] = result['virtualPositions']
        durable['closed'] = result['closedVirtualTrades']
        durable['warnings'] = result['warnings']
        self.state.setdefault('strategies', {})[SMA_ID] = durable
        return result

def _event(identifier: str, strategy_id: str, event_type: str, occurred_at: str, signal_ticker: str, execution_ticker: str, reason: str, *, calculation_ticker: str | None = None) -> dict[str, Any]:
    return {'eventId': identifier, 'strategyId': strategy_id, 'eventType': event_type, 'occurredAt': occurred_at, 'signalTicker': signal_ticker, 'executionTicker': execution_ticker, 'calculationTicker': calculation_ticker or signal_ticker, 'reason': reason}

def _supertrend_diagnostic(row: WatchlistRow, point: Any, previous_state: str, calculation_ticker: str) -> dict[str, Any]:
    return {
        'signalTicker': row.signal_ticker,
        'executionTicker': row.execution_ticker,
        'calculationTicker': calculation_ticker,
        'date': point.date,
        'previousState': previous_state,
        'state': point.state,
        'close': point.close,
        'currentATR': point.atr,
        'priorATR': point.prior_atr,
        'rawMultiplier': point.raw_multiplier,
        'currentFactor': point.factor,
        'supertrend': point.value,
        'direction': point.direction,
        'flipToGreen': point.flip_to_green,
        'flipToRed': point.flip_to_red,
    }

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

def _warning(
    code: str,
    message: str,
    affected_tickers: list[str],
    *,
    metric: str | None = None,
    value: float | int | str | None = None,
    threshold: float | int | str | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        'severity': 'warning',
        'code': code,
        'message': message,
        'affectedTickers': sorted(
            {ticker for ticker in affected_tickers if ticker}
        ),
    }
    if metric:
        result['metric'] = metric
    if value is not None:
        result['value'] = round(value, 4) if isinstance(value, float) else value
    if threshold is not None:
        result['threshold'] = threshold
    return result

def _dedupe_warnings(warnings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for warning in warnings:
        key = json.dumps(warning, sort_keys=True, separators=(',', ':'))
        if key in seen:
            continue
        seen.add(key)
        result.append(warning)
    return result

def _scanner_warnings(strategies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    for strategy in strategies:
        strategy_id = str(strategy.get('strategyId', ''))
        for warning in strategy.get('warnings', []):
            if not isinstance(warning, dict):
                continue
            warnings.append({**warning, 'strategyId': strategy_id})
    return _dedupe_warnings(warnings)

def _market_data_pair_warnings(
    row: WatchlistRow,
    signal_bars: list[PriceBar],
    execution_bars: list[PriceBar],
    sanity: SanityCheckConfig,
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    tickers = [row.signal_ticker, row.execution_ticker]
    if not execution_bars:
        warnings.append(
            _warning(
                'missing_execution_history',
                (
                    'Performance warning: execution instrument history is '
                    'missing, so model returns/P&L cannot be trusted yet.'
                ),
                tickers,
            )
        )
    else:
        history_days = (execution_bars[-1].day - execution_bars[0].day).days
        if history_days < sanity.minimum_execution_history_days:
            warnings.append(
                _warning(
                    'short_execution_history',
                    (
                        'Performance warning: this model result may be '
                        'distorted because the execution instrument has a '
                        'short price history.'
                    ),
                    tickers,
                    metric='executionHistoryDays',
                    value=history_days,
                    threshold=sanity.minimum_execution_history_days,
                )
            )
    if signal_bars and execution_bars:
        lag_days = abs((signal_bars[-1].day - execution_bars[-1].day).days)
        if lag_days > sanity.maximum_data_lag_days:
            warnings.append(
                _warning(
                    'signal_execution_data_lag',
                    (
                        'Performance warning: signal and execution ticker '
                        'latest data dates differ, so model values may need '
                        'review.'
                    ),
                    tickers,
                    metric='dataLagDays',
                    value=lag_days,
                    threshold=sanity.maximum_data_lag_days,
                )
            )
    return warnings

def _apply_performance_warnings(
    strategy: dict[str, Any],
    sanity: SanityCheckConfig,
    quality_warnings: list[dict[str, Any]],
) -> None:
    warnings = list(strategy.get('warnings', [])) + quality_warnings
    for position in strategy.get('virtualPositions', []):
        position_warnings = _position_warnings(position, sanity)
        position['warnings'] = _dedupe_warnings(
            list(position.get('warnings', [])) + position_warnings
        )
        warnings.extend(position['warnings'])
    for trade in strategy.get('closedVirtualTrades', []):
        trade_warnings = _trade_warnings(trade, sanity)
        trade['warnings'] = _dedupe_warnings(
            list(trade.get('warnings', [])) + trade_warnings
        )
        warnings.extend(trade['warnings'])
    return_percent = _float_or_none(strategy.get('returnPercent'))
    if (
        return_percent is not None
        and abs(return_percent) > sanity.high_model_return_percent
    ):
        warnings.append(
            _warning(
                'extreme_model_return',
                (
                    'Performance warning: this model return may be distorted '
                    'by leveraged ETP price history or currency units.'
                ),
                _strategy_tickers(strategy),
                metric='returnPercent',
                value=return_percent,
                threshold=sanity.high_model_return_percent,
            )
        )
    drawdown = _float_or_none(strategy.get('drawdownPercent'))
    trade_count = sum(
        1
        for event in strategy.get('events', [])
        if event.get('eventType') in {'entry', 'exit'}
    )
    if (
        drawdown is not None
        and abs(drawdown) <= sanity.near_zero_drawdown_percent
        and trade_count >= sanity.many_trades_threshold
        and any(_looks_leveraged(ticker) for ticker in _strategy_tickers(strategy))
    ):
        warnings.append(
            _warning(
                'near_zero_drawdown_leveraged_book',
                (
                    'Performance warning: drawdown is near zero despite many '
                    'leveraged-instrument trades; review model performance '
                    'before relying on it.'
                ),
                _strategy_tickers(strategy),
                metric='drawdownPercent',
                value=drawdown,
                threshold=sanity.near_zero_drawdown_percent,
            )
        )
    strategy['warnings'] = _dedupe_warnings(warnings)

def _position_warnings(
    position: dict[str, Any],
    sanity: SanityCheckConfig,
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    tickers = [
        str(position.get('signalTicker') or ''),
        str(position.get('executionTicker') or ''),
    ]
    open_pnl = _float_or_none(position.get('openPnlPercent'))
    if open_pnl is not None and abs(open_pnl) > sanity.high_open_pnl_percent:
        warnings.append(
            _warning(
                'extreme_open_pnl',
                (
                    'Performance warning: this open P/L may be distorted by '
                    'leveraged ETP price history or currency units.'
                ),
                tickers,
                metric='openPnlPercent',
                value=open_pnl,
                threshold=sanity.high_open_pnl_percent,
            )
        )
    ratio = _price_ratio(position.get('entryPrice'), position.get('latestPrice'))
    if ratio is not None and ratio > sanity.extreme_price_ratio:
        warnings.append(
            _warning(
                'extreme_price_ratio',
                (
                    'Performance warning: latest price is extremely far from '
                    'entry price; splits, rebases, adjusted data, or price '
                    'units may be distorting model P/L.'
                ),
                tickers,
                metric='latestToEntryPriceRatio',
                value=ratio,
                threshold=sanity.extreme_price_ratio,
            )
        )
    return warnings

def _trade_warnings(
    trade: dict[str, Any],
    sanity: SanityCheckConfig,
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    tickers = [
        str(trade.get('signalTicker') or ''),
        str(trade.get('executionTicker') or ''),
    ]
    pnl = _float_or_none(trade.get('pnlPercent') or trade.get('openPnlPercent'))
    if pnl is not None and abs(pnl) > sanity.high_open_pnl_percent:
        warnings.append(
            _warning(
                'extreme_trade_pnl',
                (
                    'Performance warning: this closed-trade P/L may be '
                    'distorted by leveraged ETP price history or currency '
                    'units.'
                ),
                tickers,
                metric='pnlPercent',
                value=pnl,
                threshold=sanity.high_open_pnl_percent,
            )
        )
    ratio = _price_ratio(trade.get('entryPrice'), trade.get('exitPrice'))
    if ratio is not None and ratio > sanity.extreme_price_ratio:
        warnings.append(
            _warning(
                'extreme_trade_price_ratio',
                (
                    'Performance warning: exit price is extremely far from '
                    'entry price; splits, rebases, adjusted data, or price '
                    'units may be distorting model P/L.'
                ),
                tickers,
                metric='exitToEntryPriceRatio',
                value=ratio,
                threshold=sanity.extreme_price_ratio,
            )
        )
    return warnings

def _strategy_tickers(strategy: dict[str, Any]) -> list[str]:
    tickers: list[str] = []
    for collection in ('virtualPositions', 'closedVirtualTrades', 'events'):
        for item in strategy.get(collection, []):
            for key in ('signalTicker', 'executionTicker'):
                value = item.get(key)
                if isinstance(value, str) and value:
                    tickers.append(value)
    return sorted(set(tickers))

def _looks_leveraged(ticker: str) -> bool:
    upper = ticker.upper()
    return (
        upper.startswith('3')
        or upper.endswith('3.L')
        or '3X' in upper
        or 'LEVERAGED' in upper
    )

def _float_or_none(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and result not in {float('inf'), float('-inf')} else None

def _price_ratio(left: Any, right: Any) -> float | None:
    first = _float_or_none(left)
    second = _float_or_none(right)
    if first is None or second is None or first <= 0 or second <= 0:
        return None
    return max(first, second) / min(first, second)

def _sma_effective_rows(config: Any) -> tuple[list[WatchlistRow], bool]:
    enabled_watchlist = [row for row in config.watchlist if row.enabled]
    if config.watchlist:
        return (enabled_watchlist, False)
    if config.reference_ticker and config.risk_on_ticker:
        return (
            [
                WatchlistRow(
                    signal_ticker=config.reference_ticker,
                    execution_ticker=config.risk_on_ticker,
                    enabled=True,
                    allocation_weight=1,
                )
            ],
            True,
        )
    return ([], False)

def _scan_sma_row(
    config: Any,
    row: WatchlistRow,
    row_capital: float,
    reference: list[PriceBar],
    price_histories: dict[str, list[PriceBar]],
    risk_off_ticker: str | None,
) -> dict[str, Any]:
    cash = row_capital
    state = 'risk_off'
    current_ticker: str | None = None
    quantity = 0.0
    entry_price: float | None = None
    entry_date: date | None = None
    allocation = 0.0
    last_cost_accrual_date: date | None = None
    total_cost = 0.0
    closed: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    equity: list[dict[str, Any]] = []
    last_distance = 0.0
    last_evaluated_period: str | None = None
    execution_bars = price_histories.get(row.execution_ticker, [])
    if not reference or not execution_bars:
        return _empty_sma_row_result(row, cash, reference[-1].day if reference else None)
    evaluation_points = _sma_evaluation_points(
        reference,
        config.sma_length,
        config.review_cadence,
    )
    if not evaluation_points:
        return _empty_sma_row_result(row, cash, reference[-1].day)
    row_key = _row_key(row)
    for index, period_key in evaluation_points:
        day = reference[index].day
        average = _sma_at(reference, index, config.sma_length)
        if average is None:
            continue
        distance = (reference[index].close / average - 1) * 100
        last_distance = distance
        last_evaluated_period = period_key
        if current_ticker and quantity > 0:
            quantity, last_cost_accrual_date, accrued = _accrue_cost(
                quantity,
                current_ticker,
                last_cost_accrual_date,
                day,
                price_histories,
                config.annual_instrument_cost_percent,
            )
            total_cost += accrued
        desired = state
        if distance >= config.risk_on_threshold_percent:
            desired = 'risk_on'
        elif distance <= config.risk_off_threshold_percent:
            desired = 'risk_off'
        desired_ticker = row.execution_ticker if desired == 'risk_on' else risk_off_ticker
        if desired != state or desired_ticker != current_ticker:
            if current_ticker and quantity > 0 and entry_price is not None:
                price_bar = _price_on_or_before(price_histories[current_ticker], day)
                if price_bar is not None:
                    proceeds = quantity * price_bar.close
                    proceeds -= proceeds * config.transaction_cost_percent / 100
                    pnl = proceeds - allocation
                    closed.append(
                        {
                            'positionId': event_id(
                                SMA_ID,
                                'position',
                                entry_date.isoformat() if entry_date else day.isoformat(),
                                row_key,
                            ),
                            'label': 'Virtual model position',
                            'signalTicker': row.signal_ticker,
                            'executionTicker': current_ticker,
                            'state': 'closed',
                            'entryTimestamp': entry_date.isoformat()
                            if entry_date
                            else None,
                            'entryPrice': entry_price,
                            'exitTimestamp': day.isoformat(),
                            'exitPrice': price_bar.close,
                            'quantity': quantity,
                            'allocation': allocation,
                            'pnlValue': pnl,
                            'pnlPercent': pnl / max(allocation, 1e-06) * 100,
                            'exitReason': (
                                f'{row.signal_ticker} SMA regime changed to '
                                f"{desired.replace('_', ' ')}."
                            ),
                        }
                    )
                    cash = proceeds
                quantity = 0.0
                entry_price = None
                entry_date = None
                allocation = 0.0
                last_cost_accrual_date = None
            state = desired
            current_ticker = desired_ticker
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
            identifier = event_id(SMA_ID, desired, day.isoformat(), row_key)
            events.append(
                _event(
                    identifier,
                    SMA_ID,
                    'entry' if desired == 'risk_on' else 'exit',
                    day.isoformat(),
                    row.signal_ticker,
                    desired_ticker or row.execution_ticker,
                    (
                        f'{row.signal_ticker} closed {distance:.2f}% from its '
                        f'{config.sma_length}-day average; model '
                        f"{'holds ' + row.execution_ticker if desired == 'risk_on' else 'moves to cash'}."
                    ),
                )
            )
        invested = _position_value(price_histories, current_ticker, quantity, day)
        equity.append({'date': day.isoformat(), 'value': cash + invested})
    latest_reference_day = reference[-1].day
    if current_ticker and quantity > 0:
        quantity, last_cost_accrual_date, accrued = _accrue_cost(
            quantity,
            current_ticker,
            last_cost_accrual_date,
            latest_reference_day,
            price_histories,
            config.annual_instrument_cost_percent,
        )
        total_cost += accrued
    invested = _position_value(price_histories, current_ticker, quantity, latest_reference_day)
    if equity and equity[-1]['date'] != latest_reference_day.isoformat():
        equity.append({'date': latest_reference_day.isoformat(), 'value': cash + invested})
    latest_bar = (
        _price_on_or_before(price_histories[current_ticker], latest_reference_day)
        if current_ticker
        else None
    )
    positions = [
        {
            'positionId': event_id(
                SMA_ID,
                'position',
                entry_date.isoformat() if entry_date else latest_reference_day.isoformat(),
                row_key,
            ),
            'label': 'Virtual model position',
            'signalTicker': row.signal_ticker,
            'executionTicker': current_ticker,
            'state': state,
            'entryTimestamp': entry_date.isoformat() if entry_date else None,
            'entryPrice': entry_price,
            'latestPrice': latest_bar.close if latest_bar else None,
            'quantity': quantity,
            'allocation': allocation,
            'openPnlValue': invested - allocation,
            'openPnlPercent': (invested / max(allocation, 1e-06) - 1) * 100,
            'daysHeld': (latest_reference_day - entry_date).days
            if entry_date
            else 0,
            'latestSignal': state,
            'reason': f'{row.signal_ticker} is {last_distance:.2f}% from SMA{config.sma_length}.',
        }
    ] if current_ticker and quantity > 0 else []
    return {
        'row': row,
        'cash': cash,
        'investedValue': invested,
        'state': state,
        'positions': positions,
        'closed': closed,
        'events': events,
        'equity': _dedupe_equity(equity),
        'dataFreshness': latest_reference_day.isoformat(),
        'lastEvaluatedMarketPeriod': last_evaluated_period,
        'lastCostAccrualDate': last_cost_accrual_date.isoformat()
        if last_cost_accrual_date
        else None,
        'totalInstrumentCost': total_cost,
        'warnings': [],
    }

def _empty_sma_row_result(
    row: WatchlistRow,
    cash: float,
    freshness_day: date | None,
) -> dict[str, Any]:
    return {
        'row': row,
        'cash': cash,
        'investedValue': 0.0,
        'state': 'awaiting_data',
        'positions': [],
        'closed': [],
        'events': [],
        'equity': [],
        'dataFreshness': freshness_day.isoformat() if freshness_day else None,
        'lastEvaluatedMarketPeriod': None,
        'lastCostAccrualDate': None,
        'totalInstrumentCost': 0.0,
        'warnings': [],
    }

def _combine_sma_equity(row_results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    all_dates = sorted(
        {
            item['date']
            for result in row_results
            for item in result['equity']
        }
    )
    latest_values = [float(result['cash']) for result in row_results]
    by_row = [
        {item['date']: float(item['value']) for item in result['equity']}
        for result in row_results
    ]
    combined: list[dict[str, Any]] = []
    for current_date in all_dates:
        for index, row_values in enumerate(by_row):
            if current_date in row_values:
                latest_values[index] = row_values[current_date]
        combined.append({'date': current_date, 'value': sum(latest_values)})
    return combined

def _sma_book_state(row_results: list[dict[str, Any]]) -> str:
    active = sum(1 for item in row_results if item['positions'])
    if active == 0:
        return 'risk_off'
    if active == len(row_results):
        return 'risk_on'
    return 'mixed'

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
