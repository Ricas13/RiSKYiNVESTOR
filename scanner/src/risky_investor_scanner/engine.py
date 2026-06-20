from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import hashlib

from .calculations import simple_moving_average, supertrend
from .config import ScannerConfig
from .market_data import CsvMarketDataProvider, PriceBar
from .storage import atomic_write_json, read_json


SUPER_ID = "daily-supertrend"
SMA_ID = "nasdaq-sma200-3x"


def event_id(strategy_id: str, event_type: str, date: str, ticker: str) -> str:
    material = f"{strategy_id}|{event_type}|{date}|{ticker}".encode()
    return f"{strategy_id}:{hashlib.sha256(material).hexdigest()[:24]}"


def _empty_strategy(
    strategy_id: str,
    name: str,
    enabled: bool,
    summary: str,
    parameters: dict[str, Any],
    configured: bool = True,
) -> dict[str, Any]:
    return {
        "strategyId": strategy_id,
        "name": name,
        "enabled": enabled,
        "configured": configured,
        "status": "disabled" if not enabled else "awaiting_data",
        "ruleSummary": summary,
        "parameters": parameters,
        "currentState": "disabled" if not enabled else "awaiting_data",
        "modelValue": None,
        "returnPercent": None,
        "drawdownPercent": None,
        "exposurePercent": 0,
        "equitySnapshots": [],
        "virtualPositions": [],
        "closedVirtualTrades": [],
        "events": [],
        "latestEvent": None,
        "dataFreshness": None,
    }


