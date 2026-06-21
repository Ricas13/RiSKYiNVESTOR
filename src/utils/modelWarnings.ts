import type {
  ModelPerformanceWarning,
  MultiStrategyRecord,
  MultiStrategySnapshot,
} from "../types";

export function collectSnapshotPerformanceWarnings(
  snapshot: MultiStrategySnapshot | null,
) {
  if (!snapshot) return [];
  return compactWarnings([
    ...warningValues(snapshot.scanner.warnings),
    ...snapshot.strategies.flatMap((strategy) =>
      collectStrategyPerformanceWarnings(strategy),
    ),
  ]);
}

export function collectStrategyPerformanceWarnings(
  strategy: MultiStrategyRecord,
) {
  return compactWarnings([
    ...warningValues(strategy.warnings),
    ...strategy.virtualPositions.flatMap((position) =>
      warningValues(position.warnings),
    ),
    ...strategy.closedVirtualTrades.flatMap((trade) =>
      warningValues((trade as { warnings?: unknown }).warnings),
    ),
  ]);
}

export function affectedTickerText(warning: ModelPerformanceWarning) {
  return warning.affectedTickers.length
    ? warning.affectedTickers.join(" → ")
    : "strategy book";
}

export function compactWarnings(warnings: ModelPerformanceWarning[]) {
  const seen = new Set<string>();
  const result: ModelPerformanceWarning[] = [];
  for (const warning of warnings) {
    const key = JSON.stringify({
      code: warning.code,
      message: warning.message,
      affectedTickers: warning.affectedTickers,
      metric: warning.metric,
      value: warning.value,
      threshold: warning.threshold,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(warning);
  }
  return result;
}

function warningValues(value: unknown): ModelPerformanceWarning[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isModelPerformanceWarning);
}

function isModelPerformanceWarning(
  value: unknown,
): value is ModelPerformanceWarning {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const warning = value as Record<string, unknown>;
  return (
    warning.severity === "warning" &&
    typeof warning.code === "string" &&
    typeof warning.message === "string" &&
    Array.isArray(warning.affectedTickers)
  );
}
