from __future__ import annotations

from dataclasses import dataclass
from .market_data import PriceBar


@dataclass(frozen=True)
class SuperTrendPoint:
    date: str
    close: float
    value: float
    state: str


def supertrend(
    bars: list[PriceBar],
    atr_period: int,
    multiplier: float,
) -> list[SuperTrendPoint]:
    if len(bars) < atr_period + 1:
        return []
    true_ranges: list[float] = []
    for index, bar in enumerate(bars):
        previous_close = bars[index - 1].close if index else bar.close
        true_ranges.append(
            max(
                bar.high - bar.low,
                abs(bar.high - previous_close),
                abs(bar.low - previous_close),
            )
        )
    atrs: list[float | None] = [None] * len(bars)
    seed = sum(true_ranges[1 : atr_period + 1]) / atr_period
    atrs[atr_period] = seed
    for index in range(atr_period + 1, len(bars)):
        previous = atrs[index - 1] or seed
        atrs[index] = (
            previous * (atr_period - 1) + true_ranges[index]
        ) / atr_period

    points: list[SuperTrendPoint] = []
    final_upper = final_lower = 0.0
    previous_state = "out"
    for index in range(atr_period, len(bars)):
        bar = bars[index]
        atr = atrs[index] or 0
        midpoint = (bar.high + bar.low) / 2
        basic_upper = midpoint + multiplier * atr
        basic_lower = midpoint - multiplier * atr
        previous_close = bars[index - 1].close
        if index == atr_period:
            final_upper, final_lower = basic_upper, basic_lower
        else:
            final_upper = (
                basic_upper
                if basic_upper < final_upper or previous_close > final_upper
                else final_upper
            )
            final_lower = (
                basic_lower
                if basic_lower > final_lower or previous_close < final_lower
                else final_lower
            )
        if bar.close > final_upper:
            state = "in"
        elif bar.close < final_lower:
            state = "out"
        else:
            state = previous_state
        value = final_lower if state == "in" else final_upper
        points.append(
            SuperTrendPoint(
                date=bar.day.isoformat(),
                close=bar.close,
                value=value,
                state=state,
            )
        )
        previous_state = state
    return points


def simple_moving_average(bars: list[PriceBar], length: int) -> float | None:
    if len(bars) < length:
        return None
    return sum(bar.close for bar in bars[-length:]) / length
