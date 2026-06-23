import type {
  DashboardData,
  MultiStrategyPosition,
  MultiStrategyRecord,
  SignalEvent,
} from "../types";
import {
  buildSignalMonitorModel,
  type Sma200SignalSummary,
} from "./signalMonitorRows";
import { collectSnapshotPerformanceWarnings } from "./modelWarnings";
import { currentSignalActions } from "./signalEventAlerts";
import {
  canonicalGeneratedAt,
  canonicalSignalDate,
  sortStrategyBySignalDate,
} from "./signalDates";

export type DashboardScannerStatus = "current" | "stale" | "error" | "awaiting";
export type DashboardActionType =
  | "entry"
  | "exit"
  | "risk_on"
  | "risk_off"
  | "scanner_error";

export interface DashboardScannerHealth {
  status: DashboardScannerStatus;
  label: string;
  generatedAt: string | null;
  marketDataFreshness: string | null;
  activeStrategies: number;
  errors: string[];
  warnings: string[];
}

export interface DashboardActionItem {
  key: string;
  strategyName: string;
  signalTicker: string;
  executionTicker: string;
  eventType: DashboardActionType;
  occurredAt: string;
  signalDate: string;
  generatedAt: string;
  reason: string;
  modelPositionOpen: boolean;
}

export interface DashboardModelPosition {
  key: string;
  strategyName: string;
  signalTicker: string;
  executionTicker: string;
  entryTimestamp: string | null;
  daysHeld: number | null;
  openPnlPercent: number | null;
  allocation: number | null;
  latestSignal: string | null;
  reason: string | null;
}

export interface DashboardSuperTrendSummary {
  totalPairs: number;
  greenCount: number;
  redCount: number;
  changedThisWeekCount: number;
  openModelPositions: number;
  modelValue: number | null;
  drawdownPercent: number | null;
}

export interface DashboardSma200Summary extends Sma200SignalSummary {
  entryDate: string | null;
  distanceFromSma200: string | null;
  modelValue: number | null;
  drawdownPercent: number | null;
}

export interface DashboardCommandCentreModel {
  hasScannerSnapshot: boolean;
  scanner: DashboardScannerHealth;
  actionItems: DashboardActionItem[];
  currentModelPositions: DashboardModelPosition[];
  superTrend: DashboardSuperTrendSummary;
  sma200: DashboardSma200Summary | null;
  recentHistoryEvents: SignalEvent[];
  scannerErrorsHiddenFromHistory: boolean;
}

export const dashboardSignalEventProcessingLimit = 500;

export function buildDashboardCommandCentreModel(
  data: DashboardData,
): DashboardCommandCentreModel {
  const snapshot = data.strategyMonitor.snapshot;
  const signalMonitor = buildSignalMonitorModel(snapshot);
  const strategies = snapshot?.strategies ?? [];
  const superTrendStrategy = strategies.find(
    (strategy) => strategy.strategyId === "daily-supertrend",
  );
  const smaStrategy = strategies.find(
    (strategy) => strategy.strategyId === "nasdaq-sma200-3x",
  );
  const scanner = buildScannerHealth(data);
  const scannerHealthy = scanner.status === "current";
  const rawSignalEventCandidates = data.signalEvents.events.slice(
    0,
    dashboardSignalEventProcessingLimit,
  );
  const signalEventCandidates = scannerHealthy
    ? rawSignalEventCandidates.filter(
        (event) => event.signalState !== "scanner_error",
      )
    : rawSignalEventCandidates;
  const recentHistoryEvents = scannerHealthy
    ? signalEventCandidates.filter(
        (event) => event.signalState !== "scanner_error",
      )
    : signalEventCandidates;

  return {
    hasScannerSnapshot: Boolean(snapshot),
    scanner,
    actionItems: buildActionItems(signalEventCandidates, strategies, scanner),
    currentModelPositions: buildCurrentModelPositions(strategies),
    superTrend: {
      ...signalMonitor.summary,
      modelValue: superTrendStrategy?.modelValue ?? null,
      drawdownPercent: superTrendStrategy?.drawdownPercent ?? null,
    },
    sma200:
      signalMonitor.sma200 && smaStrategy
        ? {
            ...signalMonitor.sma200,
            entryDate:
              signalMonitor.sma200.modelPosition === "open"
                ? (smaStrategy.virtualPositions[0]?.entryTimestamp ??
                  smaStrategy.regimeStartDate ??
                  null)
                : null,
            distanceFromSma200: extractSmaDistance(
              latestEventReason(smaStrategy),
            ),
            modelValue: smaStrategy.modelValue,
            drawdownPercent: smaStrategy.drawdownPercent,
          }
        : null,
    recentHistoryEvents,
    scannerErrorsHiddenFromHistory:
      scannerHealthy &&
      rawSignalEventCandidates.some(
        (event) => event.signalState === "scanner_error",
      ),
  };
}

