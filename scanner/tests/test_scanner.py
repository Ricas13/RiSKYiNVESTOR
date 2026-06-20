from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import json

import pytest

from risky_investor_scanner.calculations import simple_moving_average, supertrend
from risky_investor_scanner.config import ConfigurationError, validate_config
from risky_investor_scanner.engine import ScannerEngine
from risky_investor_scanner.market_data import PriceBar
from risky_investor_scanner.storage import atomic_write_json


def bars(values: list[float]) -> list[PriceBar]:
    start = date(2024, 1, 1)
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


def configuration(super_enabled=True, sma_enabled=True):
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
                "modelStartingCapital": 10_000,
                "allocationPolicy": "equal_weight",
                "maximumConcurrentPositions": 2,
                "transactionCostPercent": 0.1,
                "watchlist": [
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
                "riskOffMode": "cash",
                "riskOffTicker": "",
                "smaLength": 3,
                "reviewCadence": "daily",
                "riskOnThresholdPercent": 0,
                "riskOffThresholdPercent": 0,
                "modelStartingCapital": 20_000,
                "transactionCostPercent": 0.1,
                "annualInstrumentCostPercent": 0.75,
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
        }

    def fetch(self, ticker):
        return self.values[ticker]


def test_configuration_validation_and_disabled_behavior(tmp_path):
    valid = validate_config(configuration())
    assert valid.supertrend.enabled is True
    assert valid.sma.sma_length == 3
    invalid = configuration()
    invalid["strategies"]["nasdaqSma200"]["riskOffMode"] = "instrument"
    with pytest.raises(ConfigurationError):
        validate_config(invalid)
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
    assert by_id["nasdaq-sma200-3x"]["parameters"].get("atrPeriod") is None
    assert by_id["nasdaq-sma200-3x"]["currentState"] == "risk_on"


def test_repeated_scan_has_no_duplicate_events_and_state_survives(tmp_path):
    config = validate_config(configuration())
    first = ScannerEngine(
        config, Provider(), tmp_path / "state", tmp_path / "output"
    ).scan()
    second = ScannerEngine(
        config, Provider(), tmp_path / "state", tmp_path / "output"
    ).scan()
    for strategy_id in {"daily-supertrend", "nasdaq-sma200-3x"}:
        first_events = next(
            item["events"]
            for item in first["strategies"]
            if item["strategyId"] == strategy_id
        )
        second_events = next(
            item["events"]
            for item in second["strategies"]
            if item["strategyId"] == strategy_id
        )
        assert [item["eventId"] for item in first_events] == [
            item["eventId"] for item in second_events
        ]
    assert (tmp_path / "state" / "model_state_v1.json").exists()


def test_supertrend_virtual_entry_and_exit_lifecycle(tmp_path):
    config_value = configuration(super_enabled=True, sma_enabled=False)
    provider = Provider()
    provider.values["SIGNAL"] = bars([10, 9, 8, 7, 12])
    provider.values["EXEC"] = bars([20, 19, 18, 17, 22])
    engine = ScannerEngine(
        validate_config(config_value),
        provider,
        tmp_path / "state",
        tmp_path / "output",
    )
    opened = engine.scan()
    strategy = next(
        item for item in opened["strategies"]
        if item["strategyId"] == "daily-supertrend"
    )
    assert [event["eventType"] for event in strategy["events"]] == ["entry"]
    assert strategy["virtualPositions"][0]["label"] == "Virtual model position"
    assert strategy["virtualPositions"][0]["entryPrice"] == 22

    provider.values["SIGNAL"] = bars([10, 9, 8, 7, 12, 13, 14, 8])
    provider.values["EXEC"] = bars([20, 19, 18, 17, 22, 23, 24, 16])
    closed = engine.scan()
    strategy = next(
        item for item in closed["strategies"]
        if item["strategyId"] == "daily-supertrend"
    )
    assert [event["eventType"] for event in strategy["events"]] == [
        "entry",
        "exit",
    ]
    assert strategy["virtualPositions"] == []
    assert len(strategy["closedVirtualTrades"]) == 1
    assert strategy["closedVirtualTrades"][0]["exitReason"].startswith(
        "SuperTrend changed"
    )


def test_sma_regime_lifecycle_is_independent_and_restart_safe(tmp_path):
    config_value = configuration(super_enabled=False, sma_enabled=True)
    provider = Provider()
    engine = ScannerEngine(
        validate_config(config_value),
        provider,
        tmp_path / "state",
        tmp_path / "output",
    )
    risk_on = engine.scan()
    strategy = next(
        item for item in risk_on["strategies"]
        if item["strategyId"] == "nasdaq-sma200-3x"
    )
    assert strategy["currentState"] == "risk_on"
    assert strategy["events"][0]["eventType"] == "entry"
    assert strategy["virtualPositions"][0]["label"] == "Virtual model position"

    provider.values["REFERENCE"] = bars([10, 10, 10, 8, 7])
    provider.values["RISKON"] = bars([10, 10, 10, 9, 8])
    restarted = ScannerEngine(
        validate_config(config_value),
        provider,
        tmp_path / "state",
        tmp_path / "output",
    ).scan()
    strategy = next(
        item for item in restarted["strategies"]
        if item["strategyId"] == "nasdaq-sma200-3x"
    )
    assert strategy["currentState"] == "risk_off"
    assert [event["eventType"] for event in strategy["regimeChangeEvents"]] == [
        "entry",
        "exit",
    ]
    assert strategy["virtualPositions"] == []
    assert len(strategy["closedVirtualTrades"]) == 1


def test_atomic_snapshot_writer_replaces_complete_json(tmp_path):
    target = tmp_path / "multi_strategy_v1.json"
    atomic_write_json(target, {"schemaVersion": "multi_strategy_v1", "value": 1})
    atomic_write_json(target, {"schemaVersion": "multi_strategy_v1", "value": 2})
    assert json.loads(target.read_text())["value"] == 2
    assert not list(tmp_path.glob("*.tmp"))
