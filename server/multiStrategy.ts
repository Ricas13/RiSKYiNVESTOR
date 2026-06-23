import { readFile } from "node:fs/promises";
import path from "node:path";
import { JsonStore } from "./store.js";

export interface MultiStrategyEvent {
  eventId: string;
  strategyId: "daily-supertrend" | "nasdaq-sma200-3x";
  eventType:
    | "entry"
    | "exit"
    | "lowLiquidity"
    | "stateUpdate"
    | "dailySummary"
    | "weeklySummary"
    | "scannerError";
  occurredAt: string;
  signalTicker: string;
  executionTicker: string;
  calculationTicker?: string;
  reason: string;
}

export interface ModelPerformanceWarning {
  severity: "warning";
  code: string;
  message: string;
  affectedTickers: string[];
  metric?: string;
  value?: number | string;
  threshold?: number | string;
  strategyId?: string;
}

export interface MultiStrategyPosition {
  positionId: string;
  label: "Virtual model position";
  signalTicker: string;
  executionTicker: string;
  state: string;
  entryTimestamp: string | null;
  entryPrice: number | null;
  latestPrice: number | null;
  quantity: number;
  allocation: number;
  openPnlValue: number;
  openPnlPercent: number;
  daysHeld: number;
  latestSignal: string;
  reason: string;
  warnings?: ModelPerformanceWarning[];
  [key: string]: unknown;
}

export interface MultiStrategyRecord {
  strategyId: "daily-supertrend" | "nasdaq-sma200-3x";
  name: string;
  enabled: boolean;
  configured: boolean;
  status: string;
  ruleSummary: string;
  parameters: Record<string, unknown>;
  currentState: string;
  modelValue: number | null;
  returnPercent: number | null;
  drawdownPercent: number | null;
  exposurePercent: number;
  cash?: number;
  investedValue?: number;
  regimeStartDate?: string | null;
  referenceTicker?: string;
  executionTicker?: string;
  equitySnapshots: Array<{ date: string; value: number }>;
  virtualPositions: MultiStrategyPosition[];
  closedVirtualTrades: Array<Record<string, unknown>>;
  events: MultiStrategyEvent[];
  regimeChangeEvents?: MultiStrategyEvent[];
  latestEvent: MultiStrategyEvent | null;
  dataFreshness: string | null;
  warnings?: ModelPerformanceWarning[];
  diagnostics?: Array<Record<string, unknown>>;
}

export interface MultiStrategySnapshot {
  schemaVersion: "multi_strategy_v1";
  generatedAt: string;
  scanner: {
    name: string;
    version: string;
    status: string;
    errors: Array<{ strategyId?: string; message: string }>;
    warnings?: ModelPerformanceWarning[];
    dataFreshness:
      | {
          generatedAt: string;
          staleAfterMinutes: number;
        }
      | null;
  };
  strategies: MultiStrategyRecord[];
}

export interface MultiStrategyPublicState {
  source: "current" | "last_known_good" | "awaiting";
  currentFileValid: boolean;
  lastError: string | null;
  snapshot: MultiStrategySnapshot | null;
}

export const defaultStrategyEventImportLimit = 500;
export const defaultPublicStrategyEventLimit = 250;
export const defaultPublicScannerWarningLimit = 50;
export const defaultPublicStrategyWarningLimit = 50;
export const defaultPublicPositionWarningLimit = 10;
export const defaultPublicClosedTradeLimit = 100;
export const defaultPublicEquitySnapshotLimit = 500;
export const defaultPublicScannerErrorLimit = 25;
export const defaultPublicStrategyDiagnosticLimit = 100;

function objectValue(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function textValue(value: unknown, label: string, maximum = 500) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text.slice(0, maximum);
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid numeric value.");
  return number;
}

function numberValue(value: unknown) {
  const number = optionalNumber(value);
  if (number === null) throw new Error("Numeric value is required.");
  return number;
}

