from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from .market_data import PriceBar


@dataclass(frozen=True)
class SuperTrendPoint:
    date: str
    close: float
    value: float
    state: str
    direction: int | None = None
    factor: float | None = None
    raw_multiplier: float | None = None
    atr: float | None = None
    prior_atr: float | None = None


def rma(values: list[float], length: int) -> list[float | None]:
    if length <= 0:
        raise ValueError("RMA length must be positive.")
    if len(values) < length:
        return [None] * len(values)
    result: list[float | None] = [None] * len(values)
    seed = sum(values[:length]) / length
    result[length - 1] = seed
    for index in range(length, len(values)):
        previous = result[index - 1]
        if previous is None:
            previous = seed
        result[index] = (previous * (length - 1) + values[index]) / length
    return result


def true_ranges(bars: list[PriceBar]) -> list[float]:
    ranges: list[float] = []
    for index, bar in enumerate(bars):
        previous_close = bars[index - 1].close if index else bar.close
        ranges.append(
            max(
                bar.high - bar.low,
                abs(bar.high - previous_close),
                abs(bar.low - previous_close),
            )
        )
    return ranges


def atr_rma(bars: list[PriceBar], length: int) -> list[float | None]:
    return rma(true_ranges(bars), length)


def adaptive_supertrend_factor(
    current_atr: float,
    prior_atr: float,
    *,
    switch_stoploss: bool = False,
) -> tuple[float, float]:
    if prior_atr <= 0:
        raw_multiplier = 1.0
    else:
        zone_size = prior_atr / 4
        if current_atr <= zone_size:
            raw_multiplier = 5.0
        elif current_atr <= zone_size * 2:
            raw_multiplier = 3.0
        elif current_atr <= zone_size * 3:
            raw_multiplier = 1.5
        else:
            raw_multiplier = 1.0
    current_factor = raw_multiplier if switch_stoploss else 6.0 - raw_multiplier
    return current_factor, raw_multiplier


def supertrend(
    bars: list[PriceBar],
    atr_period: int,
    multiplier: float | None = None,
    *,
    smoothing: str = "RMA",
    switch_stoploss: bool = False,
    use_confirmed: bool = True,
) -> list[SuperTrendPoint]:
    if smoothing.upper() != "RMA":
        raise ValueError("Only RMA smoothing is supported for TradingView parity.")
    source_bars = _confirmed_daily_bars(bars) if use_confirmed else list(bars)
    if len(source_bars) < atr_period + 2:
        return []
    atrs = atr_rma(source_bars, atr_period)
    points: list[SuperTrendPoint] = []
    upper_band = lower_band = supertrend_value = None
    direction = 1
    for index in range(atr_period, len(source_bars)):
        bar = source_bars[index]
        atr = atrs[index]
        prior_atr = atrs[index - 1]
        if atr is None or prior_atr is None:
            continue
        factor, raw_multiplier = adaptive_supertrend_factor(
            atr,
            prior_atr,
            switch_stoploss=switch_stoploss,
        )
        midpoint = (bar.high + bar.low) / 2
        basic_upper = midpoint + factor * atr
        basic_lower = midpoint - factor * atr
        previous_close = source_bars[index - 1].close
        previous_upper = upper_band
        previous_lower = lower_band
        previous_supertrend = supertrend_value
        if previous_upper is None:
            upper_band = basic_upper
        else:
            upper_band = (
                basic_upper
                if basic_upper < previous_upper or previous_close > previous_upper
                else previous_upper
            )
        if previous_lower is None:
            lower_band = basic_lower
        else:
            lower_band = (
                basic_lower
                if basic_lower > previous_lower or previous_close < previous_lower
                else previous_lower
            )

        if previous_supertrend is None:
            direction = 1
        elif previous_upper is not None and previous_supertrend == previous_upper:
            direction = -1 if bar.close > upper_band else 1
        else:
            direction = 1 if bar.close < lower_band else -1

        state = "in" if direction < 0 else "out"
        supertrend_value = lower_band if direction < 0 else upper_band
        points.append(
            SuperTrendPoint(
                date=bar.day.isoformat(),
                close=bar.close,
                value=supertrend_value,
                state=state,
                direction=direction,
                factor=factor,
                raw_multiplier=raw_multiplier,
                atr=atr,
                prior_atr=prior_atr,
            )
        )
    return points


def simple_moving_average(bars: list[PriceBar], length: int) -> float | None:
    if len(bars) < length:
        return None
    return sum(bar.close for bar in bars[-length:]) / length


def _confirmed_daily_bars(bars: list[PriceBar]) -> list[PriceBar]:
    if bars and bars[-1].day >= date.today():
        return list(bars[:-1])
    return list(bars)
