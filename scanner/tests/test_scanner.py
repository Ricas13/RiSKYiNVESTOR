from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import json

import pytest

from risky_investor_scanner import engine as engine_module
from risky_investor_scanner.calculations import (
    SuperTrendPoint,
    adaptive_supertrend_factor,
    atr_rma,
    rma,
    simple_moving_average,
    supertrend,
)
from risky_investor_scanner.config import ConfigurationError, validate_config
from risky_investor_scanner.engine import ScannerEngine
from risky_investor_scanner.market_data import PriceBar
from risky_investor_scanner.storage import atomic_write_json


def bars(values: list[float], start: date = date(2024, 1, 1)) -> list[PriceBar]:
    return [
        PriceBar(
            day=start + timedelta(days=index),
            open=value,
            high=value + 1,
            low=value - 1,
            close=value,
            volume=1_000_000,
        )
        for index, value in enumerate(values)
    ]


def weekday_bars(
    values: list[float], start: date = date(2024, 1, 1)
) -> list[PriceBar]:
    result: list[PriceBar] = []
    current = start
    for value in values:
        while current.weekday() >= 5:
            current += timedelta(days=1)
        result.append(
            PriceBar(
                day=current,
                open=value,
                high=value + 1,
                low=value - 1,
                close=value,
                volume=1_000_000,
            )
        )
        current += timedelta(days=1)
    return result


def marker_bars(marker: int, length: int = 6) -> list[PriceBar]:
    values = [float(marker + index) for index in range(length)]
    return bars(values)


def configuration(
    super_enabled=True,
    sma_enabled=True,
    *,
    watchlist: list[dict[str, object]] | None = None,
    allocation_policy="equal_weight",
    maximum_concurrent_positions=2,
    supertrend_capital=10_000,
    supertrend_cost=0.1,
    sma_review_cadence="daily",
    sma_annual_cost=0.75,
    sma_transaction_cost=0.1,
    sma_watchlist: list[dict[str, object]] | None = None,
):
    return {
        "version": 1,
        "marketData": {
            "provider": "url_template_csv",
            "urlTemplate": "https://prices.invalid/{ticker}.csv",
            "timeoutSeconds": 5,
            "maximumRetries": 0,
        },
        "strategies": {
            "dailySuperTrend": {
                "enabled": super_enabled,
                "timeframe": "1d",
                "atrPeriod": 3,
                "multiplier": 2,
                "smoothing": "RMA",
                "switchStoploss": False,
                "referenceTimeframe": "D",
                "useConfirmed": True,
                "modelStartingCapital": supertrend_capital,
                "allocationPolicy": allocation_policy,
                "maximumConcurrentPositions": maximum_concurrent_positions,
                "transactionCostPercent": supertrend_cost,
                "watchlist": watchlist
                if watchlist is not None
                else [
                    {
                        "signalTicker": "SIGNAL",
                        "executionTicker": "EXEC",
                        "enabled": True,
                        "allocationWeight": 1,
                    }
                ],
            },
            "nasdaqSma200": {
                "enabled": sma_enabled,
                "referenceTicker": "REFERENCE",
                "riskOnTicker": "RISKON",
                "watchlist": sma_watchlist if sma_watchlist is not None else [],
                "riskOffMode": "cash",
                "riskOffTicker": "",
                "smaLength": 3,
                "reviewCadence": sma_review_cadence,
                "riskOnThresholdPercent": 0,
                "riskOffThresholdPercent": 0,
                "modelStartingCapital": 20_000,
                "transactionCostPercent": sma_transaction_cost,
                "annualInstrumentCostPercent": sma_annual_cost,
            },
        },
    }


class Provider:
    def __init__(self):
        self.values = {
            "SIGNAL": bars([12, 11, 10, 9, 15, 16, 17]),
            "EXEC": bars([10, 10, 10, 10, 12, 13, 14]),
            "REFERENCE": bars([10, 10, 10, 12, 13]),
            "RISKON": bars([10, 10, 10, 11, 12]),
            "REFA": bars([10, 10, 10, 12, 13]),
            "EXEA": bars([100, 100, 100, 110, 120]),
            "REFB": bars([20, 20, 20, 24, 25]),
            "EXEB": bars([50, 50, 50, 55, 60]),
        }

    def fetch(self, ticker):
        return self.values[ticker]


def strategy(snapshot, strategy_id):
    return next(
        item for item in snapshot["strategies"] if item["strategyId"] == strategy_id
    )


def event_types(item):
    return [event["eventType"] for event in item["events"]]


def patch_supertrend(monkeypatch, states_by_marker: dict[int, list[str]]):
    def fake_supertrend(signal_bars, _atr_period, _multiplier=None, **_kwargs):
        marker = int(signal_bars[0].close)
        states = states_by_marker.get(marker, ["out"] * len(signal_bars))
        return [
            SuperTrendPoint(
                date=signal_bars[index].day.isoformat(),
                close=signal_bars[index].close,
                value=signal_bars[index].close,
                state=state,
            )
            for index, state in enumerate(states)
        ]

    monkeypatch.setattr(engine_module, "supertrend", fake_supertrend)