function eventValue(
  value: unknown,
  expectedStrategyId: MultiStrategyEvent["strategyId"],
): MultiStrategyEvent {
  const event = objectValue(value, "Strategy event");
  const eventType = textValue(event.eventType, "Event type");
  if (
    ![
      "entry",
      "exit",
      "lowLiquidity",
      "stateUpdate",
      "dailySummary",
      "weeklySummary",
      "scannerError",
    ].includes(eventType)
  ) {
    throw new Error("Unsupported strategy event type.");
  }
  if (event.strategyId !== expectedStrategyId) {
    throw new Error("Strategy event is assigned to the wrong strategy.");
  }
  const occurredAt = textValue(event.occurredAt, "Event timestamp");
  if (Number.isNaN(new Date(occurredAt).getTime())) {
    throw new Error("Event timestamp is invalid.");
  }
  const signalTicker = textValue(event.signalTicker, "Signal ticker", 80);
  const executionTicker = textValue(
    event.executionTicker,
    "Execution ticker",
    80,
  );
  const calculationTicker =
    typeof event.calculationTicker === "string" && event.calculationTicker.trim()
      ? event.calculationTicker.trim().slice(0, 80)
      : signalTicker;
  return {
    eventId: textValue(event.eventId, "Event ID", 200),
    strategyId: expectedStrategyId,
    eventType: eventType as MultiStrategyEvent["eventType"],
    occurredAt,
    signalTicker,
    executionTicker,
    calculationTicker,
    reason: textValue(event.reason, "Event reason", 1000),
  };
}

function warningValue(value: unknown): ModelPerformanceWarning {
  const warning = objectValue(value, "Model performance warning");
  const affectedTickers = Array.isArray(warning.affectedTickers)
    ? warning.affectedTickers
        .filter((ticker): ticker is string => typeof ticker === "string")
        .map((ticker) => ticker.slice(0, 80))
    : [];
  const result: ModelPerformanceWarning = {
    severity: "warning",
    code: textValue(warning.code, "Warning code", 120),
    message: textValue(warning.message, "Warning message", 1000),
    affectedTickers,
  };
  if (typeof warning.metric === "string") {
    result.metric = warning.metric.slice(0, 120);
  }
  if (typeof warning.value === "number" || typeof warning.value === "string") {
    result.value = warning.value;
  }
  if (
    typeof warning.threshold === "number" ||
    typeof warning.threshold === "string"
  ) {
    result.threshold = warning.threshold;
  }
  if (typeof warning.strategyId === "string") {
    result.strategyId = warning.strategyId.slice(0, 100);
  }
  return result;
}

function positionValue(value: unknown): MultiStrategyPosition {
  const position = objectValue(value, "Virtual position");
  if (position.label !== "Virtual model position") {
    throw new Error("Scanner positions must be labelled Virtual model position.");
  }
  return {
    ...position,
    positionId: textValue(position.positionId, "Position ID", 200),
    label: "Virtual model position",
    signalTicker: textValue(position.signalTicker, "Signal ticker", 80),
    executionTicker: textValue(
      position.executionTicker,
      "Execution ticker",
      80,
    ),
    state: textValue(position.state, "Position state", 80),
    entryTimestamp:
      position.entryTimestamp === null
        ? null
        : textValue(position.entryTimestamp, "Entry timestamp", 80),
    entryPrice: optionalNumber(position.entryPrice),
    latestPrice: optionalNumber(position.latestPrice),
    quantity: numberValue(position.quantity ?? 0),
    allocation: numberValue(position.allocation ?? 0),
    openPnlValue: numberValue(position.openPnlValue ?? 0),
    openPnlPercent: numberValue(position.openPnlPercent ?? 0),
    daysHeld: numberValue(position.daysHeld ?? 0),
    latestSignal: textValue(position.latestSignal, "Latest signal", 100),
    reason: textValue(position.reason, "Position reason", 1000),
    warnings: Array.isArray(position.warnings)
      ? position.warnings.map(warningValue)
      : [],
  };
}

