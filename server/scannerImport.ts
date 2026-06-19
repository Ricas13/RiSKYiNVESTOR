import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AlertDeliveryRepository,
  DailyPortfolioSnapshotRepository,
  SignalEventRepository,
  type SignalEvent,
} from "./signalEvents.js";
import { JsonStore } from "./store.js";

export type ScannerImportStatus = "awaiting" | "current" | "stale" | "error";

export interface ScannerWatchlistItem {
  id: string;
  assetName: string;
  category: string;
  entryTicker: string;
  tradeTicker: string;
  riskTier: "CORE" | "AGGRESSIVE" | "SPECULATIVE" | "EXCLUDED";
  currentTrend: "Green" | "Red" | "Unknown";
  latestClose: number;
  currency: string;
  superTrendValue: number;
  lastSignalDate: string;
  liquidityStatus: "Good" | "Moderate" | "Low";
  allocationRule: string;
  notes: string;
}

export interface ScannerImportPublicState {
  status: ScannerImportStatus;
  lastGeneratedAt: string | null;
  lastSuccessfulScanAt: string | null;
  lastImportedAt: string | null;
  staleAfterMinutes: number;
  scannerName: string | null;
  scannerRunId: string | null;
  summary: string | null;
  warningCount: number;
  errorCount: number;
  lastError: string | null;
  importedEvents: number;
  duplicateEvents: number;
  rejectedEvents: number;
}

interface ScannerImportStateFile extends ScannerImportPublicState {
  version: 1;
  isExample: boolean;
  watchlist: ScannerWatchlistItem[];
}

interface LatestScanPayload {
  schemaVersion: number | string;
  scannerRunId: string;
  generatedAt: string;
  scannerName: string;
  scannerVersion?: string;
  scanMode?: string;
  success: boolean;
  summary?: unknown;
  signalEvents?: unknown[];
  watchlist?: unknown[];
  warnings?: unknown[];
  errors?: unknown[];
  dailyPortfolioSnapshot?: unknown;
  dailyPortfolioSnapshots?: unknown[];
  portfolioSnapshot?: unknown;
}

function safeText(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safeDate(value: unknown) {
  const text = safeText(value, 100);
  const parsed = new Date(text);
  return text && !Number.isNaN(parsed.getTime())
    ? parsed.toISOString()
    : null;
}

function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function riskTier(value: unknown): ScannerWatchlistItem["riskTier"] {
  const candidate = safeText(value).toUpperCase();
  return ["CORE", "AGGRESSIVE", "SPECULATIVE", "EXCLUDED"].includes(candidate)
    ? (candidate as ScannerWatchlistItem["riskTier"])
    : "EXCLUDED";
}

function scannerWatchlistItem(value: unknown): ScannerWatchlistItem | null {
  const input = objectValue(value);
  const entryTicker = safeText(
    input.underlyingTicker ?? input.entryTicker,
    100,
  ).toUpperCase();
  const tradeTicker = safeText(input.tradeTicker, 100).toUpperCase();
  if (!entryTicker || !tradeTicker) return null;
  const trendCandidate = safeText(input.currentTrend).toLowerCase();
  const currentTrend: ScannerWatchlistItem["currentTrend"] =
    trendCandidate === "green"
      ? "Green"
      : trendCandidate === "red"
        ? "Red"
        : "Unknown";
  const liquidityCandidate = safeText(
    input.liquidityStatus ?? input.liquidity,
  );
  const liquidityStatus: ScannerWatchlistItem["liquidityStatus"] = [
    "Good",
    "Moderate",
    "Low",
  ].includes(liquidityCandidate)
    ? (liquidityCandidate as ScannerWatchlistItem["liquidityStatus"])
    : "Moderate";
  const allocationPercent = safeNumber(input.allocationPercent);
  const allocationRule =
    safeText(input.allocationRule) ||
    (allocationPercent > 0
      ? `${allocationPercent}% scanner allocation`
      : "0% watchlist only");
  return {
    id:
      safeText(input.id ?? input.rawSourceReference, 200) ||
      `${entryTicker}-${tradeTicker}`,
    assetName:
      safeText(input.underlyingName ?? input.assetName, 300) || entryTicker,
    category: safeText(input.category, 100) || "Scanner watchlist",
    entryTicker,
    tradeTicker,
    riskTier: riskTier(input.riskTier),
    currentTrend,
    latestClose: safeNumber(input.latestClose ?? input.referencePrice),
    currency: safeText(input.currency, 20) || "GBP",
    superTrendValue: safeNumber(input.superTrendValue),
    lastSignalDate:
      safeDate(input.lastSignalAt ?? input.lastSignalDate)?.slice(0, 10) ||
      "Unknown",
    liquidityStatus,
    allocationRule,
    notes:
      safeText(input.reasonText ?? input.notes, 500) ||
      `Eligibility: ${safeText(input.eligibility) || "unknown"}.`,
  };
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
    throw new Error(`Invalid scanner JSON file: ${path.basename(filePath)}.`);
  }
}