def test_configuration_validation_and_disabled_behavior(tmp_path):
    valid = validate_config(configuration())
    assert valid.supertrend.enabled is True
    assert valid.supertrend.atr_period == 3
    assert valid.supertrend.smoothing == "RMA"
    assert valid.supertrend.switch_stoploss is False
    assert valid.supertrend.reference_timeframe == "D"
    assert valid.supertrend.use_confirmed is True
    assert valid.sma.sma_length == 3
    assert valid.sma.watchlist == ()
    multi_sma = validate_config(
        configuration(
            sma_watchlist=[
                {
                    "signalTicker": "REFA",
                    "executionTicker": "EXEA",
                    "enabled": True,
                    "allocationWeight": 1,
                },
                {
                    "signalTicker": "REFB",
                    "executionTicker": "EXEB",
                    "enabled": True,
                    "allocationWeight": 1,
                },
            ]
        )
    )
    assert [row.signal_ticker for row in multi_sma.sma.watchlist] == [
        "REFA",
        "REFB",
    ]
    invalid = configuration()
    invalid["strategies"]["nasdaqSma200"]["riskOffMode"] = "instrument"
    with pytest.raises(ConfigurationError):
        validate_config(invalid)
    invalid_sma_watchlist = configuration()
    invalid_sma_watchlist["strategies"]["nasdaqSma200"]["watchlist"] = [
        {
            "signalTicker": "REFA",
            "executionTicker": "EXEA",
            "enabled": False,
            "allocationWeight": 1,
        }
    ]
    with pytest.raises(ConfigurationError, match="enabled watchlist row"):
        validate_config(invalid_sma_watchlist)
    disabled = validate_config(configuration(False, False))
    snapshot = ScannerEngine(
        disabled, Provider(), tmp_path / "state", tmp_path / "output"
    ).scan()
    assert snapshot["scanner"]["status"] == "not_configured"
    assert all(item["status"] == "disabled" for item in snapshot["strategies"])
    incomplete = configuration(False, False)
    incomplete["strategies"]["dailySuperTrend"] = {"enabled": False}
    incomplete["strategies"]["nasdaqSma200"] = {"enabled": False}
    disabled_incomplete = validate_config(incomplete)
    assert disabled_incomplete.supertrend.watchlist == ()
    assert disabled_incomplete.supertrend.atr_period == 20
    assert disabled_incomplete.supertrend.smoothing == "RMA"
    assert disabled_incomplete.sma.reference_ticker == ""


def test_calculations_and_isolated_lifecycles(tmp_path):
    assert simple_moving_average(bars([1, 2, 3, 4]), 3) == 3
    points = supertrend(bars([12, 11, 10, 9, 15, 16, 17]), 3, 2)
    assert points
    snapshot = ScannerEngine(
        validate_config(configuration()),
        Provider(),
        tmp_path / "state",
        tmp_path / "output",
    ).scan()
    by_id = {item["strategyId"]: item for item in snapshot["strategies"]}
    assert set(by_id) == {"daily-supertrend", "nasdaq-sma200-3x"}
    assert by_id["daily-supertrend"]["parameters"].get("smaLength") is None
    assert by_id["daily-supertrend"]["parameters"]["indicatorName"] == (
        "AdaptiveSuperTrendSignals"
    )
    assert by_id["daily-supertrend"]["parameters"]["tradingViewCompatible"] is True
    assert by_id["daily-supertrend"]["parameters"]["atrLength"] == 3
    assert by_id["daily-supertrend"]["parameters"]["smoothing"] == "RMA"
    assert by_id["daily-supertrend"]["parameters"]["switchStoploss"] is False
    assert by_id["daily-supertrend"]["parameters"]["referenceTimeframe"] == "D"
    assert by_id["daily-supertrend"]["parameters"]["useConfirmed"] is True
    assert by_id["nasdaq-sma200-3x"]["parameters"].get("atrPeriod") is None
    assert by_id["nasdaq-sma200-3x"]["currentState"] == "risk_on"


def test_tradingview_adaptive_supertrend_calculations():
    assert rma([1, 2, 3, 4], 3) == [None, None, 2, pytest.approx(2.6666666667)]
    sample = [
        PriceBar(
            day=date(2024, 1, 1) + timedelta(days=index),
            open=value,
            high=value + 1,
            low=value - 1,
            close=value,
            volume=1_000_000,
        )
        for index, value in enumerate([10, 11, 12, 13])
    ]
    assert atr_rma(sample, 3)[2] == pytest.approx(2)
    assert adaptive_supertrend_factor(1, 4, switch_stoploss=False) == (1.0, 5.0)
    assert adaptive_supertrend_factor(2, 4, switch_stoploss=False) == (3.0, 3.0)
    assert adaptive_supertrend_factor(3, 4, switch_stoploss=False) == (4.5, 1.5)
    assert adaptive_supertrend_factor(4, 4, switch_stoploss=False) == (5.0, 1.0)
    assert adaptive_supertrend_factor(1, 4, switch_stoploss=True) == (5.0, 5.0)


