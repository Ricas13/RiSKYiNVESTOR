import type {
  MultiStrategyEvent,
  MultiStrategyPosition,
  MultiStrategyRecord,
  MultiStrategySnapshot,
  StrategyEventType,
} from "../types";

export type SignalRowStatus = "in" | "out" | "awaiting" | "error";

export interface SuperTrendSignalRow {
  signalTicker: string;
  executionTicker: string;
  strategy: string;
  enabled: boolean;
  status: SignalRowStatus;
  statusLabel: string;
  latestEventType: StrategyEventType | "none";
  latestSignalDate: string | null;
  changedThisWeek: boolean;
  modelPosition: "open" | "none";
  openPnlValue: number | null;
  openPnlPercent: number | null;
  daysHeld: number | null;
  dataFreshness: string | null;
  latestReason: string | null;
}

export interface Sma200SignalSummary {
  strategy: string;
  referenceTicker: string | null;
  executionTicker: string | null;
  currentRegime: string;
  latestEventType: StrategyEventType | "none";
  latestSignalDate: string | null;
  modelPosition: "open" | "none";
  openPnlValue: number | null;
  openPnlPercent: number | null;
  daysHeld: number | null;
}

export interface SignalMonitorModel {
  rows: SuperTrendSignalRow[];
  sma200: Sma200SignalSummary | null;
  summary: {
    totalPairs: number;
    greenCount: number;
    redCount: number;
    changedThisWeekCount: number;
    openModelPositions: number;
    scannerFreshness: string | null;
  };
}

interface WatchlistRow {
  signalTicker: string;
  executionTicker: string;
  enabled: boolean;
}

const eventPriority: Record<string, number> = {
  entry: 0,
  exit: 1,
  scannerError: 2,
  none: 3,
};

export function buildSignalMonitorModel(
  snapshot: MultiStrategySnapshot | null,
): SignalMonitorModel {
  if (!snapshot) {
    return {
      rows: [],
      sma200: null,
      summary: {
        totalPairs: 0,
        greenCount: 0,
        redCount: 0,
        changedThisWeekCount: 0,
        openModelPositions: 0,
        scannerFreshness: null,
      },
    };
  }

  const superTrend = snapshot.strategies.find(
    (strategy) => strategy.strategyId === "daily-supertrend",
  );
  const sma = snapshot.strategies.find(
    (strategy) => strategy.strategyId === "nasdaq-sma200-3x",
  );
  const anchorDate =
    snapshot.scanner.dataFreshness?.generatedAt ?? snapshot.generatedAt;

  const rows = superTrend
    ? watchlistRows(superTrend)
        .map((watchlistRow) =>
          toSuperTrendSignalRow(superTrend, watchlistRow, anchorDate),
        )
        .sort(sortSignalRows)
    : [];

  return {
    rows,
    sma200: sma ? toSma200Summary(sma) : null,
    summary: {
      totalPairs: rows.length,
      greenCount: rows.filter((row) => row.status === "in").length,
      redCount: rows.filter((row) => row.status === "out").length,
      changedThisWeekCount: rows.filter((row) => row.changedThisWeek).length,
      openModelPositions: rows.filter((row) => row.modelPosition === "open")
        .length,
      scannerFreshness: anchorDate,
    },
  };
}

function toSuperTrendSignalRow(
  strategy: MultiStrategyRecord,
  watchlistRow: WatchlistRow,
  anchorDate: string,
): SuperTrendSignalRow {
  const position = findPosition(
    strategy.virtualPositions,
    watchlistRow.signalTicker,
    watchlistRow.executionTicker,
  );
  const latestEvent =
    latestMatchingEvent(
      strategy.events,
      watchlistRow.signalTicker,
      watchlistRow.executionTicker,
    ) ??
    (strategy.status === "error"
      ? latestEventOfType(strategy.events, "scannerError")
      : undefined);
  const status = rowStatus(strategy, watchlistRow, position, latestEvent);

  return {
    signalTicker: watchlistRow.signalTicker,
    executionTicker: watchlistRow.executionTicker,
    strategy: strategy.name,
    enabled: watchlistRow.enabled,
    status,
    statusLabel: rowStatusLabel(status),
    latestEventType: latestEvent?.eventType ?? "none",
    latestSignalDate: latestEvent?.occurredAt ?? null,
    changedThisWeek:
      latestEvent?.eventType === "entry" || latestEvent?.eventType === "exit"
        ? isSameUtcWeek(latestEvent.occurredAt, anchorDate)
        : false,
    modelPosition: position ? "open" : "none",
    openPnlValue: position?.openPnlValue ?? null,
    openPnlPercent: position?.openPnlPercent ?? null,
    daysHeld: position?.daysHeld ?? null,
    dataFreshness: strategy.dataFreshness ?? anchorDate,
    latestReason: latestEvent?.reason ?? null,
  };
}