function strategyValue(value: unknown): MultiStrategyRecord {
  const strategy = objectValue(value, "Strategy");
  const strategyId = strategy.strategyId;
  if (
    strategyId !== "daily-supertrend" &&
    strategyId !== "nasdaq-sma200-3x"
  ) {
    throw new Error("Unsupported strategy ID.");
  }
  const events = Array.isArray(strategy.events)
    ? strategy.events.map((event) => eventValue(event, strategyId))
    : [];
  const equitySnapshots = Array.isArray(strategy.equitySnapshots)
    ? strategy.equitySnapshots.map((value) => {
        const item = objectValue(value, "Equity snapshot");
        return {
          date: textValue(item.date, "Equity date", 80),
          value: numberValue(item.value),
        };
      })
    : [];
  const warnings = Array.isArray(strategy.warnings)
    ? strategy.warnings.map(warningValue)
    : [];
  const diagnostics = Array.isArray(strategy.diagnostics)
    ? strategy.diagnostics.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  return {
    strategyId,
    name: textValue(strategy.name, "Strategy name", 200),
    enabled: strategy.enabled === true,
    configured: strategy.configured === true,
    status: textValue(strategy.status, "Strategy status", 100),
    ruleSummary: textValue(strategy.ruleSummary, "Rule summary", 2000),
    parameters: objectValue(strategy.parameters ?? {}, "Strategy parameters"),
    currentState: textValue(strategy.currentState, "Current state", 100),
    modelValue: optionalNumber(strategy.modelValue),
    returnPercent: optionalNumber(strategy.returnPercent),
    drawdownPercent: optionalNumber(strategy.drawdownPercent),
    exposurePercent: numberValue(strategy.exposurePercent ?? 0),
    cash:
      strategy.cash === undefined
        ? undefined
        : numberValue(strategy.cash),
    investedValue:
      strategy.investedValue === undefined
        ? undefined
        : numberValue(strategy.investedValue),
    regimeStartDate:
      strategy.regimeStartDate === undefined
        ? undefined
        : strategy.regimeStartDate === null
          ? null
          : textValue(strategy.regimeStartDate, "Regime start date", 80),
    referenceTicker:
      typeof strategy.referenceTicker === "string"
        ? strategy.referenceTicker.slice(0, 80)
        : undefined,
    executionTicker:
      typeof strategy.executionTicker === "string"
        ? strategy.executionTicker.slice(0, 80)
        : undefined,
    equitySnapshots,
    virtualPositions: Array.isArray(strategy.virtualPositions)
      ? strategy.virtualPositions.map(positionValue)
      : [],
    closedVirtualTrades: Array.isArray(strategy.closedVirtualTrades)
      ? strategy.closedVirtualTrades.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [],
    events,
    regimeChangeEvents: Array.isArray(strategy.regimeChangeEvents)
      ? strategy.regimeChangeEvents.map((event) =>
          eventValue(event, strategyId),
        )
      : undefined,
    latestEvent:
      strategy.latestEvent === null || strategy.latestEvent === undefined
        ? null
        : eventValue(strategy.latestEvent, strategyId),
    dataFreshness:
      strategy.dataFreshness === null ||
      strategy.dataFreshness === undefined
        ? null
        : textValue(strategy.dataFreshness, "Data freshness", 100),
    warnings,
    diagnostics,
  };
}

export function validateMultiStrategySnapshot(
  value: unknown,
): MultiStrategySnapshot {
  const root = objectValue(value, "Scanner snapshot");
  if (root.schemaVersion !== "multi_strategy_v1") {
    throw new Error("Unsupported scanner snapshot schema.");
  }
  const generatedAt = textValue(root.generatedAt, "Generated timestamp");
  if (Number.isNaN(new Date(generatedAt).getTime())) {
    throw new Error("Generated timestamp is invalid.");
  }
  const scanner = objectValue(root.scanner, "Scanner status");
  const strategies = Array.isArray(root.strategies)
    ? root.strategies.map(strategyValue)
    : [];
  const ids = strategies.map((strategy) => strategy.strategyId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Scanner snapshot contains duplicate strategy IDs.");
  }
  return {
    schemaVersion: "multi_strategy_v1",
    generatedAt,
    scanner: {
      name: textValue(scanner.name, "Scanner name", 200),
      version: textValue(scanner.version, "Scanner version", 80),
      status: textValue(scanner.status, "Scanner status", 80),
      errors: Array.isArray(scanner.errors)
        ? scanner.errors.map((value) => {
            const error = objectValue(value, "Scanner error");
            return {
              strategyId:
                typeof error.strategyId === "string"
                  ? error.strategyId.slice(0, 100)
                  : undefined,
              message: textValue(error.message, "Scanner error message", 500),
            };
          })
        : [],
      warnings: Array.isArray(scanner.warnings)
        ? scanner.warnings.map(warningValue)
        : [],
      dataFreshness:
        scanner.dataFreshness === null ||
        scanner.dataFreshness === undefined
          ? null
          : (() => {
              const freshness = objectValue(
                scanner.dataFreshness,
                "Data freshness",
              );
              return {
                generatedAt: textValue(
                  freshness.generatedAt,
                  "Freshness timestamp",
                  100,
                ),
                staleAfterMinutes: numberValue(
                  freshness.staleAfterMinutes,
                ),
              };
            })(),
    },
    strategies,
  };
}

