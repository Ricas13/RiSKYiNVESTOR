from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import json


class ConfigurationError(ValueError):
    pass


@dataclass(frozen=True)
class WatchlistRow:
    signal_ticker: str
    execution_ticker: str
    enabled: bool
    allocation_weight: float


@dataclass(frozen=True)
class SuperTrendConfig:
    enabled: bool
    timeframe: str
    atr_period: int
    multiplier: float
    model_starting_capital: float
    allocation_policy: str
    maximum_concurrent_positions: int
    transaction_cost_percent: float
    watchlist: tuple[WatchlistRow, ...]


@dataclass(frozen=True)
class SmaConfig:
    enabled: bool
    reference_ticker: str
    risk_on_ticker: str
    watchlist: tuple[WatchlistRow, ...]
    risk_off_mode: str
    risk_off_ticker: str | None
    sma_length: int
    review_cadence: str
    risk_on_threshold_percent: float
    risk_off_threshold_percent: float
    model_starting_capital: float
    transaction_cost_percent: float
    annual_instrument_cost_percent: float


@dataclass(frozen=True)
class ScannerConfig:
    version: int
    provider: dict[str, Any]
    supertrend: SuperTrendConfig
    sma: SmaConfig


SUPPORTED_MARKET_DATA_PROVIDERS = {
    "stooq_csv",
    "url_template_csv",
    "yahoo_chart",
}


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ConfigurationError(f"{label} must be an object.")
    return value


def _text(value: Any, label: str, required: bool = True) -> str:
    result = value.strip() if isinstance(value, str) else ""
    if required and not result:
        raise ConfigurationError(f"{label} is required.")
    if len(result) > 120:
        raise ConfigurationError(f"{label} is too long.")
    return result


def _number(
    value: Any,
    label: str,
    minimum: float,
    maximum: float,
) -> float:
    if isinstance(value, bool):
        raise ConfigurationError(f"{label} must be a number.")
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ConfigurationError(f"{label} must be a number.") from error
    if result < minimum or result > maximum:
        raise ConfigurationError(
            f"{label} must be between {minimum:g} and {maximum:g}."
        )
    return result


def _ticker_map(value: Any, label: str) -> dict[str, str]:
    if value is None:
        return {}
    raw = _object(value, label)
    result: dict[str, str] = {}
    for source, target in raw.items():
        source_text = _text(source, f"{label} source ticker")
        target_text = _text(target, f"{label} provider ticker")
        result[source_text.upper()] = target_text
    return result


def _row_key(row: WatchlistRow) -> str:
    return f"{row.signal_ticker}|{row.execution_ticker}"


def _provider_config(
    provider: dict[str, Any],
    label: str,
    *,
    default_timeout: int | None = None,
    default_retries: int | None = None,
) -> dict[str, Any]:
    provider_name = _text(provider.get("provider"), f"{label} provider")
    if provider_name not in SUPPORTED_MARKET_DATA_PROVIDERS:
        raise ConfigurationError("Unsupported market-data provider.")
    url_template = _text(
        provider.get("urlTemplate"),
        f"{label} URL template",
        required=provider_name != "yahoo_chart",
    )
    if url_template and "{ticker}" not in url_template:
        raise ConfigurationError(
            "Market-data URL template must contain {ticker}."
        )
    timeout = int(
        _number(
            provider.get("timeoutSeconds", default_timeout or 20),
            f"{label} timeout",
            1,
            120,
        )
    )
    retries = int(
        _number(
            provider.get("maximumRetries", default_retries or 3),
            f"{label} retries",
            0,
            8,
        )
    )
    result: dict[str, Any] = {
        "provider": provider_name,
        "timeoutSeconds": timeout,
        "maximumRetries": retries,
        "tickerMap": _ticker_map(provider.get("tickerMap"), f"{label} ticker map"),
    }
    if url_template:
        result["urlTemplate"] = url_template
    return result


