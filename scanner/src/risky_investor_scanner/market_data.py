from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable
import csv
import ipaddress
import json
import socket
import time
import urllib.parse
import urllib.request

from .storage import atomic_write_json

DEFAULT_YAHOO_CHART_URL_TEMPLATE = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    "?range=10y&interval=1d"
)


@dataclass(frozen=True)
class PriceBar:
    day: date
    open: float
    high: float
    low: float
    close: float
    volume: float


class MarketDataError(RuntimeError):
    pass


UrlOpener = Callable[..., Any]


class CsvMarketDataProvider:
    def __init__(
        self,
        url_template: str,
        timeout_seconds: int,
        maximum_retries: int,
        cache_dir: Path,
        *,
        provider_name: str = "url_template_csv",
        ticker_map: dict[str, str] | None = None,
        opener: UrlOpener | None = None,
        allow_cache_fallback: bool = True,
    ) -> None:
        self.provider_name = provider_name
        self.url_template = url_template
        self.timeout_seconds = timeout_seconds
        self.maximum_retries = maximum_retries
        self.cache_dir = cache_dir
        self.ticker_map = _normalise_ticker_map(ticker_map)
        self.opener = opener or urllib.request.urlopen
        self.allow_cache_fallback = allow_cache_fallback
        self.cache_fallbacks: set[str] = set()
        self.freshness: dict[str, str] = {}

    def _provider_ticker(self, ticker: str) -> str:
        return self.ticker_map.get(ticker.upper(), ticker)

    def _url(self, ticker: str) -> str:
        provider_ticker = self._provider_ticker(ticker)
        url = self.url_template.format(
            ticker=urllib.parse.quote(provider_ticker, safe="")
        )
        _assert_public_https_url(url)
        return url

    def _cache_path(self, ticker: str) -> Path:
        return _cache_path(self.cache_dir, ticker)

    def fetch_live(self, ticker: str) -> list[PriceBar]:
        error: Exception | None = None
        for attempt in range(self.maximum_retries + 1):
            try:
                request = urllib.request.Request(
                    self._url(ticker),
                    headers={"User-Agent": "RiSKYiNVESTOR-scanner/1.0"},
                )
                with self.opener(request, timeout=self.timeout_seconds) as response:
                    content = response.read().decode("utf-8-sig")
                return parse_csv_prices(
                    content,
                    ticker=ticker,
                    provider_name=self.provider_name,
                )
            except Exception as caught:  # bounded retry
                error = caught
                if attempt < self.maximum_retries:
                    time.sleep(min(2**attempt, 8))
        if isinstance(error, MarketDataError):
            raise error
        raise MarketDataError(
            f"{self.provider_name} failed for {ticker}: {type(error).__name__}."
        ) from error

    def fetch(self, ticker: str) -> list[PriceBar]:
        try:
            bars = self.fetch_live(ticker)
            self._write_cache(ticker, bars)
            self.cache_fallbacks.discard(ticker)
            return bars
        except Exception as error:
            if self.allow_cache_fallback:
                cached = self._read_cache(ticker)
                if cached:
                    self.cache_fallbacks.add(ticker)
                    self.freshness[ticker] = cached[-1].day.isoformat()
                    return cached
            raise MarketDataError(
                f"Market data unavailable for {ticker} from {self.provider_name}: {error}"
            ) from error

    def _write_cache(self, ticker: str, bars: list[PriceBar]) -> None:
        fetched_at = datetime.now(timezone.utc).isoformat()
        atomic_write_json(
            self._cache_path(ticker),
            {
                "fetchedAt": fetched_at,
                "bars": [bar_to_json(bar) for bar in bars],
            },
        )
        self.freshness[ticker] = bars[-1].day.isoformat()

    def _read_cache(self, ticker: str) -> list[PriceBar]:
        cached = self._cache_path(ticker)
        if not cached.exists():
            return []
        payload = json.loads(cached.read_text(encoding="utf-8"))
        return [bar_from_json(item) for item in payload.get("bars", [])]


