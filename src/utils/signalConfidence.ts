import type {
  ArchivedSignal,
  DashboardSettings,
  StrategyDefinition,
  WatchlistItem,
  WealthSnapshot,
} from "../types";

export function signalConfidence(
  signal: ArchivedSignal,
  watchlist: WatchlistItem[],
  strategies: StrategyDefinition[],
  snapshots: WealthSnapshot[],
  settings: DashboardSettings,
) {
  const asset = watchlist.find(
    (item) =>
      item.tradeTicker === signal.tradeTicker ||
      item.entryTicker === signal.underlyingTicker,
  );
  const strategy = strategies.find(
    (item) =>
      item.name ===
      (signal.strategyName ?? "Baseline Adaptive SuperTrend"),
  );
  const sortedSnapshots = [...snapshots].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const latest = sortedSnapshots.at(-1)?.totalPortfolioValue ?? 0;
  const peak = Math.max(0, ...sortedSnapshots.map((item) => item.totalPortfolioValue));
  const drawdown = peak > 0 ? ((latest - peak) / peak) * 100 : 0;

  if (signal.riskTier === "EXCLUDED") {
    return { label: "Do not trade", tone: "red" as const, score: 0 };
  }
  if (signal.riskTier === "SPECULATIVE") {
    return { label: "Watchlist only", tone: "purple" as const, score: 25 };
  }
  if (
    Math.abs(drawdown) >= settings.riskLimits.elevatedDrawdownPct &&
    signal.signalType === "ENTRY"
  ) {
    return { label: "High drawdown risk", tone: "red" as const, score: 35 };
  }
  if (asset?.liquidityStatus === "Low" || signal.liquidityWarning) {
    return { label: "Weak liquidity", tone: "amber" as const, score: 45 };
  }
  if (signal.riskTier === "AGGRESSIVE") {
    return { label: "Aggressive", tone: "amber" as const, score: 60 };
  }
  if (
    asset?.currentTrend === "Green" &&
    (strategy?.historicalQuality ?? 0) >= 75
  ) {
    return { label: "Strong signal", tone: "green" as const, score: 85 };
  }
  return { label: "Normal signal", tone: "blue" as const, score: 70 };
}