def test_tradingview_supertrend_direction_flips_and_dynamic_factors():
    signal_bars = [
        PriceBar(
            day=date(2024, 1, 1) + timedelta(days=index),
            open=close,
            high=high,
            low=low,
            close=close,
            volume=1_000_000,
        )
        for index, (high, low, close) in enumerate(
            [
                (10, 8, 9),
                (11, 9, 10),
                (12, 10, 11),
                (13, 11, 12),
                (14, 12, 13),
                (15, 13, 14),
                (30, 10, 29),
                (31, 29, 30),
                (32, 30, 31),
                (33, 31, 32),
                (34, 32, 33),
                (33, 12, 13),
                (14, 12, 13),
                (13, 11, 12),
            ]
        )
    ]
    points = supertrend(signal_bars, 3, smoothing="RMA", use_confirmed=False)
    states = [point.state for point in points]
    factors = {point.factor for point in points}

    assert "in" in states
    assert "out" in states
    assert any(
        previous.state == "out" and current.state == "in"
        for previous, current in zip(points, points[1:])
    )
    assert any(
        previous.state == "in" and current.state == "out"
        for previous, current in zip(points, points[1:])
    )
    assert len(factors) > 1
    assert all(point.direction < 0 for point in points if point.state == "in")
    assert all(point.direction > 0 for point in points if point.state == "out")


def test_supertrend_initialises_on_first_valid_atr_bar_like_tradingview():
    signal_bars = [
        PriceBar(
            day=date(2026, 2, 18) + timedelta(days=index),
            open=close,
            high=high,
            low=low,
            close=close,
            volume=1_000_000,
        )
        for index, (high, low, close) in enumerate(
            [
                (100, 98, 99),
                (101, 99, 100),
                (102, 100, 101),
                (103, 101, 102),
                (104, 102, 103),
            ]
        )
    ]
    points = supertrend(signal_bars, 3, smoothing="RMA", use_confirmed=False)

    assert points[0].date == "2026-02-20"
    assert points[0].prior_atr is None
    assert points[0].raw_multiplier == 1.0
    assert points[0].factor == 5.0
    assert points[0].direction == 1
    assert points[0].state == "out"
    assert points[1].prior_atr == pytest.approx(points[0].atr)


def test_supertrend_transition_diagnostics_include_tradingview_inputs(tmp_path):
    signal_bars = [
        PriceBar(
            day=date(2026, 2, 12) + timedelta(days=index),
            open=close,
            high=high,
            low=low,
            close=close,
            volume=1_000_000,
        )
        for index, (high, low, close) in enumerate(
            [
                (10, 8, 9),
                (11, 9, 10),
                (12, 10, 11),
                (13, 11, 12),
                (14, 12, 13),
                (15, 13, 14),
                (30, 10, 29),
                (31, 29, 30),
                (32, 30, 31),
                (33, 31, 32),
                (34, 32, 33),
                (33, 12, 13),
                (14, 12, 13),
                (13, 11, 12),
            ]
        )
    ]
    provider = Provider()
    provider.values = {
        "ARM": signal_bars,
        "3ARM.L": [
            PriceBar(
                day=bar.day,
                open=10,
                high=11,
                low=9,
                close=10 + index,
                volume=1_000_000,
            )
            for index, bar in enumerate(signal_bars)
        ],
    }
    config = validate_config(
        configuration(
            super_enabled=True,
            sma_enabled=False,
            watchlist=[
                {
                    "signalTicker": "ARM",
                    "executionTicker": "3ARM.L",
                    "enabled": True,
                    "allocationWeight": 1,
                }
            ],
            supertrend_cost=0,
        )
    )

    snapshot = ScannerEngine(
        config,
        provider,
        tmp_path / "diagnostic-state",
        tmp_path / "diagnostic-output",
    ).scan()
    diagnostics = strategy(snapshot, "daily-supertrend")["diagnostics"]

    assert diagnostics
    first = diagnostics[0]
    assert first["signalTicker"] == "ARM"
    assert first["executionTicker"] == "3ARM.L"
    assert first["previousState"] == "out"
    assert first["state"] == "in"
    assert first["flipToGreen"] is True
    assert first["currentATR"] is not None
    assert first["priorATR"] is not None
    assert first["rawMultiplier"] in {1.0, 1.5, 3.0, 5.0}
    assert first["currentFactor"] == pytest.approx(6.0 - first["rawMultiplier"])
    assert first["supertrend"] is not None
    assert first["direction"] == -1


def test_repeated_scan_has_no_duplicate_events_and_state_survives(tmp_path):
    config = validate_config(configuration())
    first = ScannerEngine(
        config, Provider(), tmp_path / "state", tmp_path / "output"
    ).scan()
    second = ScannerEngine(
        config, Provider(), tmp_path / "state", tmp_path / "output"
    ).scan()
    for strategy_id in {"daily-supertrend", "nasdaq-sma200-3x"}:
        first_events = strategy(first, strategy_id)["events"]
        second_events = strategy(second, strategy_id)["events"]
        assert [item["eventId"] for item in first_events] == [
            item["eventId"] for item in second_events
        ]
    assert (tmp_path / "state" / "model_state_v1.json").exists()