class YahooChartMarketDataProvider:
    def __init__(
        self,
        timeout_seconds: int,
        maximum_retries: int,
        cache_dir: Path,
        *,
        url_template: str = DEFAULT_YAHOO_CHART_URL_TEMPLATE,
        ticker_map: dict[str, str] | None = None,
        opener: UrlOpener | None = None,
        allow_cache_fallback: bool = True,
    ) -> None:
        self.provider_name = "yahoo_chart"
        self.url_template = url_template
        self.timeout_seconds = timeout_seconds
        self.maximum_retries = maximum_retries
        self.cache_dir = cache_dir
        self.ticker_map = _normalise_ticker_map(ticker_map)
        self.opener = opener or urllib.request.urlopen
        self.allow_cache_fallback = allow_cache_fallback
        self.cache_fallbacks: set[str] = set()
        self.freshness: dict[str, str] = {}

    def _provider_ticker(self, ticker: str) -> str:
        return self.ticker_map.get(ticker.upper(), ticker)

    def _url(self, ticker: str) -> str:
        provider_ticker = self._provider_ticker(ticker)
        url = self.url_template.format(
            ticker=urllib.parse.quote(provider_ticker, safe="")
        )
        _assert_public_https_url(url)
        return url

    def _cache_path(self, ticker: str) -> Path:
        return _cache_path(self.cache_dir, ticker)

    def fetch_live(self, ticker: str) -> list[PriceBar]:
        error: Exception | None = None
        for attempt in range(self.maximum_retries + 1):
            try:
                request = urllib.request.Request(
                    self._url(ticker),
                    headers={"User-Agent": "RiSKYiNVESTOR-scanner/1.0"},
                )
                with self.opener(request, timeout=self.timeout_seconds) as response:
                    content = response.read().decode("utf-8")
                return parse_yahoo_chart_prices(content, ticker=ticker)
            except Exception as caught:  # bounded retry
                error = caught
                if attempt < self.maximum_retries:
                    time.sleep(min(2**attempt, 8))
        if isinstance(error, MarketDataError):
            raise error
        raise MarketDataError(
            f"yahoo_chart failed for {ticker}: {type(error).__name__}."
        ) from error

    def fetch(self, ticker: str) -> list[PriceBar]:
        try:
            bars = self.fetch_live(ticker)
            self._write_cache(ticker, bars)
            self.cache_fallbacks.discard(ticker)
            return bars
        except Exception as error:
            if self.allow_cache_fallback:
                cached = self._read_cache(ticker)
                if cached:
                    self.cache_fallbacks.add(ticker)
                    self.freshness[ticker] = cached[-1].day.isoformat()
                    return cached
            raise MarketDataError(
                f"Market data unavailable for {ticker} from yahoo_chart: {error}"
            ) from error

    def _write_cache(self, ticker: str, bars: list[PriceBar]) -> None:
        fetched_at = datetime.now(timezone.utc).isoformat()
        atomic_write_json(
            self._cache_path(ticker),
            {
                "fetchedAt": fetched_at,
                "bars": [bar_to_json(bar) for bar in bars],
            },
        )
        self.freshness[ticker] = bars[-1].day.isoformat()

    def _read_cache(self, ticker: str) -> list[PriceBar]:
        cached = self._cache_path(ticker)
        if not cached.exists():
            return []
        payload = json.loads(cached.read_text(encoding="utf-8"))
        return [bar_from_json(item) for item in payload.get("bars", [])]


class FallbackMarketDataProvider:
    def __init__(
        self,
        providers: list[Any],
        cache_dir: Path,
    ) -> None:
        if len(providers) < 2:
            raise ValueError("FallbackMarketDataProvider requires at least two providers.")
        self.providers = providers
        self.cache_dir = cache_dir
        self.cache_fallbacks: set[str] = set()
        self.freshness: dict[str, str] = {}

    def fetch(self, ticker: str) -> list[PriceBar]:
        errors: list[str] = []
        for provider in self.providers:
            try:
                bars = provider.fetch_live(ticker)
                self._write_cache(ticker, bars)
                self.cache_fallbacks.discard(ticker)
                return bars
            except Exception as error:
                errors.append(str(error))
        cached = self._read_cache(ticker)
        if cached:
            self.cache_fallbacks.add(ticker)
            self.freshness[ticker] = cached[-1].day.isoformat()
            return cached
        raise MarketDataError(
            f"Market data unavailable for {ticker}; provider attempts failed: "
            + "; ".join(errors)
        )

    def _cache_path(self, ticker: str) -> Path:
        return _cache_path(self.cache_dir, ticker)

    def _write_cache(self, ticker: str, bars: list[PriceBar]) -> None:
        fetched_at = datetime.now(timezone.utc).isoformat()
        atomic_write_json(
            self._cache_path(ticker),
            {
                "fetchedAt": fetched_at,
                "bars": [bar_to_json(bar) for bar in bars],
            },
        )
        self.freshness[ticker] = bars[-1].day.isoformat()

    def _read_cache(self, ticker: str) -> list[PriceBar]:
        cached = self._cache_path(ticker)
        if not cached.exists():
            return []
        payload = json.loads(cached.read_text(encoding="utf-8"))
        return [bar_from_json(item) for item in payload.get("bars", [])]