class ScannerEngine:
    def __init__(
        self,
        config: ScannerConfig,
        provider: CsvMarketDataProvider,
        state_dir: Path,
        output_dir: Path,
    ) -> None:
        self.config = config
        self.provider = provider
        self.state_dir = state_dir
        self.output_dir = output_dir
        self.state_path = state_dir / "model_state_v1.json"
        self.state: dict[str, Any] = read_json(
            self.state_path,
            {"version": 1, "strategies": {}, "eventIds": []},
        )

    def _known_event_ids(self) -> set[str]:
        return set(self.state.get("eventIds", []))

    def _persist(self, snapshot: dict[str, Any]) -> None:
        self.state["eventIds"] = sorted(
            {
                event["eventId"]
                for strategy in snapshot["strategies"]
                for event in strategy["events"]
            }
            | self._known_event_ids()
        )[-10000:]
        atomic_write_json(self.state_path, self.state)
        atomic_write_json(
            self.output_dir / "multi_strategy_v1.json",
            snapshot,
        )

    def scan(self, rebuild_history: bool = False) -> dict[str, Any]:
        if rebuild_history:
            self.state = {"version": 1, "strategies": {}, "eventIds": []}
        generated_at = datetime.now(timezone.utc).isoformat()
        errors: list[dict[str, str]] = []
        strategies: list[dict[str, Any]] = []
        for builder in (self._scan_supertrend, self._scan_sma):
            try:
                strategies.append(builder())
            except Exception as error:
                strategy_id = SUPER_ID if builder == self._scan_supertrend else SMA_ID
                safe_message = (
                    f"{type(error).__name__}: strategy scan failed safely; "
                    "durable state was preserved."
                )
                errors.append(
                    {
                        "strategyId": strategy_id,
                        "message": safe_message,
                    }
                )
                strategies.append(
                    _empty_strategy(
                        strategy_id,
                        "Daily SuperTrend"
                        if strategy_id == SUPER_ID
                        else "Nasdaq SMA200 Regime — 3x",
                        True,
                        "Scanner error; previous durable state was preserved.",
                        {},
                    )
                )
                strategies[-1]["status"] = "error"
                scanner_error = _event(
                    event_id(
                        strategy_id,
                        "scannerError",
                        generated_at[:10],
                        "SCANNER",
                    ),
                    strategy_id,
                    "scannerError",
                    generated_at,
                    "SCANNER",
                    "SCANNER",
                    safe_message,
                )
                strategies[-1]["events"] = [scanner_error]
                strategies[-1]["latestEvent"] = scanner_error
        has_strategy_errors = bool(errors)
        cache_fallbacks = sorted(
            getattr(self.provider, "cache_fallbacks", set())
        )
        if cache_fallbacks:
            errors.append(
                {
                    "message": (
                        "Cached market data used after a bounded provider "
                        f"failure: {', '.join(cache_fallbacks)}."
                    )
                }
            )
        enabled = [item for item in strategies if item["enabled"]]
        freshness_values = [
            item["dataFreshness"]
            for item in enabled
            if item.get("dataFreshness")
        ]
        latest_freshness = max(freshness_values) if freshness_values else None
        stale = False
        if latest_freshness:
            try:
                stale = (
                    datetime.now(timezone.utc)
                    - datetime.fromisoformat(latest_freshness).replace(
                        tzinfo=timezone.utc
                    )
                ) > timedelta(days=4)
            except ValueError:
                stale = True
        status = (
            "error"
            if has_strategy_errors
            else "not_configured"
            if not enabled
            else "degraded"
            if cache_fallbacks
            else "stale"
            if stale
            else "current"
        )
        snapshot = {
            "schemaVersion": "multi_strategy_v1",
            "generatedAt": generated_at,
            "scanner": {
                "name": "RiSKYiNVESTOR integrated scanner",
                "version": "1.0.0",
                "status": status,
                "errors": errors,
                "dataFreshness": {
                    "generatedAt": latest_freshness or generated_at,
                    "staleAfterMinutes": 5_760,
                },
            },
            "strategies": strategies,
        }
        self._persist(snapshot)
        return snapshot

    def _fetch(self, ticker: str) -> list[PriceBar]:
        return sorted(self.provider.fetch(ticker), key=lambda bar: bar.day)

    def _scan_supertrend(self) -> dict[str, Any]:
        config = self.config.supertrend
        parameters = {
            "timeframe": config.timeframe,
            "atrPeriod": config.atr_period,
            "multiplier": config.multiplier,
            "modelStartingCapital": config.model_starting_capital,
            "allocationPolicy": config.allocation_policy,
            "maximumConcurrentPositions": config.maximum_concurrent_positions,
            "transactionCostPercent": config.transaction_cost_percent,
            "watchlist": [
                {
                    "signalTicker": row.signal_ticker,
                    "executionTicker": row.execution_ticker,
                    "enabled": row.enabled,
                    "allocationWeight": row.allocation_weight,
                }
                for row in config.watchlist
            ],
        }
        result = _empty_strategy(
            SUPER_ID,
            "Daily SuperTrend",
            config.enabled,
            (
                f"Daily SuperTrend using ATR {config.atr_period} and "
                f"{config.multiplier:g}× multiplier. Each valid transition is "
                "tracked in its independent virtual strategy book."
            ),
            parameters,
            configured=any(
                row.signal_ticker and row.execution_ticker
                for row in config.watchlist
            ),
        )
        if not config.enabled:
            return result
        durable = self.state.setdefault("strategies", {}).setdefault(
            SUPER_ID,
            {
                "capital": config.model_starting_capital,
                "cash": config.model_starting_capital,
                "positions": {},
                "closed": [],
                "equity": [],
                "events": [],
            },
        )
        known = self._known_event_ids()
        enabled_rows = [row for row in config.watchlist if row.enabled]
        total_weight = sum(row.allocation_weight for row in enabled_rows) or 1
        current_positions = durable["positions"]
        for row in enabled_rows:
            signal_bars = self._fetch(row.signal_ticker)
            execution_bars = self._fetch(row.execution_ticker)
            points = supertrend(
                signal_bars, config.atr_period, config.multiplier
            )
            if not points or not execution_bars:
                continue
            latest = points[-1]
            previous = points[-2] if len(points) > 1 else None
            execution_price = execution_bars[-1].close
            position = current_positions.get(row.execution_ticker)
            transition = (
                previous is not None and previous.state != latest.state
            )
            if transition and latest.state == "in" and position is None:
                open_count = len(current_positions)
                if open_count < config.maximum_concurrent_positions:
                    allocation = (
                        config.model_starting_capital
                        * row.allocation_weight
                        / total_weight
                    )
                    cost = allocation * config.transaction_cost_percent / 100
                    quantity = max(0, (allocation - cost) / execution_price)
                    position = {
                        "positionId": event_id(
                            SUPER_ID,
                            "position",
                            latest.date,
                            row.execution_ticker,
                        ),
                        "label": "Virtual model position",
                        "signalTicker": row.signal_ticker,
                        "executionTicker": row.execution_ticker,
                        "state": "in",
                        "entryTimestamp": latest.date,
                        "entryPrice": execution_price,
                        "latestPrice": execution_price,
                        "quantity": quantity,
                        "allocation": allocation,
                        "latestSignal": "entry",
                        "reason": "SuperTrend changed from out to in.",
                    }
                    current_positions[row.execution_ticker] = position
                    durable["cash"] -= allocation
                    identifier = event_id(
                        SUPER_ID, "entry", latest.date, row.execution_ticker
                    )
                    if identifier not in known:
                        durable["events"].append(
                            _event(
                                identifier,
                                SUPER_ID,
                                "entry",
                                latest.date,
                                row.signal_ticker,
                                row.execution_ticker,
                                "SuperTrend changed from out to in.",
                            )
                        )
            elif transition and latest.state == "out" and position is not None:
                proceeds = position["quantity"] * execution_price
                cost = proceeds * config.transaction_cost_percent / 100
                proceeds -= cost
                pnl = proceeds - position["allocation"]
                durable["cash"] += proceeds
                durable["closed"].append(
                    {
                        **position,
                        "state": "closed",
                        "exitTimestamp": latest.date,
                        "exitPrice": execution_price,
                        "pnlValue": pnl,
                        "pnlPercent": pnl
                        / max(position["allocation"], 0.000001)
                        * 100,
                        "exitReason": "SuperTrend changed from in to out.",
                    }
                )
                del current_positions[row.execution_ticker]
                identifier = event_id(
                    SUPER_ID, "exit", latest.date, row.execution_ticker
                )
                if identifier not in known:
                    durable["events"].append(
                        _event(
                            identifier,
                            SUPER_ID,
                            "exit",
                            latest.date,
                            row.signal_ticker,
                            row.execution_ticker,
                            "SuperTrend changed from in to out.",
                        )
                    )
            if position := current_positions.get(row.execution_ticker):
                position["latestPrice"] = execution_price
                position["openPnlValue"] = (
                    execution_price - position["entryPrice"]
                ) * position["quantity"]
                position["openPnlPercent"] = (
                    execution_price / position["entryPrice"] - 1
                ) * 100
                position["daysHeld"] = (
                    execution_bars[-1].day
                    - datetime.fromisoformat(
                        position["entryTimestamp"]
                    ).date()
                ).days

        invested = sum(
            item["quantity"] * item["latestPrice"]
            for item in current_positions.values()
        )
        model_value = durable["cash"] + invested
        durable["equity"].append(
            {
                "date": datetime.now(timezone.utc).date().isoformat(),
                "value": model_value,
            }
        )
        durable["equity"] = _dedupe_equity(durable["equity"])
        peak = max(item["value"] for item in durable["equity"])
        result.update(
            {
                "status": "current",
                "currentState": (
                    "in_market" if current_positions else "out_of_market"
                ),
                "modelValue": model_value,
                "returnPercent": (
                    model_value / config.model_starting_capital - 1
                )
                * 100,
                "drawdownPercent": (model_value / peak - 1) * 100,
                "exposurePercent": invested / max(model_value, 0.000001) * 100,
                "equitySnapshots": durable["equity"],
                "virtualPositions": list(current_positions.values()),
                "closedVirtualTrades": durable["closed"],
                "events": durable["events"],
                "latestEvent": durable["events"][-1]
                if durable["events"]
                else None,
                "dataFreshness": datetime.now(timezone.utc).isoformat(),
            }
        )
        return result

    def _scan_sma(self) -> dict[str, Any]:
        config = self.config.sma
        parameters = {
            "referenceTicker": config.reference_ticker,
            "riskOnTicker": config.risk_on_ticker,
            "riskOffMode": config.risk_off_mode,
            "riskOffTicker": config.risk_off_ticker,
            "smaLength": config.sma_length,
            "reviewCadence": config.review_cadence,
            "riskOnThresholdPercent": config.risk_on_threshold_percent,
            "riskOffThresholdPercent": config.risk_off_threshold_percent,
            "modelStartingCapital": config.model_starting_capital,
            "transactionCostPercent": config.transaction_cost_percent,
            "annualInstrumentCostPercent": config.annual_instrument_cost_percent,
        }
        result = _empty_strategy(
            SMA_ID,
            "Nasdaq SMA200 Regime — 3x",
            config.enabled,
            (
                f"Independent {config.sma_length}-day SMA regime. Risk-on "
                "and risk-off thresholds are evaluated only on the configured "
                f"{config.review_cadence} cadence."
            ),
            parameters,
            configured=bool(config.reference_ticker and config.risk_on_ticker),
        )
        if not config.enabled:
            return result
        reference = self._fetch(config.reference_ticker)
        risk_on = self._fetch(config.risk_on_ticker)
        average = simple_moving_average(reference, config.sma_length)
        if average is None or not risk_on:
            return result
        reference_price = reference[-1].close
        distance = (reference_price / average - 1) * 100
        durable = self.state.setdefault("strategies", {}).setdefault(
            SMA_ID,
            {
                "state": "risk_off",
                "regimeStartDate": None,
                "cash": config.model_starting_capital,
                "quantity": 0.0,
                "entryPrice": None,
                "equity": [],
                "events": [],
                "closed": [],
            },
        )
        durable.setdefault("closed", [])
        desired = durable["state"]
        if distance >= config.risk_on_threshold_percent:
            desired = "risk_on"
        elif distance <= config.risk_off_threshold_percent:
            desired = "risk_off"
        execution_ticker = (
            config.risk_on_ticker
            if desired == "risk_on"
            else config.risk_off_ticker
            if config.risk_off_mode == "instrument"
            else None
        )
        execution_price = (
            self._fetch(execution_ticker)[-1].close
            if execution_ticker
            else None
        )
        today = reference[-1].day.isoformat()
        if desired != durable["state"]:
            if durable["quantity"] and durable["entryPrice"]:
                current_ticker = (
                    config.risk_on_ticker
                    if durable["state"] == "risk_on"
                    else config.risk_off_ticker
                )
                current_price = self._fetch(current_ticker)[-1].close
                proceeds = durable["quantity"] * current_price
                proceeds -= proceeds * config.transaction_cost_percent / 100
                invested_cost = durable["quantity"] * durable["entryPrice"]
                pnl = proceeds - invested_cost
                durable["closed"].append(
                    {
                        "positionId": event_id(
                            SMA_ID,
                            "position",
                            durable["regimeStartDate"] or today,
                            current_ticker or "CASH",
                        ),
                        "label": "Virtual model position",
                        "signalTicker": config.reference_ticker,
                        "executionTicker": current_ticker or "CASH",
                        "state": "closed",
                        "entryTimestamp": durable["regimeStartDate"],
                        "entryPrice": durable["entryPrice"],
                        "exitTimestamp": today,
                        "exitPrice": current_price,
                        "quantity": durable["quantity"],
                        "allocation": invested_cost,
                        "pnlValue": pnl,
                        "pnlPercent": pnl / max(invested_cost, 0.000001) * 100,
                        "exitReason": (
                            f"SMA regime changed to "
                            f"{desired.replace('_', ' ')}."
                        ),
                    }
                )
                durable["cash"] = proceeds
                durable["quantity"] = 0
                durable["entryPrice"] = None
            if execution_price:
                cost = durable["cash"] * config.transaction_cost_percent / 100
                durable["quantity"] = (
                    durable["cash"] - cost
                ) / execution_price
                durable["entryPrice"] = execution_price
                durable["cash"] = 0
            durable["state"] = desired
            durable["regimeStartDate"] = today
            identifier = event_id(SMA_ID, desired, today, execution_ticker or "cash")
            if identifier not in self._known_event_ids():
                durable["events"].append(
                    _event(
                        identifier,
                        SMA_ID,
                        "entry" if desired == "risk_on" else "exit",
                        today,
                        config.reference_ticker,
                        execution_ticker or "CASH",
                        (
                            f"Reference closed {distance:.2f}% from its "
                            f"{config.sma_length}-day average; regime changed "
                            f"to {desired.replace('_', ' ')}."
                        ),
                    )
                )
        invested = (
            durable["quantity"] * execution_price
            if execution_price and durable["quantity"]
            else 0
        )
        model_value = durable["cash"] + invested
        daily_cost = (
            invested * config.annual_instrument_cost_percent / 100 / 365
        )
        model_value -= daily_cost
        durable["equity"].append({"date": today, "value": model_value})
        durable["equity"] = _dedupe_equity(durable["equity"])
        peak = max(item["value"] for item in durable["equity"])
        position = (
            [
                {
                    "positionId": f"{SMA_ID}:current",
                    "label": "Virtual model position",
                    "signalTicker": config.reference_ticker,
                    "executionTicker": execution_ticker,
                    "state": desired,
                    "entryTimestamp": durable["regimeStartDate"],
                    "entryPrice": durable["entryPrice"],
                    "latestPrice": execution_price,
                    "quantity": durable["quantity"],
                    "allocation": invested,
                    "openPnlValue": (
                        execution_price - durable["entryPrice"]
                    )
                    * durable["quantity"]
                    if execution_price and durable["entryPrice"]
                    else 0,
                    "openPnlPercent": (
                        execution_price / durable["entryPrice"] - 1
                    )
                    * 100
                    if execution_price and durable["entryPrice"]
                    else 0,
                    "daysHeld": (
                        reference[-1].day
                        - datetime.fromisoformat(
                            durable["regimeStartDate"]
                        ).date()
                    ).days
                    if durable["regimeStartDate"]
                    else 0,
                    "latestSignal": desired,
                    "reason": (
                        f"Reference is {distance:.2f}% from SMA"
                        f"{config.sma_length}."
                    ),
                }
            ]
            if execution_ticker and durable["quantity"]
            else []
        )
        result.update(
            {
                "status": "current",
                "currentState": desired,
                "regimeStartDate": durable["regimeStartDate"],
                "referenceTicker": config.reference_ticker,
                "executionTicker": execution_ticker or "CASH",
                "modelValue": model_value,
                "cash": durable["cash"],
                "investedValue": invested,
                "returnPercent": (
                    model_value / config.model_starting_capital - 1
                )
                * 100,
                "drawdownPercent": (model_value / peak - 1) * 100,
                "exposurePercent": invested / max(model_value, 0.000001) * 100,
                "equitySnapshots": durable["equity"],
                "virtualPositions": position,
                "closedVirtualTrades": durable["closed"],
                "events": durable["events"],
                "regimeChangeEvents": durable["events"],
                "latestEvent": durable["events"][-1]
                if durable["events"]
                else None,
                "dataFreshness": reference[-1].day.isoformat(),
            }
        )
        return result


def _event(
    identifier: str,
    strategy_id: str,
    event_type: str,
    occurred_at: str,
    signal_ticker: str,
    execution_ticker: str,
    reason: str,
) -> dict[str, Any]:
    return {
        "eventId": identifier,
        "strategyId": strategy_id,
        "eventType": event_type,
        "occurredAt": occurred_at,
        "signalTicker": signal_ticker,
        "executionTicker": execution_ticker,
        "reason": reason,
    }


def _dedupe_equity(values: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date = {str(item["date"]): item for item in values}
    return [by_date[key] for key in sorted(by_date)][-5000:]