def test_supertrend_rebuild_replays_historical_entries_exits_and_skips_unsafe_current(
    tmp_path, monkeypatch
):
    patch_supertrend(
        monkeypatch,
        {
            101: ["out", "in", "out", "out", "out", "in"],
            202: ["out", "in", "in", "out", "out", "out"],
        },
    )
    provider = Provider()
    provider.values = {
        "SIGNAL": marker_bars(101, 6),
        "EXEC": marker_bars(202, 6),
    }
    config = validate_config(configuration(super_enabled=True, sma_enabled=False))
    first = ScannerEngine(
        config, provider, tmp_path / "state", tmp_path / "output"
    ).scan(rebuild_history=True)
    first_strategy = strategy(first, "daily-supertrend")
    assert event_types(first_strategy) == ["entry", "exit", "skipped_entry"]
    assert len(first_strategy["closedVirtualTrades"]) == 1
    assert first_strategy["virtualPositions"] == []
    skipped = first_strategy["events"][-1]
    assert skipped["signalDate"] == "2024-01-06"
    assert skipped["calculationTicker"] == "SIGNAL"
    assert skipped["holdSafetyTicker"] == "EXEC"
    assert skipped["sourceOfTruth"] is False
    assert skipped["severity"] == "diagnostic"
    assert skipped["reason"] == (
        "Signal ticker BUY skipped because execution ticker was already out/red."
    )

    repeated = ScannerEngine(
        config, provider, tmp_path / "state", tmp_path / "output"
    ).scan()
    rebuilt = ScannerEngine(
        config, provider, tmp_path / "state", tmp_path / "output"
    ).scan(rebuild_history=True)
    assert [
        event["eventId"]
        for event in strategy(repeated, "daily-supertrend")["events"]
    ] == [event["eventId"] for event in first_strategy["events"]]
    rebuilt_events = strategy(rebuilt, "daily-supertrend")["events"]
    assert [
        {key: value for key, value in event.items() if key != "generatedAt"}
        for event in rebuilt_events
    ] == [
        {key: value for key, value in event.items() if key != "generatedAt"}
        for event in first_strategy["events"]
    ]
    assert all(event["signalDate"] != event["generatedAt"][:10] for event in rebuilt_events)
    assert strategy(rebuilt, "daily-supertrend")["modelValue"] == pytest.approx(
        first_strategy["modelValue"]
    )


def test_supertrend_uses_signal_ticker_for_entries_and_execution_ticker_for_exits(
    tmp_path, monkeypatch
):
    patch_supertrend(
        monkeypatch,
        {
            301: ["out", "in", "in", "in", "in"],
            401: ["out", "in", "in", "out", "out"],
            302: ["out", "in", "in", "in", "in"],
            402: ["out", "out", "out", "out", "out"],
            303: ["out", "in", "in", "in", "in"],
            403: ["out", "in", "out", "out", "out"],
        },
    )
    provider = Provider()
    provider.values = {
        "GOOGL": marker_bars(301, 5),
        "3GOO.L": marker_bars(401, 5),
        "ARM": marker_bars(302, 5),
        "3ARM.L": marker_bars(402, 5),
        "SMH": marker_bars(303, 5),
        "3SMH.L": marker_bars(403, 5),
    }
    config = validate_config(
        configuration(
            super_enabled=True,
            sma_enabled=False,
            supertrend_cost=0,
            maximum_concurrent_positions=3,
            watchlist=[
                {
                    "signalTicker": "GOOGL",
                    "executionTicker": "3GOO.L",
                    "enabled": True,
                    "allocationWeight": 1,
                },
                {
                    "signalTicker": "ARM",
                    "executionTicker": "3ARM.L",
                    "enabled": True,
                    "allocationWeight": 1,
                },
                {
                    "signalTicker": "SMH",
                    "executionTicker": "3SMH.L",
                    "enabled": True,
                    "allocationWeight": 1,
                },
            ],
        )
    )

    snapshot = ScannerEngine(
        config, provider, tmp_path / "state", tmp_path / "output"
    ).scan(rebuild_history=True)
    supertrend_strategy = strategy(snapshot, "daily-supertrend")

    googl_events = [
        event
        for event in supertrend_strategy["events"]
        if event["signalTicker"] == "GOOGL"
    ]
    assert [event["eventType"] for event in googl_events] == ["entry", "exit"]
    assert googl_events[0]["calculationTicker"] == "GOOGL"
    assert googl_events[0]["signalDate"] == "2024-01-02"
    assert googl_events[0]["generatedAt"] == snapshot["generatedAt"]
    assert googl_events[0]["price"] == 402
    assert googl_events[0]["reason"] == (
        "SuperTrend BUY on signal ticker; opened leveraged execution ticker."
    )
    assert googl_events[1]["calculationTicker"] == "3GOO.L"
    assert googl_events[1]["signalDate"] == "2024-01-04"
    assert googl_events[1]["generatedAt"] == snapshot["generatedAt"]
    assert googl_events[1]["price"] == 404
    assert googl_events[1]["reason"] == (
        "SuperTrend SELL on execution ticker; closed leveraged position."
    )
    googl_chart = next(
        item
        for item in supertrend_strategy["chartData"]
        if item["executionTicker"] == "3GOO.L"
    )
    assert len(googl_chart["candles"]) == 5
    assert googl_chart["candles"][0]["date"] == "2024-01-01"

    googl_trade = next(
        trade
        for trade in supertrend_strategy["closedVirtualTrades"]
        if trade["signalTicker"] == "GOOGL"
    )
    assert googl_trade["executionTicker"] == "3GOO.L"
    assert googl_trade["entryPrice"] == 402
    assert googl_trade["exitPrice"] == 404
    assert googl_trade["exitTimestamp"] == "2024-01-04"
    assert googl_trade["pnlValue"] > 0

    arm_events = [
        event for event in supertrend_strategy["events"] if event["signalTicker"] == "ARM"
    ]
    assert [event["eventType"] for event in arm_events] == ["skipped_entry"]
    assert arm_events[0]["calculationTicker"] == "ARM"
    assert arm_events[0]["holdSafetyTicker"] == "3ARM.L"
    assert arm_events[0]["sourceOfTruth"] is False
    assert arm_events[0]["reason"] == (
        "Signal ticker BUY skipped because execution ticker was already out/red."
    )
    assert not any(
        position["signalTicker"] == "ARM"
        for position in supertrend_strategy["virtualPositions"]
    )

    smh_events = [
        event for event in supertrend_strategy["events"] if event["signalTicker"] == "SMH"
    ]
    assert [event["calculationTicker"] for event in smh_events] == ["SMH", "3SMH.L"]