def build_market_data_provider(
    provider_config: dict[str, Any],
    cache_dir: Path,
) -> Any:
    fallback_config = provider_config.get("fallbackProvider")
    if isinstance(fallback_config, dict):
        return FallbackMarketDataProvider(
            [
                _provider_from_config(
                    provider_config,
                    cache_dir,
                    allow_cache_fallback=False,
                ),
                _provider_from_config(
                    {
                        "timeoutSeconds": provider_config.get("timeoutSeconds"),
                        "maximumRetries": provider_config.get("maximumRetries"),
                        **fallback_config,
                    },
                    cache_dir,
                    allow_cache_fallback=False,
                ),
            ],
            cache_dir,
        )
    return _provider_from_config(
        provider_config,
        cache_dir,
        allow_cache_fallback=True,
    )


def _provider_from_config(
    provider_config: dict[str, Any],
    cache_dir: Path,
    *,
    allow_cache_fallback: bool,
) -> Any:
    provider_name = str(provider_config["provider"])
    timeout_seconds = int(provider_config["timeoutSeconds"])
    maximum_retries = int(provider_config["maximumRetries"])
    ticker_map = provider_config.get("tickerMap")
    ticker_map = ticker_map if isinstance(ticker_map, dict) else None
    if provider_name == "yahoo_chart":
        return YahooChartMarketDataProvider(
            timeout_seconds=timeout_seconds,
            maximum_retries=maximum_retries,
            cache_dir=cache_dir,
            url_template=str(
                provider_config.get("urlTemplate")
                or DEFAULT_YAHOO_CHART_URL_TEMPLATE
            ),
            ticker_map=ticker_map,
            allow_cache_fallback=allow_cache_fallback,
        )
    return CsvMarketDataProvider(
        url_template=str(provider_config["urlTemplate"]),
        timeout_seconds=timeout_seconds,
        maximum_retries=maximum_retries,
        cache_dir=cache_dir,
        provider_name=provider_name,
        ticker_map=ticker_map,
        allow_cache_fallback=allow_cache_fallback,
    )


def parse_csv_prices(
    content: str,
    *,
    ticker: str = "unknown",
    provider_name: str = "csv",
) -> list[PriceBar]:
    text = content.strip()
    if not text:
        raise MarketDataError(f"{provider_name} returned an empty response for {ticker}.")
    first_line = next((line.strip() for line in content.splitlines() if line.strip()), "")
    lowered_text = text.lower()
    lowered_first = first_line.lower()
    if (
        lowered_first.startswith("<!doctype")
        or lowered_first.startswith("<html")
        or lowered_first.startswith("<")
        or "this site requires javascript to verify your browser" in lowered_text
        or "<script" in lowered_text
    ):
        raise MarketDataError(
            f"{provider_name} returned HTML/browser verification instead of CSV "
            f"for {ticker}."
        )

    lines = content.splitlines()
    reader = csv.DictReader(lines)
    fieldnames = [str(name).strip().lower() for name in (reader.fieldnames or [])]
    has_header = (
        ("date" in fieldnames or "day" in fieldnames)
        and "open" in fieldnames
        and "high" in fieldnames
        and "low" in fieldnames
        and "close" in fieldnames
    )
    if has_header:
        bars = [_bar_from_dict(row) for row in reader]
        bars = [bar for bar in bars if bar is not None]
    else:
        bars = _parse_headerless_csv(lines)

    if not bars:
        raise MarketDataError(
            f"{provider_name} returned no parseable OHLCV rows for {ticker}."
        )
    return bars