def validate_config(value: Any) -> ScannerConfig:
    root = _object(value, "Configuration")
    if root.get("version") != 1:
        raise ConfigurationError("Configuration version must be 1.")
    provider = _object(root.get("marketData"), "marketData")
    provider_config = _provider_config(provider, "Market-data")
    fallback_provider = provider.get("fallbackProvider")
    if fallback_provider is not None:
        provider_config["fallbackProvider"] = _provider_config(
            _object(fallback_provider, "Market-data fallback provider"),
            "Market-data fallback",
            default_timeout=int(provider_config["timeoutSeconds"]),
            default_retries=int(provider_config["maximumRetries"]),
        )

    strategies = _object(root.get("strategies"), "strategies")
    supertrend_value = strategies.get("dailySuperTrend", {})
    supertrend_raw = _object(supertrend_value, "Daily SuperTrend")
    supertrend_enabled = supertrend_raw.get("enabled") is True
    watchlist_raw = supertrend_raw.get("watchlist", [])
    if not isinstance(watchlist_raw, list):
        raise ConfigurationError("Daily SuperTrend watchlist must be an array.")
    watchlist: list[WatchlistRow] = []
    for index, raw in enumerate(watchlist_raw):
        row = _object(raw, f"Watchlist row {index + 1}")
        row_enabled = row.get("enabled") is True
        watchlist.append(
            WatchlistRow(
                signal_ticker=_text(
                    row.get("signalTicker"),
                    f"Watchlist row {index + 1} signal ticker",
                    required=row_enabled or supertrend_enabled,
                ).upper(),
                execution_ticker=_text(
                    row.get("executionTicker"),
                    f"Watchlist row {index + 1} execution ticker",
                    required=row_enabled or supertrend_enabled,
                ).upper(),
                enabled=row_enabled,
                allocation_weight=_number(
                    row.get("allocationWeight", 1),
                    f"Watchlist row {index + 1} allocation weight",
                    0.01,
                    100,
                ),
            )
        )
    supertrend = SuperTrendConfig(
        enabled=supertrend_enabled,
        timeframe=_text(
            supertrend_raw.get("timeframe", "1d"), "SuperTrend timeframe"
        ),
        atr_period=int(
            _number(supertrend_raw.get("atrPeriod", 10), "ATR period", 2, 500)
        ),
        multiplier=_number(
            supertrend_raw.get("multiplier", 3),
            "SuperTrend multiplier",
            0.1,
            20,
        ),
        model_starting_capital=_number(
            supertrend_raw.get("modelStartingCapital", 10_000),
            "SuperTrend model starting capital",
            1,
            1_000_000_000,
        ),
        allocation_policy=_text(
            supertrend_raw.get("allocationPolicy", "equal_weight"),
            "SuperTrend allocation policy",
        ),
        maximum_concurrent_positions=int(
            _number(
                supertrend_raw.get("maximumConcurrentPositions", 5),
                "Maximum concurrent positions",
                1,
                1000,
            )
        ),
        transaction_cost_percent=_number(
            supertrend_raw.get("transactionCostPercent", 0),
            "SuperTrend transaction cost",
            0,
            20,
        ),
        watchlist=tuple(watchlist),
    )

    sma_value = strategies.get("nasdaqSma200", {})
    sma_raw = _object(sma_value, "Nasdaq SMA200 Regime")
    sma_enabled = sma_raw.get("enabled") is True
    sma_watchlist_raw = sma_raw.get("watchlist", [])
    if not isinstance(sma_watchlist_raw, list):
        raise ConfigurationError("Nasdaq SMA200 watchlist must be an array.")
    sma_watchlist: list[WatchlistRow] = []
    for index, raw in enumerate(sma_watchlist_raw):
        row = _object(raw, f"SMA200 watchlist row {index + 1}")
        row_enabled = row.get("enabled") is True
        sma_watchlist.append(
            WatchlistRow(
                signal_ticker=_text(
                    row.get("signalTicker"),
                    f"SMA200 watchlist row {index + 1} signal ticker",
                    required=row_enabled or (sma_enabled and bool(sma_watchlist_raw)),
                ).upper(),
                execution_ticker=_text(
                    row.get("executionTicker"),
                    f"SMA200 watchlist row {index + 1} execution ticker",
                    required=row_enabled or (sma_enabled and bool(sma_watchlist_raw)),
                ).upper(),
                enabled=row_enabled,
                allocation_weight=_number(
                    row.get("allocationWeight", 1),
                    f"SMA200 watchlist row {index + 1} allocation weight",
                    0.01,
                    100,
                ),
            )
        )
    if sma_enabled and sma_watchlist_raw and not any(row.enabled for row in sma_watchlist):
        raise ConfigurationError(
            "Nasdaq SMA200 requires at least one enabled watchlist row when watchlist rows are configured."
        )
    sma_mapping_keys = [
        _row_key(row) for row in sma_watchlist if row.signal_ticker or row.execution_ticker
    ]
    if len(set(sma_mapping_keys)) != len(sma_mapping_keys):
        raise ConfigurationError("Nasdaq SMA200 watchlist mappings must be unique.")
    legacy_required = sma_enabled and not sma_watchlist_raw
    risk_off_mode = _text(sma_raw.get("riskOffMode", "cash"), "Risk-off mode")
    if risk_off_mode not in {"cash", "instrument"}:
        raise ConfigurationError("Risk-off mode must be cash or instrument.")
    risk_off_ticker = _text(
        sma_raw.get("riskOffTicker"), "Risk-off ticker", required=False
    ).upper() or None
    if sma_enabled and risk_off_mode == "instrument" and not risk_off_ticker:
        raise ConfigurationError(
            "Risk-off ticker is required when risk-off mode is instrument."
        )
    sma = SmaConfig(
        enabled=sma_enabled,
        reference_ticker=_text(
            sma_raw.get("referenceTicker"),
            "Nasdaq reference ticker",
            required=legacy_required,
        ).upper(),
        risk_on_ticker=_text(
            sma_raw.get("riskOnTicker"),
            "Nasdaq risk-on ticker",
            required=legacy_required,
        ).upper(),
        watchlist=tuple(sma_watchlist),
        risk_off_mode=risk_off_mode,
        risk_off_ticker=risk_off_ticker,
        sma_length=int(
            _number(sma_raw.get("smaLength", 200), "SMA length", 2, 1000)
        ),
        review_cadence=_text(
            sma_raw.get("reviewCadence", "daily"), "SMA review cadence"
        ),
        risk_on_threshold_percent=_number(
            sma_raw.get("riskOnThresholdPercent", 0),
            "Risk-on threshold",
            -50,
            50,
        ),
        risk_off_threshold_percent=_number(
            sma_raw.get("riskOffThresholdPercent", 0),
            "Risk-off threshold",
            -50,
            50,
        ),
        model_starting_capital=_number(
            sma_raw.get("modelStartingCapital", 10_000),
            "SMA model starting capital",
            1,
            1_000_000_000,
        ),
        transaction_cost_percent=_number(
            sma_raw.get("transactionCostPercent", 0),
            "SMA transaction cost",
            0,
            20,
        ),
        annual_instrument_cost_percent=_number(
            sma_raw.get("annualInstrumentCostPercent", 0),
            "Annual instrument cost",
            0,
            20,
        ),
    )
    if supertrend.allocation_policy not in {"equal_weight", "weighted"}:
        raise ConfigurationError(
            "SuperTrend allocation policy must be equal_weight or weighted."
        )
    if sma.review_cadence not in {"daily", "weekly"}:
        raise ConfigurationError("SMA review cadence must be daily or weekly.")
    if supertrend.enabled and not any(row.enabled for row in watchlist):
        raise ConfigurationError(
            "Daily SuperTrend cannot be enabled without an enabled watchlist row."
        )
    return ScannerConfig(
        version=1,
        provider=provider_config,
        supertrend=supertrend,
        sma=sma,
    )


def load_config(path: Path) -> ScannerConfig:
    with path.open("r", encoding="utf-8") as handle:
        return validate_config(json.load(handle))