def test_supertrend_gates_entries_by_execution_state_and_marks_skips(
    tmp_path, monkeypatch
):
    patch_supertrend(
        monkeypatch,
        {
            701: ["out", "out", "in", "in", "in"],
            801: ["out", "in", "out", "out", "out"],
            702: ["out", "out", "in", "in", "in"],
            802: ["out", "out", "out", "out", "out"],
            703: ["out", "in", "in", "in", "in"],
            803: ["out", "in", "out", "out", "out"],
            704: ["out", "in", "in", "in", "in"],
            804: ["out", "in", "in", "in", "in"],
        },
    )
    provider = Provider()
    provider.values = {
        "COIN": marker_bars(701, 5),
        "3CON.L": marker_bars(801, 5),
        "TSLA": marker_bars(702, 5),
        "3TSL.L": marker_bars(802, 5),
        "GOOGL": marker_bars(703, 5),
        "3GOO.L": marker_bars(803, 5),
        "SMH": marker_bars(704, 5),
        "3SMH.L": marker_bars(804, 5),
    }
    config = validate_config(
        configuration(
            super_enabled=True,
            sma_enabled=False,
            supertrend_cost=0,
            maximum_concurrent_positions=4,
            watchlist=[
                {
                    "signalTicker": "COIN",
                    "executionTicker": "3CON.L",
                    "enabled": True,
                    "allocationWeight": 1,
                },
                {
                    "signalTicker": "TSLA",
                    "executionTicker": "3TSL.L",
                    "enabled": True,
                    "allocationWeight": 1,
                },
                {
                    "signalTicker": "GOOGL",
                    "executionTicker": "3GOO.L",
                    "enabled": True,
                    "allocationWeight": 1,
                },
                {
                    "signalTicker": "SMH",
                    "executionTicker": "3SMH.L",
                    "enabled": True,
                    "allocationWeight": 1,
                },
            ],
        )
    )

    snapshot = ScannerEngine(
        config, provider, tmp_path / "state", tmp_path / "output"
    ).scan(rebuild_history=True)
    supertrend_strategy = strategy(snapshot, "daily-supertrend")

    by_signal = {
        ticker: [
            event
            for event in supertrend_strategy["events"]
            if event["signalTicker"] == ticker
        ]
        for ticker in {"COIN", "TSLA", "GOOGL", "SMH"}
    }
    assert [event["eventType"] for event in by_signal["COIN"]] == ["skipped_entry"]
    assert by_signal["COIN"][0]["signalDate"] == "2024-01-03"
    assert by_signal["COIN"][0]["calculationTicker"] == "COIN"
    assert by_signal["COIN"][0]["holdSafetyTicker"] == "3CON.L"
    assert by_signal["COIN"][0]["sourceOfTruth"] is False
    assert by_signal["COIN"][0]["severity"] == "diagnostic"
    assert by_signal["COIN"][0]["reason"] == (
        "Signal ticker BUY skipped because execution ticker was already out/red."
    )
    assert [event["eventType"] for event in by_signal["TSLA"]] == ["skipped_entry"]
    assert [event["eventType"] for event in by_signal["GOOGL"]] == [
        "entry",
        "exit",
    ]
    assert [event["eventType"] for event in by_signal["SMH"]] == ["entry"]

    assert [
        position["signalTicker"] for position in supertrend_strategy["virtualPositions"]
    ] == ["SMH"]
    assert supertrend_strategy["virtualPositions"][0]["executionTicker"] == "3SMH.L"
    assert not any(
        position["executionTicker"] in {"3CON.L", "3TSL.L", "3GOO.L"}
        for position in supertrend_strategy["virtualPositions"]
    )