def parse_yahoo_chart_prices(content: str, *, ticker: str) -> list[PriceBar]:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as error:
        raise MarketDataError(
            f"yahoo_chart returned non-JSON market data for {ticker}."
        ) from error
    chart = payload.get("chart") if isinstance(payload, dict) else None
    if not isinstance(chart, dict):
        raise MarketDataError(f"yahoo_chart returned malformed data for {ticker}.")
    if chart.get("error"):
        raise MarketDataError(
            f"yahoo_chart returned an error for {ticker}: {chart['error']}."
        )
    results = chart.get("result")
    if not isinstance(results, list) or not results:
        raise MarketDataError(f"yahoo_chart returned no price rows for {ticker}.")
    result = results[0]
    if not isinstance(result, dict):
        raise MarketDataError(f"yahoo_chart returned malformed rows for {ticker}.")
    timestamps = result.get("timestamp")
    indicators = result.get("indicators")
    quotes = (
        indicators.get("quote")
        if isinstance(indicators, dict)
        else None
    )
    quote = quotes[0] if isinstance(quotes, list) and quotes else None
    if not isinstance(timestamps, list) or not isinstance(quote, dict):
        raise MarketDataError(f"yahoo_chart returned no price rows for {ticker}.")
    bars: list[PriceBar] = []
    for index, timestamp in enumerate(timestamps):
        try:
            open_value = quote["open"][index]
            high_value = quote["high"][index]
            low_value = quote["low"][index]
            close_value = quote["close"][index]
            if None in (open_value, high_value, low_value, close_value):
                continue
            bars.append(
                PriceBar(
                    day=datetime.fromtimestamp(
                        int(timestamp),
                        tz=timezone.utc,
                    ).date(),
                    open=float(open_value),
                    high=float(high_value),
                    low=float(low_value),
                    close=float(close_value),
                    volume=float((quote.get("volume") or [0])[index] or 0),
                )
            )
        except (IndexError, KeyError, TypeError, ValueError):
            continue
    if not bars:
        raise MarketDataError(f"yahoo_chart returned no price rows for {ticker}.")
    return bars


def _bar_from_dict(row: dict[str, Any]) -> PriceBar | None:
    lowered = {str(key).lower(): value for key, value in row.items()}
    day_text = lowered.get("date") or lowered.get("day")
    if not day_text:
        return None
    try:
        return PriceBar(
            day=date.fromisoformat(str(day_text)[:10]),
            open=float(lowered["open"]),
            high=float(lowered["high"]),
            low=float(lowered["low"]),
            close=float(lowered["close"]),
            volume=float(lowered.get("volume") or 0),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _parse_headerless_csv(lines: list[str]) -> list[PriceBar]:
    bars: list[PriceBar] = []
    for row in csv.reader(lines):
        if len(row) < 5:
            continue
        try:
            bars.append(
                PriceBar(
                    day=date.fromisoformat(row[0][:10]),
                    open=float(row[1]),
                    high=float(row[2]),
                    low=float(row[3]),
                    close=float(row[4]),
                    volume=float(row[5]) if len(row) > 5 and row[5] else 0,
                )
            )
        except (TypeError, ValueError):
            continue
    return bars


def _assert_public_https_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise MarketDataError("Market-data URL must use HTTPS.")
    if parsed.hostname.lower() == "localhost":
        raise MarketDataError("Market-data host must be public.")
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                parsed.hostname,
                parsed.port or 443,
                type=socket.SOCK_STREAM,
            )
        }
    except socket.gaierror as error:
        raise MarketDataError("Market-data host could not be resolved.") from error
    if not addresses or any(
        not ipaddress.ip_address(address).is_global for address in addresses
    ):
        raise MarketDataError("Market-data host must resolve to public addresses.")


def _normalise_ticker_map(ticker_map: dict[str, str] | None) -> dict[str, str]:
    if not ticker_map:
        return {}
    return {
        str(source).strip().upper(): str(target).strip()
        for source, target in ticker_map.items()
        if str(source).strip() and str(target).strip()
    }


def _cache_path(cache_dir: Path, ticker: str) -> Path:
    safe = "".join(
        character if character.isalnum() else "_"
        for character in ticker.upper()
    )
    return cache_dir / f"{safe}.json"


def bar_to_json(bar: PriceBar) -> dict[str, object]:
    return {
        "date": bar.day.isoformat(),
        "open": bar.open,
        "high": bar.high,
        "low": bar.low,
        "close": bar.close,
        "volume": bar.volume,
    }


def bar_from_json(value: dict[str, object]) -> PriceBar:
    return PriceBar(
        day=date.fromisoformat(str(value["date"])),
        open=float(value["open"]),
        high=float(value["high"]),
        low=float(value["low"]),
        close=float(value["close"]),
        volume=float(value.get("volume") or 0),
    )
