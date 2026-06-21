from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable
import csv
import ipaddress
import json
import socket
import time
import urllib.parse
import urllib.request

from .storage import atomic_write_json


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


class CsvMarketDataProvider:
    def __init__(
        self,
        url_template: str,
        timeout_seconds: int,
        maximum_retries: int,
        cache_dir: Path,
    ) -> None:
        self.url_template = url_template
        self.timeout_seconds = timeout_seconds
        self.maximum_retries = maximum_retries
        self.cache_dir = cache_dir
        self.cache_fallbacks: set[str] = set()
        self.freshness: dict[str, str] = {}

    def _url(self, ticker: str) -> str:
        url = self.url_template.format(
            ticker=urllib.parse.quote(ticker, safe="")
        )
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise MarketDataError("Market-data URL must use HTTPS.")
        if parsed.hostname.lower() == "localhost":
            raise MarketDataError("Market-data host must be public.")
        try:
            addresses = {
                item[4][0]
                for item in socket.getaddrinfo(
                    parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM
                )
            }
        except socket.gaierror as error:
            raise MarketDataError("Market-data host could not be resolved.") from error
        if not addresses or any(
            not ipaddress.ip_address(address).is_global for address in addresses
        ):
            raise MarketDataError("Market-data host must resolve to public addresses.")
        return url

    def _cache_path(self, ticker: str) -> Path:
        safe = "".join(
            character if character.isalnum() else "_"
            for character in ticker.upper()
        )
        return self.cache_dir / f"{safe}.json"

    def fetch(self, ticker: str) -> list[PriceBar]:
        error: Exception | None = None
        for attempt in range(self.maximum_retries + 1):
            try:
                request = urllib.request.Request(
                    self._url(ticker),
                    headers={"User-Agent": "RiSKYiNVESTOR-scanner/1.0"},
                )
                with urllib.request.urlopen(
                    request, timeout=self.timeout_seconds
                ) as response:
                    content = response.read().decode("utf-8-sig")
                bars = list(parse_csv_prices(content))
                if not bars:
                    raise MarketDataError(f"No price rows returned for {ticker}.")
                fetched_at = datetime.now(timezone.utc).isoformat()
                atomic_write_json(
                    self._cache_path(ticker),
                    {
                        "fetchedAt": fetched_at,
                        "bars": [bar_to_json(bar) for bar in bars],
                    },
                )
                self.freshness[ticker] = bars[-1].day.isoformat()
                self.cache_fallbacks.discard(ticker)
                return bars
            except Exception as caught:  # bounded retry then cached fallback
                error = caught
                if attempt < self.maximum_retries:
                    time.sleep(min(2**attempt, 8))
        cached = self._cache_path(ticker)
        if cached.exists():
            payload = json.loads(cached.read_text(encoding="utf-8"))
            bars = [bar_from_json(item) for item in payload.get("bars", [])]
            if bars:
                self.cache_fallbacks.add(ticker)
                self.freshness[ticker] = bars[-1].day.isoformat()
                return bars
        raise MarketDataError(
            f"Market data unavailable for {ticker}: {type(error).__name__}."
        )


def parse_csv_prices(content: str) -> Iterable[PriceBar]:
    reader = csv.DictReader(content.splitlines())
    for row in reader:
        lowered = {str(key).lower(): value for key, value in row.items()}
        day_text = lowered.get("date") or lowered.get("day")
        if not day_text:
            continue
        try:
            yield PriceBar(
                day=date.fromisoformat(day_text[:10]),
                open=float(lowered["open"]),
                high=float(lowered["high"]),
                low=float(lowered["low"]),
                close=float(lowered["close"]),
                volume=float(lowered.get("volume") or 0),
            )
        except (KeyError, TypeError, ValueError):
            continue


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