def test_supertrend_ignores_execution_buys_and_signal_sells(tmp_path, monkeypatch):
    patch_supertrend(
        monkeypatch,
        {
            501: ["out", "out", "out", "out"],
            601: ["out", "in", "in", "in"],
            502: ["out", "in", "out", "out"],
            602: ["out", "in", "in", "in"],
        },
    )
    provider = Provider()
    provider.values = {
        "NOOPEN": marker_bars(501, 4),
        "3NOOPEN.L": marker_bars(601, 4),
        "SIGSELL": marker_bars(502, 4),
        "3SIGSELL.L": marker_bars(602, 4),
    }
    config = validate_config(
        configuration(
            super_enabled=True,
            sma_enabled=False,
            supertrend_cost=0,
            maximum_concurrent_positions=2,
            watchlist=[
                {
                    "signalTicker": "NOOPEN",
                    "executionTicker": "3NOOPEN.L",
                    "enabled": True,
                    "allocationWeight": 1,
                },
                {
                    "signalTicker": "SIGSELL",
                    "executionTicker": "3SIGSELL.L",
                    "enabled": True,
                    "allocationWeight": 1,
                },
            ],
        )
    )

    snapshot = ScannerEngine(
        config, provider, tmp_path / "state", tmp_path / "output"
    ).scan(rebuild_history=True)
    supertrend_strategy = strategy(snapshot, "daily-supertrend")

    assert all(
        event["signalTicker"] != "NOOPEN" for event in supertrend_strategy["events"]
    )
    sigsell_events = [
        event
        for event in supertrend_strategy["events"]
        if event["signalTicker"] == "SIGSELL"
    ]
    assert [event["eventType"] for event in sigsell_events] == ["entry"]
    assert sigsell_events[0]["calculationTicker"] == "SIGSELL"
    assert not supertrend_strategy["closedVirtualTrades"]
    assert [
        position["executionTicker"]
        for position in supertrend_strategy["virtualPositions"]
    ] == ["3SIGSELL.L"]


def test_supertrend_allocation_policies_and_concurrency(
    tmp_path, monkeypatch
):
    patch_supertrend(
        monkeypatch,
        {
            101: ["out", "in", "in", "in"],
            102: ["out", "in", "in", "in"],
            103: ["out", "out", "out", "out"],
            10: ["out", "in", "in", "in"],
        },
    )
    provider = Provider()
    provider.values = {
        "SIGA": marker_bars(101, 4),
        "EXEA": bars([10, 10, 10, 10]),
        "SIGB": marker_bars(102, 4),
        "EXEB": bars([10, 10, 10, 10]),
        "SIGC": marker_bars(103, 4),
        "EXEC": bars([10, 10, 10, 10]),
    }
    watchlist = [
        {
            "signalTicker": "SIGA",
            "executionTicker": "EXEA",
            "enabled": True,
            "allocationWeight": 1,
        },
        {
            "signalTicker": "SIGB",
            "executionTicker": "EXEB",
            "enabled": True,
            "allocationWeight": 2,
        },
        {
            "signalTicker": "SIGC",
            "executionTicker": "EXEC",
            "enabled": True,
            "allocationWeight": 7,
        },
    ]
    equal = ScannerEngine(
        validate_config(
            configuration(
                super_enabled=True,
                sma_enabled=False,
                watchlist=watchlist,
                allocation_policy="equal_weight",
                maximum_concurrent_positions=3,
                supertrend_capital=9_000,
                supertrend_cost=0,
            )
        ),
        provider,
        tmp_path / "equal-state",
        tmp_path / "equal-output",
    ).scan()
    weighted = ScannerEngine(
        validate_config(
            configuration(
                super_enabled=True,
                sma_enabled=False,
                watchlist=watchlist,
                allocation_policy="weighted",
                maximum_concurrent_positions=3,
                supertrend_capital=9_000,
                supertrend_cost=0,
            )
        ),
        provider,
        tmp_path / "weighted-state",
        tmp_path / "weighted-output",
    ).scan()
    equal_strategy = strategy(equal, "daily-supertrend")
    weighted_strategy = strategy(weighted, "daily-supertrend")
    assert [item["allocation"] for item in equal_strategy["virtualPositions"]] == [
        3_000,
        3_000,
    ]
    assert [
        item["allocation"] for item in weighted_strategy["virtualPositions"]
    ] == [
        900,
        1_800,
    ]
    assert equal_strategy["cash"] == pytest.approx(3_000)
    assert weighted_strategy["cash"] == pytest.approx(6_300)
    assert weighted_strategy["cash"] >= 0

    capped = ScannerEngine(
        validate_config(
            configuration(
                super_enabled=True,
                sma_enabled=False,
                watchlist=watchlist,
                maximum_concurrent_positions=1,
                supertrend_capital=9_000,
                supertrend_cost=0,
            )
        ),
        provider,
        tmp_path / "capped-state",
        tmp_path / "capped-output",
    ).scan()
    assert len(strategy(capped, "daily-supertrend")["virtualPositions"]) == 1