export function selectStrategyEventImportCandidates(
  snapshot: MultiStrategySnapshot,
  limit = defaultStrategyEventImportLimit,
) {
  return snapshot.strategies
    .flatMap((strategy) =>
      [...strategy.events]
        .sort((left, right) => {
          const byPriority =
            eventImportPriority(left) - eventImportPriority(right);
          return byPriority || right.occurredAt.localeCompare(left.occurredAt);
        })
        .slice(0, clampLimit(limit, defaultStrategyEventImportLimit)),
    )
    .sort((left, right) => {
      const byPriority = eventImportPriority(left) - eventImportPriority(right);
      return byPriority || right.occurredAt.localeCompare(left.occurredAt);
    });
}

export function trimMultiStrategyPublicState(
  state: MultiStrategyPublicState,
  options: {
    eventsPerStrategy?: number;
    scannerWarnings?: number;
    scannerErrors?: number;
    strategyWarnings?: number;
    positionWarnings?: number;
    closedVirtualTrades?: number;
    equitySnapshots?: number;
    diagnostics?: number;
  } = {},
): MultiStrategyPublicState {
  if (!state.snapshot) return state;
  const eventsPerStrategy = clampLimit(
    options.eventsPerStrategy,
    defaultPublicStrategyEventLimit,
  );
  const scannerWarnings = clampLimit(
    options.scannerWarnings,
    defaultPublicScannerWarningLimit,
  );
  const scannerErrors = clampLimit(
    options.scannerErrors,
    defaultPublicScannerErrorLimit,
  );
  const strategyWarnings = clampLimit(
    options.strategyWarnings,
    defaultPublicStrategyWarningLimit,
  );
  const positionWarnings = clampLimit(
    options.positionWarnings,
    defaultPublicPositionWarningLimit,
  );
  const closedVirtualTrades = clampLimit(
    options.closedVirtualTrades,
    defaultPublicClosedTradeLimit,
  );
  const equitySnapshots = clampLimit(
    options.equitySnapshots,
    defaultPublicEquitySnapshotLimit,
  );
  const diagnostics = clampLimit(
    options.diagnostics,
    defaultPublicStrategyDiagnosticLimit,
  );
  return {
    ...state,
    snapshot: {
      ...state.snapshot,
      scanner: {
        ...state.snapshot.scanner,
        errors: state.snapshot.scanner.errors.slice(0, scannerErrors),
        warnings: state.snapshot.scanner.warnings?.slice(0, scannerWarnings),
      },
      strategies: state.snapshot.strategies.map((strategy) => ({
        ...strategy,
        equitySnapshots: latestEquitySnapshots(
          strategy.equitySnapshots,
          equitySnapshots,
        ),
        virtualPositions: strategy.virtualPositions.map((position) => ({
          ...position,
          warnings: position.warnings?.slice(0, positionWarnings),
        })),
        closedVirtualTrades: latestClosedVirtualTrades(
          strategy.closedVirtualTrades,
          closedVirtualTrades,
          strategyWarnings,
        ),
        events: latestStrategyEvents(strategy.events, eventsPerStrategy),
        regimeChangeEvents: strategy.regimeChangeEvents
          ? latestStrategyEvents(strategy.regimeChangeEvents, eventsPerStrategy)
          : undefined,
        warnings: strategy.warnings?.slice(0, strategyWarnings),
        diagnostics: strategy.diagnostics?.slice(-diagnostics),
      })),
    },
  };
}