async function readJsonLines(filePath: string) {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { values: [] as unknown[], rejected: 0 };
    }
    throw new Error("Unable to read signal-events.jsonl.");
  }
  const values: unknown[] = [];
  let rejected = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      rejected += 1;
    }
  }
  return { values, rejected };
}

function latestScan(value: unknown): LatestScanPayload {
  const input = objectValue(value);
  if (![1, "1", "1.0"].includes(input.schemaVersion as number | string)) {
    throw new Error("Unsupported scanner schemaVersion.");
  }
  const scannerRunId = safeText(input.scannerRunId, 200);
  const generatedAt = safeDate(input.generatedAt);
  const scannerName = safeText(input.scannerName, 200);
  if (!scannerRunId || !generatedAt || !scannerName) {
    throw new Error(
      "latest-scan.json is missing scannerRunId, generatedAt, or scannerName.",
    );
  }
  if (typeof input.success !== "boolean") {
    throw new Error("latest-scan.json success must be true or false.");
  }
  return {
    ...(input as unknown as LatestScanPayload),
    scannerRunId,
    generatedAt,
    scannerName,
    success: input.success,
  };
}

function publicState(state: ScannerImportStateFile): ScannerImportPublicState {
  return {
    status: state.status,
    lastGeneratedAt: state.lastGeneratedAt,
    lastSuccessfulScanAt: state.lastSuccessfulScanAt,
    lastImportedAt: state.lastImportedAt,
    staleAfterMinutes: state.staleAfterMinutes,
    scannerName: state.scannerName,
    scannerRunId: state.scannerRunId,
    summary: state.summary,
    warningCount: state.warningCount,
    errorCount: state.errorCount,
    lastError: state.lastError,
    importedEvents: state.importedEvents,
    duplicateEvents: state.duplicateEvents,
    rejectedEvents: state.rejectedEvents,
  };
}

export class ScannerImportService {
  private lastRefreshAt = 0;
  private readonly sourceDirectory: string;
  private readonly staleAfterMinutes: number;
  private readonly onAcceptedEvent?: (event: SignalEvent) => Promise<void>;

  constructor(
    private readonly store: JsonStore,
    private readonly signalEvents: SignalEventRepository,
    private readonly deliveries: AlertDeliveryRepository,
    private readonly snapshots: DailyPortfolioSnapshotRepository,
    options: {
      sourceDirectory?: string;
      staleAfterMinutes?: number;
      onAcceptedEvent?: (event: SignalEvent) => Promise<void>;
    } = {},
  ) {
    this.sourceDirectory = path.resolve(
      options.sourceDirectory ??
        process.env.SCANNER_EXPORT_DIR ??
        "/opt/risky-investor-data/scanner",
    );
    this.staleAfterMinutes = Math.max(
      1,
      options.staleAfterMinutes ??
        Number(process.env.SCANNER_STALE_MINUTES ?? 180),
    );
    this.onAcceptedEvent = options.onAcceptedEvent;
  }

  async readState() {
    const state =
      await this.store.read<ScannerImportStateFile>("scanner_import_state.json");
    return {
      ...state,
      staleAfterMinutes: this.staleAfterMinutes,
    };
  }