def test_sma_daily_and_weekly_cadence_are_historical_and_idempotent(tmp_path):
    provider = Provider()
    provider.values = {
        "REFERENCE": weekday_bars([10, 10, 10, 12, 13, 6, 6]),
        "RISKON": weekday_bars([100, 100, 100, 100, 100, 100, 100]),
    }
    daily_config = validate_config(
        configuration(
            super_enabled=False,
            sma_enabled=True,
            sma_review_cadence="daily",
            sma_annual_cost=0,
            sma_transaction_cost=0,
        )
    )
    daily = ScannerEngine(
        daily_config, provider, tmp_path / "daily-state", tmp_path / "daily-output"
    ).scan()
    daily_strategy = strategy(daily, "nasdaq-sma200-3x")
    assert daily_strategy["currentState"] == "risk_off"
    assert event_types(daily_strategy) == ["entry", "exit"]
    assert all(event["signalDate"] for event in daily_strategy["events"])
    assert all(event["generatedAt"] == daily["generatedAt"] for event in daily_strategy["events"])
    assert daily_strategy["events"][0]["calculationTicker"] == "REFERENCE"
    assert daily_strategy["chartData"][0]["executionTicker"] == "RISKON"

    weekly_config = validate_config(
        configuration(
            super_enabled=False,
            sma_enabled=True,
            sma_review_cadence="weekly",
            sma_annual_cost=0,
            sma_transaction_cost=0,
        )
    )
    weekly = ScannerEngine(
        weekly_config,
        provider,
        tmp_path / "weekly-state",
        tmp_path / "weekly-output",
    ).scan()
    weekly_strategy = strategy(weekly, "nasdaq-sma200-3x")
    assert weekly_strategy["currentState"] == "risk_on"
    assert event_types(weekly_strategy) == ["entry"]
    assert weekly_strategy["lastEvaluatedMarketPeriod"] == "2024-W01"

    repeated = ScannerEngine(
        weekly_config,
        provider,
        tmp_path / "weekly-state",
        tmp_path / "weekly-output",
    ).scan()
    assert [
        event["eventId"]
        for event in strategy(repeated, "nasdaq-sma200-3x")["events"]
    ] == [event["eventId"] for event in weekly_strategy["events"]]


def test_sma_multi_ticker_book_opens_independent_execution_positions(tmp_path):
    provider = Provider()
    config = validate_config(
        configuration(
            super_enabled=False,
            sma_enabled=True,
            sma_annual_cost=0,
            sma_transaction_cost=0,
            sma_watchlist=[
                {
                    "signalTicker": "REFA",
                    "executionTicker": "EXEA",
                    "enabled": True,
                    "allocationWeight": 10,
                },
                {
                    "signalTicker": "REFB",
                    "executionTicker": "EXEB",
                    "enabled": True,
                    "allocationWeight": 1,
                },
            ],
        )
    )

    snapshot = ScannerEngine(
        config,
        provider,
        tmp_path / "sma-multi-state",
        tmp_path / "sma-multi-output",
    ).scan()
    sma = strategy(snapshot, "nasdaq-sma200-3x")

    assert sma["currentState"] == "risk_on"
    assert sma["parameters"]["watchlist"][0]["signalTicker"] == "REFA"
    assert {event["signalTicker"] for event in sma["events"]} == {"REFA", "REFB"}
    assert {event["executionTicker"] for event in sma["events"]} == {"EXEA", "EXEB"}
    assert {position["signalTicker"] for position in sma["virtualPositions"]} == {
        "REFA",
        "REFB",
    }
    assert {position["executionTicker"] for position in sma["virtualPositions"]} == {
        "EXEA",
        "EXEB",
    }
    assert [position["allocation"] for position in sma["virtualPositions"]] == [
        10_000,
        10_000,
    ]
    assert sma["modelValue"] == pytest.approx(24_000)
    assert sma["exposurePercent"] == pytest.approx(100)


def test_sma_multi_ticker_exit_uses_signal_ticker_and_closes_execution(tmp_path):
    provider = Provider()
    provider.values.update(
        {
            "REFA": bars([10, 10, 10, 12, 13]),
            "EXEA": bars([100, 100, 100, 110, 120]),
            "REFB": bars([20, 20, 20, 24, 16]),
            "EXEB": bars([50, 50, 50, 55, 60]),
        }
    )
    config = validate_config(
        configuration(
            super_enabled=False,
            sma_enabled=True,
            sma_annual_cost=0,
            sma_transaction_cost=0,
            sma_watchlist=[
                {
                    "signalTicker": "REFA",
                    "executionTicker": "EXEA",
                    "enabled": True,
                    "allocationWeight": 1,
                },
                {
                    "signalTicker": "REFB",
                    "executionTicker": "EXEB",
                    "enabled": True,
                    "allocationWeight": 1,
                },
            ],
        )
    )

    snapshot = ScannerEngine(
        config,
        provider,
        tmp_path / "sma-exit-state",
        tmp_path / "sma-exit-output",
    ).scan()
    sma = strategy(snapshot, "nasdaq-sma200-3x")

    assert sma["currentState"] == "mixed"
    assert event_types(sma) == ["entry", "entry", "exit"]
    exit_event = [event for event in sma["events"] if event["eventType"] == "exit"][0]
    assert exit_event["signalTicker"] == "REFB"
    assert exit_event["executionTicker"] == "EXEB"
    assert sma["closedVirtualTrades"][0]["signalTicker"] == "REFB"
    assert sma["closedVirtualTrades"][0]["executionTicker"] == "EXEB"
    assert [position["executionTicker"] for position in sma["virtualPositions"]] == [
        "EXEA"
    ]


