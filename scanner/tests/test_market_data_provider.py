from __future__ import annotations

from datetime import date
import json

import pytest

from risky_investor_scanner.config import validate_config
from risky_investor_scanner.engine import ScannerEngine
from risky_investor_scanner.market_data import (
    FallbackMarketDataProvider,
    MarketDataError,
    PriceBar,
    parse_csv_prices,
)
from test_scanner import Provider, configuration, strategy


class FailingLiveProvider:
    def __init__(self):
        self.calls: list[str] = []

    def fetch_live(self, ticker):
        self.calls.append(ticker)
        raise MarketDataError(f"stooq_csv failed for {ticker}: HTML verification.")


class LiveProviderAdapter:
    def __init__(self, provider):
        self.provider = provider
        self.calls: list[str] = []

    def fetch_live(self, ticker):
        self.calls.append(ticker)
        return self.provider.fetch(ticker)


class FailingProvider:
    cache_fallbacks: set[str] = set()
    freshness: dict[str, str] = {}

    def fetch(self, ticker):
        raise MarketDataError(f"stooq_csv failed for {ticker}: HTML verification.")


def test_market_data_fallback_config_supports_explicit_ticker_maps():
    value = configuration()
    value["marketData"]["fallbackProvider"] = {
        "provider": "yahoo_chart",
        "tickerMap": {"REFERENCE": "^IXIC", "RISKON": "QQQ"},
    }

    config = validate_config(value)

    fallback = config.provider["fallbackProvider"]
    assert fallback["provider"] == "yahoo_chart"
    assert fallback["tickerMap"]["REFERENCE"] == "^IXIC"
    assert fallback["tickerMap"]["RISKON"] == "QQQ"


def test_csv_market_data_validation_rejects_html_empty_and_no_data():
    with pytest.raises(
        MarketDataError,
        match=r"stooq_csv.*HTML/browser verification.*QQQ\.US",
    ):
        parse_csv_prices(
            "<html><body>This site requires JavaScript to verify your browser.</body></html>",
            ticker="QQQ.US",
            provider_name="stooq_csv",
        )
    with pytest.raises(MarketDataError, match=r"stooq_csv.*empty response.*QQQ\.US"):
        parse_csv_prices("", ticker="QQQ.US", provider_name="stooq_csv")
    with pytest.raises(
        MarketDataError,
        match=r"stooq_csv.*no parseable OHLCV rows.*QQQ\.US",
    ):
        parse_csv_prices(
            "Date,Open,High,Low,Close,Volume\n",
            ticker="QQQ.US",
            provider_name="stooq_csv",
        )
    with pytest.raises(
        MarketDataError,
        match=r"stooq_csv.*no parseable OHLCV rows.*QQQ\.US",
    ):
        parse_csv_prices("No data", ticker="QQQ.US", provider_name="stooq_csv")


def test_valid_csv_market_data_still_parses():
    parsed = parse_csv_prices(
        "Date,Open,High,Low,Close,Volume\n"
        "2024-01-02,100,105,99,104,12345\n",
        ticker="QQQ.US",
        provider_name="stooq_csv",
    )

    assert parsed == [
        PriceBar(
            day=date(2024, 1, 2),
            open=100,
            high=105,
            low=99,
            close=104,
            volume=12345,
        )
    ]


def test_fallback_provider_is_attempted_after_primary_failure(tmp_path):
    primary = FailingLiveProvider()
    fallback = LiveProviderAdapter(Provider())
    provider = FallbackMarketDataProvider([primary, fallback], tmp_path / "cache")

    result = provider.fetch("REFERENCE")

    assert result == Provider().values["REFERENCE"]
    assert primary.calls == ["REFERENCE"]
    assert fallback.calls == ["REFERENCE"]


def test_scanner_preserves_durable_state_on_provider_failure(tmp_path):
    config = validate_config(configuration())
    first = ScannerEngine(
        config, Provider(), tmp_path / "state", tmp_path / "output"
    ).scan()
    durable_before = json.loads(
        (tmp_path / "state" / "model_state_v1.json").read_text()
    )["strategies"]

    failed = ScannerEngine(
        config, FailingProvider(), tmp_path / "state", tmp_path / "output"
    ).scan()
    durable_after = json.loads(
        (tmp_path / "state" / "model_state_v1.json").read_text()
    )["strategies"]

    assert first["scanner"]["status"] in {"current", "stale"}
    assert failed["scanner"]["status"] == "error"
    assert durable_after == durable_before
    assert all(
        "durable state was preserved" in error["message"]
        for error in failed["scanner"]["errors"]
    )


def test_provider_fallback_preserves_strategy_math(tmp_path):
    config = validate_config(configuration())
    baseline = ScannerEngine(
        config,
        Provider(),
        tmp_path / "baseline-state",
        tmp_path / "baseline-output",
    ).scan()
    provider = FallbackMarketDataProvider(
        [FailingLiveProvider(), LiveProviderAdapter(Provider())],
        tmp_path / "fallback-cache",
    )
    fallback = ScannerEngine(
        config,
        provider,
        tmp_path / "fallback-state",
        tmp_path / "fallback-output",
    ).scan()

    for strategy_id in {"daily-supertrend", "nasdaq-sma200-3x"}:
        baseline_strategy = strategy(baseline, strategy_id)
        fallback_strategy = strategy(fallback, strategy_id)
        assert fallback_strategy["currentState"] == baseline_strategy["currentState"]
        assert fallback_strategy["modelValue"] == pytest.approx(
            baseline_strategy["modelValue"]
        )
        assert fallback_strategy["returnPercent"] == pytest.approx(
            baseline_strategy["returnPercent"]
        )