function buildScannerHealth(data: DashboardData): DashboardScannerHealth {
  const snapshot = data.strategyMonitor.snapshot;
  const snapshotStatus = snapshot?.scanner.status;
  let status: DashboardScannerStatus = data.scannerImport.status;

  if (data.scannerImport.status === "error" || snapshotStatus === "error") {
    status = "error";
  } else if (
    data.scannerImport.status === "stale" ||
    snapshotStatus === "stale"
  ) {
    status = "stale";
  } else if (!snapshot) {
    status = "awaiting";
  } else if (!data.strategyMonitor.currentFileValid) {
    status = "error";
  } else {
    status = "current";
  }

  const generatedAt =
    snapshot?.generatedAt ??
    data.scannerImport.lastGeneratedAt ??
    data.scannerImport.lastSuccessfulScanAt;
  const marketDataFreshness =
    snapshot?.scanner.dataFreshness?.generatedAt ??
    latestStrategyFreshness(snapshot?.strategies ?? []) ??
    data.scannerImport.lastSuccessfulScanAt;
  const errors =
    status === "error"
      ? compactUnique([
          data.scannerImport.lastError,
          data.strategyMonitor.lastError,
          ...(snapshot?.scanner.errors.map((error) => error.message) ?? []),
        ])
      : [];

  return {
    status,
    label: statusLabel(status),
    generatedAt,
    marketDataFreshness,
    activeStrategies: (snapshot?.strategies ?? []).filter(
      (strategy) =>
        strategy.enabled &&
        strategy.configured &&
        !["disabled", "not_configured"].includes(strategy.status),
    ).length,
    errors,
    warnings: collectSnapshotPerformanceWarnings(snapshot).map(
      (warning) => warning.message,
    ),
  };
}

function buildActionItems(
  events: SignalEvent[],
  strategies: MultiStrategyRecord[],
  scanner: DashboardScannerHealth,
) {
  return currentSignalActions(events, {
    scannerStatus: scanner.status,
    scannerGeneratedAt: scanner.generatedAt,
  })
    .flatMap((event) => {
      const strategy = strategies.find(
        (candidate) => candidate.strategyId === event.strategyId,
      );
      const eventType = dashboardActionType(event);
      if (!eventType) return [];
      return [
        {
          key: event.eventId,
          strategyName: event.strategyName,
          signalTicker: event.underlyingTicker,
          executionTicker: event.tradeTicker,
          eventType,
          occurredAt: event.occurredAt,
          signalDate: canonicalSignalDate(event),
          generatedAt: canonicalGeneratedAt(event),
          reason: event.reasonText,
          modelPositionOpen: Boolean(
            strategy &&
              findPosition(
                strategy.virtualPositions,
                event.underlyingTicker,
                event.tradeTicker,
              ),
          ),
        },
      ];
    })
    .sort(
      (left, right) =>
        right.signalDate.localeCompare(left.signalDate) ||
        right.generatedAt.localeCompare(left.generatedAt),
    );
}

function buildCurrentModelPositions(strategies: MultiStrategyRecord[]) {
  return strategies
    .flatMap((strategy) =>
      strategy.virtualPositions.map((position) => ({
        key: position.positionId,
        strategyName: strategy.name,
        signalTicker: position.signalTicker,
        executionTicker: position.executionTicker,
        entryTimestamp: position.entryTimestamp,
        daysHeld: position.daysHeld,
        openPnlPercent: position.openPnlPercent,
        allocation: position.allocation,
        latestSignal: position.latestSignal,
        reason: position.reason,
      })),
    )
    .sort((left, right) => {
      const byStrategy = left.strategyName.localeCompare(right.strategyName);
      return byStrategy || left.signalTicker.localeCompare(right.signalTicker);
    });
}

function dashboardActionType(event: SignalEvent): DashboardActionType | null {
  if (event.signalState === "scanner_error") return "scanner_error";
  if (
    event.signalState !== "actionable_entry" &&
    event.signalState !== "actionable_exit"
  ) {
    return null;
  }
  if (event.strategyId === "nasdaq-sma200-3x") {
    return event.signalState === "actionable_entry" ? "risk_on" : "risk_off";
  }
  return event.signalState === "actionable_entry" ? "entry" : "exit";
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

function latestEventReason(strategy: MultiStrategyRecord) {
  return (
    strategy.latestEvent?.reason ??
    [...strategy.events].sort(sortStrategyBySignalDate)[0]
      ?.reason ??
    null
  );
}

function extractSmaDistance(reason: string | null) {
  if (!reason) return null;
  const direct = reason.match(
    /([+-]?\d+(?:\.\d+)?%)\s+(?:above|below|from|over|under)\s+(?:the\s+)?SMA(?:200)?/i,
  );
  if (direct) return direct[0];
  const afterSma = reason.match(/SMA(?:200)?[^.]*?([+-]?\d+(?:\.\d+)?%)/i);
  return afterSma?.[1] ?? null;
}

function latestStrategyFreshness(strategies: MultiStrategyRecord[]) {
  return strategies
    .map((strategy) => strategy.dataFreshness)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
}

function statusLabel(status: DashboardScannerStatus) {
  if (status === "current") return "Current";
  if (status === "stale") return "Stale";
  if (status === "error") return "Error";
  return "Awaiting data";
}

function compactUnique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function sameTicker(left: string, right: string) {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}