function toSma200Summary(strategy: MultiStrategyRecord): Sma200SignalSummary {
  const latestEvent = strategy.latestEvent ?? latestEventFrom(strategy.events);
  const position = strategy.virtualPositions[0];
  return {
    strategy: strategy.name,
    referenceTicker:
      strategy.referenceTicker ??
      latestEvent?.signalTicker ??
      textParameter(strategy, "referenceTicker"),
    executionTicker:
      strategy.executionTicker ??
      position?.executionTicker ??
      latestEvent?.executionTicker ??
      textParameter(strategy, "riskOnTicker"),
    currentRegime: strategy.currentState,
    latestEventType: latestEvent?.eventType ?? "none",
    latestSignalDate: latestEvent?.occurredAt ?? null,
    modelPosition: position ? "open" : "none",
    openPnlValue: position?.openPnlValue ?? null,
    openPnlPercent: position?.openPnlPercent ?? null,
    daysHeld: position?.daysHeld ?? null,
  };
}

function watchlistRows(strategy: MultiStrategyRecord): WatchlistRow[] {
  const rawRows = strategy.parameters.watchlist;
  if (!Array.isArray(rawRows)) return [];
  return rawRows.flatMap((value) => {
    if (!isRecord(value)) return [];
    const signalTicker = stringValue(value.signalTicker).toUpperCase();
    const executionTicker = stringValue(value.executionTicker).toUpperCase();
    if (!signalTicker && !executionTicker) return [];
    return [
      {
        signalTicker,
        executionTicker,
        enabled: value.enabled === true,
      },
    ];
  });
}

function rowStatus(
  strategy: MultiStrategyRecord,
  watchlistRow: WatchlistRow,
  position: MultiStrategyPosition | undefined,
  latestEvent: MultiStrategyEvent | undefined,
): SignalRowStatus {
  if (latestEvent?.eventType === "scannerError" || strategy.status === "error") {
    return "error";
  }
  if (
    !watchlistRow.enabled ||
    strategy.status === "disabled" ||
    strategy.status === "awaiting_data" ||
    strategy.status === "not_configured"
  ) {
    return "awaiting";
  }
  return position ? "in" : "out";
}

function rowStatusLabel(status: SignalRowStatus) {
  if (status === "in") return "In market / green";
  if (status === "out") return "Out of market / red";
  if (status === "error") return "Error";
  return "Awaiting data";
}

function findPosition(
  positions: MultiStrategyPosition[],
  signalTicker: string,
  executionTicker: string,
) {
  return positions.find(
    (position) =>
      sameTicker(position.signalTicker, signalTicker) &&
      sameTicker(position.executionTicker, executionTicker),
  );
}

function latestMatchingEvent(
  events: MultiStrategyEvent[],
  signalTicker: string,
  executionTicker: string,
) {
  return latestEventFrom(
    events.filter(
      (event) =>
        sameTicker(event.signalTicker, signalTicker) &&
        sameTicker(event.executionTicker, executionTicker),
    ),
  );
}

function latestEventOfType(
  events: MultiStrategyEvent[],
  eventType: StrategyEventType,
) {
  return latestEventFrom(events.filter((event) => event.eventType === eventType));
}

function latestEventFrom(events: MultiStrategyEvent[]) {
  return [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
}

function sortSignalRows(
  left: SuperTrendSignalRow,
  right: SuperTrendSignalRow,
) {
  if (left.changedThisWeek !== right.changedThisWeek) {
    return left.changedThisWeek ? -1 : 1;
  }
  if (left.modelPosition !== right.modelPosition) {
    return left.modelPosition === "open" ? -1 : 1;
  }
  const leftPriority = eventPriority[left.latestEventType] ?? 4;
  const rightPriority = eventPriority[right.latestEventType] ?? 4;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return left.signalTicker.localeCompare(right.signalTicker);
}

function isSameUtcWeek(value: string, anchor: string) {
  const date = parseDate(value);
  const anchorDate = parseDate(anchor);
  if (!date || !anchorDate) return false;
  const start = startOfUtcWeek(anchorDate);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return date >= start && date < end;
}

function startOfUtcWeek(value: Date) {
  const date = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date;
}

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function textParameter(strategy: MultiStrategyRecord, key: string) {
  const value = strategy.parameters[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sameTicker(left: string, right: string) {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