function latestStrategyEvents(events: MultiStrategyEvent[], limit: number) {
  if (events.length <= limit) return events;
  return [...events]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, limit);
}

function latestEquitySnapshots(
  snapshots: Array<{ date: string; value: number }>,
  limit: number,
) {
  return snapshots.length <= limit ? snapshots : snapshots.slice(-limit);
}

function latestClosedVirtualTrades(
  trades: Array<Record<string, unknown>>,
  limit: number,
  warningLimit: number,
) {
  const visible =
    trades.length <= limit
      ? trades
      : [...trades]
          .sort((left, right) =>
            recordTimestamp(right).localeCompare(recordTimestamp(left)),
          )
          .slice(0, limit);
  return visible.map((trade) => {
    if (!Array.isArray(trade.warnings)) return trade;
    return {
      ...trade,
      warnings: trade.warnings.slice(0, warningLimit),
    };
  });
}

function recordTimestamp(record: Record<string, unknown>) {
  for (const key of [
    "exitTimestamp",
    "closedAt",
    "exitDate",
    "updatedAt",
    "entryTimestamp",
    "createdAt",
  ]) {
    if (typeof record[key] === "string") return record[key];
  }
  return "";
}

function clampLimit(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function eventImportPriority(event: MultiStrategyEvent) {
  return ["entry", "exit", "scannerError", "lowLiquidity"].includes(
    event.eventType,
  )
    ? 0
    : 1;
}

async function readOptionalJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export class MultiStrategyService {
  private lastRefreshAt = 0;
  private lastResult: MultiStrategyPublicState | null = null;
  private readonly sourceFile: string;
  private readonly cacheFile = "scanner_multi_strategy_last_good.json";

  constructor(
    private readonly privateStore: JsonStore,
    options: {
      outputDirectory?: string;
      onEvents?: (events: MultiStrategyEvent[]) => Promise<void>;
    } = {},
  ) {
    this.sourceFile = path.join(
      path.resolve(
        options.outputDirectory ??
          process.env.SCANNER_OUTPUT_DIR ??
          path.join(process.cwd(), "data", "scanner-output"),
      ),
      "multi_strategy_v1.json",
    );
    this.onEvents = options.onEvents;
  }

  private readonly onEvents?: (
    events: MultiStrategyEvent[],
  ) => Promise<void>;

  async refresh(force = false): Promise<MultiStrategyPublicState> {
    if (!force && Date.now() - this.lastRefreshAt < 20_000) {
      if (this.lastResult) return this.lastResult;
    }
    this.lastRefreshAt = Date.now();
    try {
      const raw = await readOptionalJson(this.sourceFile);
      if (raw === null) {
        const cached =
          await this.privateStore.readOptional<MultiStrategySnapshot>(
            this.cacheFile,
          );
        return (this.lastResult = {
          source: cached ? "last_known_good" : "awaiting",
          currentFileValid: false,
          lastError: null,
          snapshot: cached,
        });
      }
      const snapshot = validateMultiStrategySnapshot(raw);
      await this.privateStore.write(this.cacheFile, snapshot);
      let eventImportError: string | null = null;
      try {
        await this.onEvents?.(
          selectStrategyEventImportCandidates(snapshot),
        );
      } catch {
        eventImportError =
          "Scanner snapshot is valid, but event history could not be refreshed.";
      }
      return (this.lastResult = {
        source: "current",
        currentFileValid: true,
        lastError: eventImportError,
        snapshot,
      });
    } catch (error) {
      const cached =
        await this.privateStore.readOptional<MultiStrategySnapshot>(
          this.cacheFile,
        );
      return (this.lastResult = {
        source: cached ? "last_known_good" : "awaiting",
        currentFileValid: false,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Scanner snapshot is invalid.",
        snapshot: cached,
      });
    }
  }
}