  async refreshIfDue(force = false) {
    if (!force && Date.now() - this.lastRefreshAt < 20_000) {
      return this.readState();
    }
    this.lastRefreshAt = Date.now();
    const previous = await this.readState();
    const importedAt = new Date().toISOString();

    try {
      const latestRaw = await readOptionalJson(
        path.join(this.sourceDirectory, "latest-scan.json"),
      );
      if (!latestRaw) {
        if (
          previous.status === "awaiting" &&
          !previous.lastSuccessfulScanAt &&
          !previous.lastError
        ) {
          return previous;
        }
        const state: ScannerImportStateFile = {
          ...previous,
          version: 1,
          isExample: false,
          status: previous.lastSuccessfulScanAt ? "stale" : "awaiting",
          staleAfterMinutes: this.staleAfterMinutes,
          lastImportedAt: importedAt,
          lastError: null,
        };
        await this.store.write("scanner_import_state.json", state);
        return state;
      }

      const latest = latestScan(latestRaw);
      const jsonLines = await readJsonLines(
        path.join(this.sourceDirectory, "signal-events.jsonl"),
      );
      const combinedEventInputs = [
        ...(Array.isArray(latest.signalEvents) ? latest.signalEvents : []),
        ...jsonLines.values,
      ];
      const sourceEventIds = new Set<string>();
      const eventInputs = combinedEventInputs.filter((input) => {
        const eventId = safeText(objectValue(input).eventId, 200);
        if (!eventId) return true;
        if (sourceEventIds.has(eventId)) return false;
        sourceEventIds.add(eventId);
        return true;
      });
      let importedEvents = 0;
      let duplicateEvents = 0;
      let rejectedEvents = jsonLines.rejected;

      for (const input of eventInputs) {
        try {
          const result = await this.signalEvents.saveCanonical([input]);
          importedEvents += result.accepted.length;
          duplicateEvents += result.duplicates.length;
          for (const event of result.accepted) {
            await this.deliveries.recordDashboardSent(
              event.eventId,
              event.reasonText,
            );
            await this.onAcceptedEvent?.(event).catch(() => undefined);
          }
        } catch {
          rejectedEvents += 1;
        }
      }

      const snapshotInputs = [
        ...(Array.isArray(latest.dailyPortfolioSnapshots)
          ? latest.dailyPortfolioSnapshots
          : []),
        ...(latest.dailyPortfolioSnapshot
          ? [latest.dailyPortfolioSnapshot]
          : []),
        ...(latest.portfolioSnapshot ? [latest.portfolioSnapshot] : []),
      ];
      for (const snapshot of snapshotInputs) {
        try {
          await this.snapshots.save([snapshot]);
        } catch {
          rejectedEvents += 1;
        }
      }

      const watchlistRaw =
        (await readOptionalJson(
          path.join(this.sourceDirectory, "watchlist-state.json"),
        )) ?? latest.watchlist ?? [];
      const watchlistObject = objectValue(watchlistRaw);
      const watchlistValues = Array.isArray(watchlistRaw)
        ? watchlistRaw
        : Array.isArray(watchlistObject.watchlist)
          ? watchlistObject.watchlist
          : Array.isArray(watchlistObject.items)
            ? watchlistObject.items
            : [];
      const watchlist = watchlistValues
        .map(scannerWatchlistItem)
        .filter((item): item is ScannerWatchlistItem => Boolean(item));

      const healthRaw = await readOptionalJson(
        path.join(this.sourceDirectory, "scanner-health.json"),
      );
      const health = objectValue(healthRaw);
      const generatedTime = new Date(latest.generatedAt).getTime();
      const stale =
        Date.now() - generatedTime > this.staleAfterMinutes * 60_000;
      const warnings = [
        ...(Array.isArray(latest.warnings) ? latest.warnings : []),
        ...(Array.isArray(health.warnings) ? health.warnings : []),
      ];
      const errors = [
        ...(Array.isArray(latest.errors) ? latest.errors : []),
        ...(Array.isArray(health.errors) ? health.errors : []),
      ];
      const state: ScannerImportStateFile = {
        version: 1,
        isExample: false,
        status: latest.success ? (stale ? "stale" : "current") : "error",
        lastGeneratedAt: latest.generatedAt,
        lastSuccessfulScanAt: latest.success
          ? latest.generatedAt
          : previous.lastSuccessfulScanAt,
        lastImportedAt: importedAt,
        staleAfterMinutes: this.staleAfterMinutes,
        scannerName: latest.scannerName,
        scannerRunId: latest.scannerRunId,
        summary:
          safeText(latest.summary, 500) ||
          safeText(health.summary, 500) ||
          (latest.success ? "Scanner export imported." : "Scanner run failed."),
        warningCount: warnings.length,
        errorCount: errors.length,
        lastError: latest.success
          ? null
          : safeText(errors[0], 500) || "Scanner reported an unsuccessful run.",
        importedEvents,
        duplicateEvents,
        rejectedEvents,
        watchlist: watchlist.length ? watchlist : previous.watchlist,
      };
      await this.store.write("scanner_import_state.json", state);
      return state;
    } catch (error) {
      const state: ScannerImportStateFile = {
        ...previous,
        version: 1,
        isExample: false,
        status: "error",
        staleAfterMinutes: this.staleAfterMinutes,
        lastImportedAt: importedAt,
        lastError:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Scanner import failed.",
      };
      await this.store.write("scanner_import_state.json", state);
      return state;
    }
  }

  toPublicState(state: ScannerImportStateFile) {
    return publicState(state);
  }
}