def test_performance_sanity_warnings_do_not_stop_scanner_output(
    tmp_path, monkeypatch
):
    patch_supertrend(monkeypatch, {201: ["out", "in", "in"], 0: ["out", "in", "in"]})
    provider = Provider()
    provider.values = {
        "SIG": bars([201, 202, 203], date(2026, 6, 18)),
        "3BAD.L": bars([0.1, 0.1, 20], date(2026, 6, 18)),
    }
    config = validate_config(
        configuration(
            super_enabled=True,
            sma_enabled=False,
            supertrend_cost=0,
            watchlist=[
                {
                    "signalTicker": "SIG",
                    "executionTicker": "3BAD.L",
                    "enabled": True,
                    "allocationWeight": 1,
                }
            ],
        )
    )

    snapshot = ScannerEngine(
        config,
        provider,
        tmp_path / "sanity-state",
        tmp_path / "sanity-output",
    ).scan()
    supertrend = strategy(snapshot, "daily-supertrend")
    warning_codes = {warning["code"] for warning in supertrend["warnings"]}
    position_warning_codes = {
        warning["code"]
        for warning in supertrend["virtualPositions"][0]["warnings"]
    }
    output = json.loads((tmp_path / "sanity-output" / "multi_strategy_v1.json").read_text())

    assert snapshot["scanner"]["status"] == "current"
    assert supertrend["status"] == "current"
    assert supertrend["virtualPositions"]
    assert "extreme_open_pnl" in position_warning_codes
    assert "extreme_price_ratio" in position_warning_codes
    assert "extreme_model_return" in warning_codes
    assert snapshot["scanner"]["warnings"]
    assert output["scanner"]["warnings"]


def test_sma_annual_instrument_cost_is_durable_and_not_double_charged(tmp_path):
    provider = Provider()
    provider.values = {
        "REFERENCE": weekday_bars([10, 10, 10, 12, 13, 14, 15]),
        "RISKON": weekday_bars([100, 100, 100, 100, 100, 100, 100]),
    }
    config = validate_config(
        configuration(
            super_enabled=False,
            sma_enabled=True,
            sma_annual_cost=18.25,
            sma_transaction_cost=0,
        )
    )
    first = ScannerEngine(
        config, provider, tmp_path / "state", tmp_path / "output"
    ).scan()
    first_strategy = strategy(first, "nasdaq-sma200-3x")
    assert first_strategy["currentState"] == "risk_on"
    assert first_strategy["lastCostAccrualDate"] == "2024-01-09"
    assert first_strategy["modelValue"] < 20_000

    repeated = ScannerEngine(
        config, provider, tmp_path / "state", tmp_path / "output"
    ).scan()
    repeated_strategy = strategy(repeated, "nasdaq-sma200-3x")
    assert repeated_strategy["modelValue"] == pytest.approx(
        first_strategy["modelValue"]
    )
    assert repeated_strategy["virtualPositions"][0]["quantity"] == pytest.approx(
        first_strategy["virtualPositions"][0]["quantity"]
    )


def test_config_change_marks_rebuild_required_without_mixing_old_state(
    tmp_path, monkeypatch
):
    patch_supertrend(monkeypatch, {101: ["out", "in", "in", "in"]})
    provider = Provider()
    provider.values = {
        "SIGNAL": marker_bars(101, 4),
        "EXEC": bars([10, 11, 12, 13]),
    }
    initial_config_value = configuration(super_enabled=True, sma_enabled=False)
    initial_config = validate_config(initial_config_value)
    first = ScannerEngine(
        initial_config, provider, tmp_path / "state", tmp_path / "output"
    ).scan()
    first_strategy = strategy(first, "daily-supertrend")
    assert first_strategy["status"] == "current"

    changed_config_value = configuration(super_enabled=True, sma_enabled=False)
    changed_config_value["strategies"]["dailySuperTrend"]["multiplier"] = 4
    changed_config = validate_config(changed_config_value)
    blocked = ScannerEngine(
        changed_config, provider, tmp_path / "state", tmp_path / "output"
    ).scan()
    blocked_strategy = strategy(blocked, "daily-supertrend")
    assert blocked["scanner"]["status"] == "rebuild_required"
    assert blocked_strategy["status"] == "rebuild_required"
    assert blocked_strategy["events"] == first_strategy["events"]
    assert "no new scanner data is mixed" in blocked_strategy["ruleSummary"]
    state = json.loads((tmp_path / "state" / "model_state_v1.json").read_text())
    assert state["archivedStrategies"][0]["strategyId"] == "daily-supertrend"

    rebuilt = ScannerEngine(
        changed_config, provider, tmp_path / "state", tmp_path / "output"
    ).scan(rebuild_history=True)
    rebuilt_strategy = strategy(rebuilt, "daily-supertrend")
    assert rebuilt["scanner"]["status"] != "rebuild_required"
    assert rebuilt_strategy["status"] == "current"
    assert rebuilt_strategy.get("rebuildRequired") is not True


def test_atomic_snapshot_writer_replaces_complete_json(tmp_path):
    target = tmp_path / "multi_strategy_v1.json"
    atomic_write_json(target, {"schemaVersion": "multi_strategy_v1", "value": 1})
    atomic_write_json(target, {"schemaVersion": "multi_strategy_v1", "value": 2})
    assert json.loads(target.read_text())["value"] == 2
    assert not list(tmp_path.glob("*.tmp"))
