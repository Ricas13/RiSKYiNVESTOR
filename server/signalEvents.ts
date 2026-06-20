import { createHash, randomUUID } from "node:crypto";
import type { DiscordWebhookPayload } from "./discordEmbeds.js";
import { JsonStore } from "./store.js";

export type SignalState =
  | "actionable_entry"
  | "actionable_exit"
  | "watchlist_only"
  | "wait_review"
  | "no_change"
  | "low_liquidity_warning"
  | "scanner_error"
  | "informational";

export type TrendState = "green" | "red" | "unknown";
export type EventEligibility =
  | "eligible"
  | "ineligible"
  | "watchlist_only"
  | "excluded"
  | "blocked_by_risk_rule"
  | "unknown";
export type EventRiskTier =
  | "CORE"
  | "AGGRESSIVE"
  | "SPECULATIVE"
  | "EXCLUDED";
export type AllocationStatus =
  | "normal"
  | "reduced"
  | "zero"
  | "blocked"
  | "not_applicable"
  | "unknown";

export interface SignalEvent {
  eventId: string;
  eventVersion: 1;
  occurredAt: string;
  receivedAt: string;
  strategyId: string;
  strategyName: string;
  source: string;
  underlyingTicker: string;
  underlyingName: string;
  tradeTicker: string;
  tradeName: string;
  signalState: SignalState;
  previousTrend: TrendState;
  currentTrend: TrendState;
  riskTier: EventRiskTier;
  eligibility: EventEligibility;
  allocationStatus: AllocationStatus;
  allocationPercent: number;
  reasonCode: string;
  reasonText: string;
  scannerRunId: string;
  rawSourceReference: string;
  isActionable: boolean;
  isAcknowledged: boolean;
  discordDeliveryEligible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SignalEventFile {
  version: 2;
  isExample: boolean;
  notice?: string;
  events: SignalEvent[];
}

export type AlertChannel =
  | "dashboard"
  | "discord"
  | "whatsapp"
  | "daily_summary"
  | "weekly_summary";
export type AlertDeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped"
  | "disabled";

export interface AlertDelivery {
  deliveryId: string;
  eventId: string | null;
  notificationKey: string;
  destinationId?: string | null;
  destinationLabel?: string | null;
  channel: AlertChannel;
  status: AlertDeliveryStatus;
  attemptedAt: string;
  deliveredAt: string | null;
  errorMessage: string | null;
  providerReference: string | null;
  retryCount: number;
  category?: "signal" | "daily_summary" | "weekly_summary" | "test";
  message?: string;
  discordPayload?: DiscordWebhookPayload;
}

interface AlertDeliveryFile {
  version: 2;
  isExample: boolean;
  deliveries: AlertDelivery[];
}

export interface DailyPortfolioSnapshot {
  snapshotId: string;
  timestamp: string;
  date: string;
  actualPortfolioValue: number | null;
  modelPortfolioValue: number | null;
  actualDailyPnl: number | null;
  modelDailyPnl: number | null;
  realisedPnl: number | null;
  unrealisedPnl: number | null;
  contributions: number | null;
  withdrawals: number | null;
  currentDrawdownPercent: number | null;
  cashValue: number | null;
  investedValue: number | null;
  source: string;
  scannerRunId: string;
}

interface DailyPortfolioSnapshotFile {
  version: 1;
  isExample: boolean;
  snapshots: DailyPortfolioSnapshot[];
}

export interface SignalEventFilters {
  strategyId?: string;
  ticker?: string;
  signalState?: SignalState;
  actionable?: boolean;
  acknowledged?: boolean;
  from?: string;
  to?: string;
}

const signalStates = new Set<SignalState>([
  "actionable_entry",
  "actionable_exit",
  "watchlist_only",
  "wait_review",
  "no_change",
  "low_liquidity_warning",
  "scanner_error",
  "informational",
]);
const trends = new Set<TrendState>(["green", "red", "unknown"]);
const eligibilities = new Set<EventEligibility>([
  "eligible",
  "ineligible",
  "watchlist_only",
  "excluded",
  "blocked_by_risk_rule",
  "unknown",
]);
const riskTiers = new Set<EventRiskTier>([
  "CORE",
  "AGGRESSIVE",
  "SPECULATIVE",
  "EXCLUDED",
]);
const allocationStatuses = new Set<AllocationStatus>([
  "normal",
  "reduced",
  "zero",
  "blocked",
  "not_applicable",
  "unknown",
]);
const deliveryChannels = new Set<AlertChannel>([
  "dashboard",
  "discord",
  "whatsapp",
  "daily_summary",
  "weekly_summary",
]);
const deliveryStatuses = new Set<AlertDeliveryStatus>([
  "pending",
  "sent",
  "failed",
  "skipped",
  "disabled",
]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Signal event must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredText(
  input: Record<string, unknown>,
  field: string,
  maximum = 2_000,
) {
  const value = typeof input[field] === "string" ? input[field].trim() : "";
  if (!value) throw new Error(`${field} is required.`);
  if (value.length > maximum) throw new Error(`${field} is too long.`);
  return value;
}

function optionalText(value: unknown, maximum = 2_000) {
  const result = typeof value === "string" ? value.trim() : "";
  return result.slice(0, maximum);
}

function isoDate(value: unknown, field: string) {
  const text = typeof value === "string" ? value.trim() : "";
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid ISO date-time.`);
  }
  return parsed.toISOString();
}

function nullableIsoDate(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return isoDate(value, field);
}

function enumValue<T extends string>(
  input: Record<string, unknown>,
  field: string,
  allowed: Set<T>,
) {
  const value = requiredText(input, field) as T;
  if (!allowed.has(value)) {
    throw new Error(`${field} has an unsupported value.`);
  }
  return value;
}

function booleanValue(input: Record<string, unknown>, field: string) {
  if (typeof input[field] !== "boolean") {
    throw new Error(`${field} must be true or false.`);
  }
  return input[field] as boolean;
}

function optionalBoolean(
  input: Record<string, unknown>,
  field: string,
  fallback = false,
) {
  return typeof input[field] === "boolean"
    ? (input[field] as boolean)
    : fallback;
}

function numberValue(
  input: Record<string, unknown>,
  field: string,
  minimum = Number.NEGATIVE_INFINITY,
  maximum = Number.POSITIVE_INFINITY,
) {
  const value = Number(input[field]);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be a number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function nullableNumber(input: Record<string, unknown>, field: string) {
  if (input[field] === null || input[field] === undefined) return null;
  const value = Number(input[field]);
  if (!Number.isFinite(value)) throw new Error(`${field} must be a number or null.`);
  return value;
}

function stableId(prefix: string, values: unknown[]) {
  return `${prefix}-${createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 24)}`;
}

function validateStateConsistency(event: SignalEvent) {
  const actionableState =
    event.signalState === "actionable_entry" ||
    event.signalState === "actionable_exit";
  if (event.isActionable !== actionableState) {
    throw new Error(
      "isActionable must be true only for actionable_entry or actionable_exit.",
    );
  }
  if (event.signalState === "actionable_entry") {
    if (
      event.previousTrend !== "red" ||
      event.currentTrend !== "green" ||
      event.eligibility !== "eligible"
    ) {
      throw new Error(
        "actionable_entry requires an explicit red-to-green transition and eligible status.",
      );
    }
    if (event.allocationPercent <= 0) {
      throw new Error("actionable_entry requires a positive allocationPercent.");
    }
  }
  if (
    event.signalState === "actionable_exit" &&
    (event.previousTrend !== "green" || event.currentTrend !== "red")
  ) {
    throw new Error(
      "actionable_exit requires an explicit green-to-red transition.",
    );
  }
  if (
    event.signalState === "watchlist_only" &&
    event.allocationPercent !== 0
  ) {
    throw new Error("watchlist_only requires allocationPercent to be 0.");
  }
  if (
    event.signalState === "no_change" &&
    event.previousTrend !== "unknown" &&
    event.currentTrend !== "unknown" &&
    event.previousTrend !== event.currentTrend
  ) {
    throw new Error("no_change cannot describe a trend transition.");
  }
}

export function validateCanonicalSignalEvent(value: unknown): SignalEvent {
  const input = record(value);
  if (Number(input.eventVersion) !== 1) {
    throw new Error("eventVersion must be 1.");
  }
  const event: SignalEvent = {
    eventId: requiredText(input, "eventId", 200),
    eventVersion: 1,
    occurredAt: isoDate(input.occurredAt, "occurredAt"),
    receivedAt: isoDate(input.receivedAt, "receivedAt"),
    strategyId: requiredText(input, "strategyId", 200),
    strategyName: requiredText(input, "strategyName", 300),
    source: requiredText(input, "source", 200),
    underlyingTicker: requiredText(input, "underlyingTicker", 100).toUpperCase(),
    underlyingName: requiredText(input, "underlyingName", 300),
    tradeTicker: requiredText(input, "tradeTicker", 100).toUpperCase(),
    tradeName: requiredText(input, "tradeName", 300),
    signalState: enumValue(input, "signalState", signalStates),
    previousTrend: enumValue(input, "previousTrend", trends),
    currentTrend: enumValue(input, "currentTrend", trends),
    riskTier: enumValue(input, "riskTier", riskTiers),
    eligibility: enumValue(input, "eligibility", eligibilities),
    allocationStatus: enumValue(
      input,
      "allocationStatus",
      allocationStatuses,
    ),
    allocationPercent: numberValue(input, "allocationPercent", 0, 100),
    reasonCode: requiredText(input, "reasonCode", 200),
    reasonText: requiredText(input, "reasonText", 2_000),
    scannerRunId: requiredText(input, "scannerRunId", 200),
    rawSourceReference: requiredText(input, "rawSourceReference", 500),
    isActionable: booleanValue(input, "isActionable"),
    isAcknowledged: booleanValue(input, "isAcknowledged"),
    discordDeliveryEligible: optionalBoolean(
      input,
      "discordDeliveryEligible",
    ),
    createdAt: isoDate(input.createdAt, "createdAt"),
    updatedAt: isoDate(input.updatedAt, "updatedAt"),
  };
  validateStateConsistency(event);
  return event;
}

function legacySignalState(value: unknown): SignalState {
  const candidate = optionalText(value).toLowerCase().replaceAll(" ", "_");
  if (signalStates.has(candidate as SignalState)) {
    return candidate as SignalState;
  }
  return "wait_review";
}

function legacyTrend(value: unknown): TrendState {
  const candidate = optionalText(value).toLowerCase();
  return trends.has(candidate as TrendState)
    ? (candidate as TrendState)
    : "unknown";
}

function legacyEligibility(value: unknown): EventEligibility {
  const candidate = optionalText(value).toLowerCase().replaceAll("-", "_");
  if (eligibilities.has(candidate as EventEligibility)) {
    return candidate as EventEligibility;
  }
  if (candidate === "review") return "unknown";
  return "unknown";
}

function allocationFromLegacy(rule: string, tier: EventRiskTier) {
  const match = rule.match(/(\d+(?:\.\d+)?)\s*%/);
  const allocationPercent = match
    ? Math.min(100, Math.max(0, Number(match[1])))
    : tier === "CORE"
      ? 100
      : tier === "AGGRESSIVE"
        ? 50
        : 0;
  const allocationStatus: AllocationStatus =
    allocationPercent === 0
      ? "zero"
      : allocationPercent < 100
        ? "reduced"
        : "normal";
  return { allocationPercent, allocationStatus };
}

function migrateLegacySignalEvent(value: unknown): SignalEvent {
  const input = record(value);
  const occurredAt = (() => {
    try {
      return isoDate(
        input.occurredAt ?? input.timestamp ?? input.createdAt ?? input.signalDate,
        "timestamp",
      );
    } catch {
      return new Date(0).toISOString();
    }
  })();
  const signalState = legacySignalState(input.signalState ?? input.signalType);
  const riskCandidate = optionalText(input.riskTier).toUpperCase();
  const riskTier = riskTiers.has(riskCandidate as EventRiskTier)
    ? (riskCandidate as EventRiskTier)
    : "CORE";
  const allocationRule =
    optionalText(input.allocationRule ?? input.suggestedAllocation) ||
    (riskTier === "CORE"
      ? "100% normal allocation"
      : riskTier === "AGGRESSIVE"
        ? "50% reduced allocation"
        : "0% watchlist only");
  const { allocationPercent, allocationStatus } = allocationFromLegacy(
    allocationRule,
    riskTier,
  );
  const eventId =
    optionalText(input.eventId ?? input.id, 200) ||
    stableId("legacy", [
      input.strategyId,
      input.tradeTicker,
      signalState,
      occurredAt,
    ]);
  const strategyId =
    optionalText(input.strategyId, 200) || "legacy-supertrend";
  const underlyingTicker =
    optionalText(input.underlyingTicker ?? input.entryTicker, 100).toUpperCase() ||
    "UNKNOWN";
  const tradeTicker =
    optionalText(input.tradeTicker, 100).toUpperCase() || underlyingTicker;
  const reasonText =
    optionalText(input.reason ?? input.reasonText, 2_000) ||
    "Migrated legacy event. Review the source record before acting.";
  const isActionable =
    signalState === "actionable_entry" || signalState === "actionable_exit";
  const eligibility = legacyEligibility(input.eligibility);
  const safeEligibility =
    isActionable && eligibility === "unknown" ? "eligible" : eligibility;
  const event: SignalEvent = {
    eventId,
    eventVersion: 1,
    occurredAt,
    receivedAt: occurredAt,
    strategyId,
    strategyName:
      optionalText(input.strategyName, 300) || strategyId,
    source: "legacy_migration",
    underlyingTicker,
    underlyingName:
      optionalText(input.underlyingName ?? input.assetName, 300) ||
      underlyingTicker,
    tradeTicker,
    tradeName: optionalText(input.tradeName, 300) || tradeTicker,
    signalState,
    previousTrend: legacyTrend(
      input.previousTrend ?? input.previousTrendState,
    ),
    currentTrend: legacyTrend(input.currentTrend ?? input.newTrendState),
    riskTier,
    eligibility: safeEligibility,
    allocationStatus,
    allocationPercent,
    reasonCode: optionalText(input.reasonCode, 200) || "legacy_migration",
    reasonText,
    scannerRunId:
      optionalText(input.scannerRunId, 200) || "legacy-migration",
    rawSourceReference:
      optionalText(input.rawSourceReference, 500) || `legacy:${eventId}`,
    isActionable,
    isAcknowledged: Boolean(input.isAcknowledged),
    discordDeliveryEligible:
      isActionable ||
      signalState === "low_liquidity_warning" ||
      signalState === "scanner_error",
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };

  try {
    validateStateConsistency(event);
    return event;
  } catch {
    return {
      ...event,
      signalState: "wait_review",
      isActionable: false,
      allocationStatus:
        event.allocationPercent > 0 ? event.allocationStatus : "zero",
      reasonCode: "legacy_requires_review",
      reasonText: `${reasonText} The legacy record was not promoted because its explicit state and transition were inconsistent.`,
    };
  }
}

function eventDeduplicationKey(event: SignalEvent) {
  return [
    event.strategyId,
    event.tradeTicker,
    event.signalState,
    event.occurredAt,
    event.scannerRunId || event.rawSourceReference,
  ].join("|");
}

export class SignalEventRepository {
  private legacyFallback: Array<Record<string, unknown>> = [];

  constructor(
    private readonly store: JsonStore,
    private readonly filePath = "signal_events.json",
  ) {}

  async initialiseFromLegacy(legacy: Array<Record<string, unknown>>) {
    this.legacyFallback = legacy;
    return this.read();
  }

  async read(): Promise<SignalEventFile> {
    const raw = await this.store.read<
      SignalEventFile | SignalEvent[] | Record<string, unknown>
    >(this.filePath);
    const file: SignalEventFile = (() => {
      if (Array.isArray(raw)) {
        return {
          version: 2,
          isExample: false,
          notice: raw.length ? undefined : "Awaiting scanner data.",
          events: raw,
        };
      }
      if (raw.version === 2) return raw as unknown as SignalEventFile;
      const rawEvents = Array.isArray(raw.events) ? raw.events : [];
      const sourceEvents = rawEvents.length
        ? rawEvents
        : this.legacyFallback;
      return {
        version: 2,
        isExample: Boolean(raw.isExample),
        notice:
          optionalText(raw.notice) ||
          (sourceEvents.length
            ? "Legacy records were retained without deriving new signals from trend colours."
            : "Awaiting scanner data."),
        events: sourceEvents.map(migrateLegacySignalEvent),
      };
    })();
    return {
      ...file,
      events: [...file.events].sort((a, b) =>
        b.occurredAt.localeCompare(a.occurredAt),
      ),
    };
  }

  private async writeEvents(file: SignalEventFile) {
    const raw = await this.store.read<SignalEventFile | SignalEvent[]>(
      this.filePath,
    );
    await this.store.write(
      this.filePath,
      Array.isArray(raw) ? file.events : file,
    );
  }

  async saveCanonical(values: unknown[]) {
    const current = await this.read();
    const byId = new Map(
      current.events.map((event) => [event.eventId, event] as const),
    );
    const byDeduplicationKey = new Map(
      current.events.map((event) => [eventDeduplicationKey(event), event] as const),
    );
    const accepted: SignalEvent[] = [];
    const duplicates: SignalEvent[] = [];

    for (const value of values) {
      const event = validateCanonicalSignalEvent(value);
      const existing =
        byId.get(event.eventId) ??
        byDeduplicationKey.get(eventDeduplicationKey(event));
      if (existing) {
        duplicates.push(existing);
        continue;
      }
      accepted.push(event);
      byId.set(event.eventId, event);
      byDeduplicationKey.set(eventDeduplicationKey(event), event);
    }

    if (accepted.length) {
      await this.writeEvents({
        version: 2,
        isExample: false,
        events: [...byId.values()].sort((a, b) =>
          b.occurredAt.localeCompare(a.occurredAt),
        ),
      });
    }
    return { accepted, duplicates };
  }

  async list(filters: SignalEventFilters = {}) {
    const file = await this.read();
    const ticker = filters.ticker?.trim().toUpperCase();
    return file.events.filter((event) => {
      if (filters.strategyId && event.strategyId !== filters.strategyId) {
        return false;
      }
      if (
        ticker &&
        event.tradeTicker !== ticker &&
        event.underlyingTicker !== ticker
      ) {
        return false;
      }
      if (filters.signalState && event.signalState !== filters.signalState) {
        return false;
      }
      if (
        filters.actionable !== undefined &&
        event.isActionable !== filters.actionable
      ) {
        return false;
      }
      if (
        filters.acknowledged !== undefined &&
        event.isAcknowledged !== filters.acknowledged
      ) {
        return false;
      }
      if (filters.from && event.occurredAt < filters.from) return false;
      if (filters.to && event.occurredAt > filters.to) return false;
      return true;
    });
  }

  async acknowledge(eventId: string, acknowledged = true) {
    const file = await this.read();
    const event = file.events.find((item) => item.eventId === eventId);
    if (!event) return null;
    event.isAcknowledged = acknowledged;
    event.updatedAt = new Date().toISOString();
    file.isExample = false;
    await this.writeEvents(file);
    return event;
  }

  async dashboardItems() {
    const events = await this.list();
    return {
      latestActionable:
        events.find((event) => event.isActionable) ?? null,
      actionable: events.filter((event) => event.isActionable).slice(0, 5),
      recent: events.slice(0, 5),
    };
  }
}

export class AlertDeliveryRepository {
  constructor(
    private readonly store: JsonStore,
    private readonly filePath = "alert_deliveries.json",
  ) {}

  async initialise() {
    return this.read();
  }

  private normalise(
    raw: AlertDeliveryFile | AlertDelivery[] | Record<string, unknown>,
  ): AlertDeliveryFile {
    if (Array.isArray(raw)) {
      return { version: 2, isExample: false, deliveries: raw };
    }
    if (raw.version === 2) return raw as unknown as AlertDeliveryFile;
    const legacy = Array.isArray(raw.deliveries) ? raw.deliveries : [];
    const deliveries = legacy.map((value): AlertDelivery => {
      const input = record(value);
      const provider = optionalText(input.provider);
      const category = optionalText(input.category);
      const channel: AlertChannel =
        category === "daily-summary"
          ? "daily_summary"
          : provider === "whatsapp"
            ? "whatsapp"
            : "discord";
      const oldStatus = optionalText(input.status);
      const status: AlertDeliveryStatus =
        oldStatus === "delivered"
          ? "sent"
          : oldStatus === "suppressed"
            ? "skipped"
            : oldStatus === "not-requested"
              ? "disabled"
              : oldStatus === "failed"
                ? "failed"
                : "pending";
      const attemptedAt = (() => {
        try {
          return isoDate(input.attemptedAt, "attemptedAt");
        } catch {
          return new Date(0).toISOString();
        }
      })();
      return {
        deliveryId:
          optionalText(input.deliveryId ?? input.id, 200) || randomUUID(),
        eventId: optionalText(input.eventId, 200) || null,
        notificationKey:
          optionalText(input.notificationKey, 500) ||
          `${channel}:${category || "signal"}:${optionalText(input.eventId, 200) || "legacy"}`,
        destinationId: optionalText(input.destinationId, 200) || null,
        destinationLabel:
          optionalText(input.destinationLabel, 200) || null,
        channel,
        status,
        attemptedAt,
        deliveredAt: status === "sent" ? attemptedAt : null,
        errorMessage: optionalText(input.error, 1_000) || null,
        providerReference: null,
        retryCount: 0,
        category:
          category === "daily-summary"
            ? "daily_summary"
            : category === "test"
              ? "test"
              : "signal",
        message: optionalText(input.message, 2_000),
      };
    });
    return {
      version: 2,
      isExample: Boolean(raw.isExample),
      deliveries,
    };
  }

  async read() {
    const raw = await this.store.read<
      AlertDeliveryFile | AlertDelivery[] | Record<string, unknown>
    >(this.filePath);
    return [...this.normalise(raw).deliveries].sort((a, b) =>
      b.attemptedAt.localeCompare(a.attemptedAt),
    );
  }

  private async readFile(): Promise<AlertDeliveryFile> {
    const raw = await this.store.read<
      AlertDeliveryFile | AlertDelivery[] | Record<string, unknown>
    >(this.filePath);
    return this.normalise(raw);
  }

  private async writeFile(file: AlertDeliveryFile) {
    const raw = await this.store.read<AlertDeliveryFile | AlertDelivery[]>(
      this.filePath,
    );
    await this.store.write(
      this.filePath,
      Array.isArray(raw) ? file.deliveries : file,
    );
  }

  async record(
    input: Omit<AlertDelivery, "deliveryId"> & { deliveryId?: string },
  ) {
    if (!deliveryChannels.has(input.channel)) {
      throw new Error("Unsupported alert delivery channel.");
    }
    if (!deliveryStatuses.has(input.status)) {
      throw new Error("Unsupported alert delivery status.");
    }
    const file = await this.readFile();
    const delivery: AlertDelivery = {
      ...input,
      deliveryId: input.deliveryId || randomUUID(),
      attemptedAt: isoDate(input.attemptedAt, "attemptedAt"),
      deliveredAt: nullableIsoDate(input.deliveredAt, "deliveredAt"),
      retryCount: Math.max(0, Math.floor(input.retryCount)),
      notificationKey: input.notificationKey.slice(0, 500),
      destinationId: input.destinationId?.slice(0, 200) ?? null,
      destinationLabel: input.destinationLabel?.slice(0, 200) ?? null,
      errorMessage: input.errorMessage?.slice(0, 1_000) ?? null,
      providerReference: input.providerReference?.slice(0, 500) ?? null,
      message: input.message?.slice(0, 2_000),
      discordPayload: input.discordPayload,
    };
    file.isExample = false;
    file.deliveries.unshift(delivery);
    file.deliveries = file.deliveries.slice(0, 5_000);
    await this.writeFile(file);
    return delivery;
  }

  async prune(maximum: number) {
    const file = await this.readFile();
    const limit = Math.min(5_000, Math.max(100, Math.floor(maximum)));
    if (file.deliveries.length <= limit) return file.deliveries.length;
    file.deliveries = file.deliveries
      .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt))
      .slice(0, limit);
    await this.writeFile(file);
    return file.deliveries.length;
  }

  async get(deliveryId: string) {
    return (await this.read()).find(
      (delivery) => delivery.deliveryId === deliveryId,
    ) ?? null;
  }

  async findByKey(notificationKey: string) {
    return (await this.read()).find(
      (delivery) => delivery.notificationKey === notificationKey,
    ) ?? null;
  }

  async update(
    deliveryId: string,
    patch: Partial<
      Pick<
        AlertDelivery,
        | "status"
        | "attemptedAt"
        | "deliveredAt"
        | "errorMessage"
        | "providerReference"
        | "retryCount"
        | "message"
        | "discordPayload"
      >
    >,
  ) {
    const file = await this.readFile();
    const delivery = file.deliveries.find(
      (item) => item.deliveryId === deliveryId,
    );
    if (!delivery) return null;
    if (patch.status && !deliveryStatuses.has(patch.status)) {
      throw new Error("Unsupported alert delivery status.");
    }
    if (patch.status) delivery.status = patch.status;
    if (patch.attemptedAt) {
      delivery.attemptedAt = isoDate(patch.attemptedAt, "attemptedAt");
    }
    if ("deliveredAt" in patch) {
      delivery.deliveredAt = nullableIsoDate(
        patch.deliveredAt,
        "deliveredAt",
      );
    }
    if ("errorMessage" in patch) {
      delivery.errorMessage = patch.errorMessage?.slice(0, 1_000) ?? null;
    }
    if ("providerReference" in patch) {
      delivery.providerReference =
        patch.providerReference?.slice(0, 500) ?? null;
    }
    if (patch.retryCount !== undefined) {
      delivery.retryCount = Math.max(0, Math.floor(patch.retryCount));
    }
    if ("message" in patch) {
      delivery.message = patch.message?.slice(0, 2_000);
    }
    if ("discordPayload" in patch) {
      delivery.discordPayload = patch.discordPayload;
    }
    file.isExample = false;
    await this.writeFile(file);
    return delivery;
  }

  async recordDashboardSent(eventId: string, message?: string) {
    const deliveries = await this.read();
    const existing = deliveries.find(
      (delivery) =>
        delivery.eventId === eventId && delivery.channel === "dashboard",
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    return this.record({
      eventId,
      notificationKey: `dashboard:signal:${eventId}`,
      channel: "dashboard",
      status: "sent",
      attemptedAt: now,
      deliveredAt: now,
      errorMessage: null,
      providerReference: null,
      retryCount: 0,
      category: "signal",
      message,
    });
  }
}

export function validateDailyPortfolioSnapshot(
  value: unknown,
): DailyPortfolioSnapshot {
  const input = record(value);
  return {
    snapshotId: requiredText(input, "snapshotId", 200),
    timestamp: isoDate(input.timestamp, "timestamp"),
    date: requiredText(input, "date", 10),
    actualPortfolioValue: nullableNumber(input, "actualPortfolioValue"),
    modelPortfolioValue: nullableNumber(input, "modelPortfolioValue"),
    actualDailyPnl: nullableNumber(input, "actualDailyPnl"),
    modelDailyPnl: nullableNumber(input, "modelDailyPnl"),
    realisedPnl: nullableNumber(input, "realisedPnl"),
    unrealisedPnl: nullableNumber(input, "unrealisedPnl"),
    contributions: nullableNumber(input, "contributions"),
    withdrawals: nullableNumber(input, "withdrawals"),
    currentDrawdownPercent: nullableNumber(
      input,
      "currentDrawdownPercent",
    ),
    cashValue: nullableNumber(input, "cashValue"),
    investedValue: nullableNumber(input, "investedValue"),
    source: requiredText(input, "source", 200),
    scannerRunId: requiredText(input, "scannerRunId", 200),
  };
}

export class DailyPortfolioSnapshotRepository {
  constructor(
    private readonly store: JsonStore,
    private readonly filePath = "daily_portfolio_snapshots.json",
  ) {}

  async read() {
    const raw = await this.store.read<
      DailyPortfolioSnapshotFile | DailyPortfolioSnapshot[]
    >(this.filePath);
    const file: DailyPortfolioSnapshotFile = Array.isArray(raw)
      ? { version: 1, isExample: false, snapshots: raw }
      : raw;
    return {
      ...file,
      snapshots: [...file.snapshots].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp),
      ),
    };
  }

  private async writeSnapshots(file: DailyPortfolioSnapshotFile) {
    const raw = await this.store.read<
      DailyPortfolioSnapshotFile | DailyPortfolioSnapshot[]
    >(this.filePath);
    await this.store.write(
      this.filePath,
      Array.isArray(raw) ? file.snapshots : file,
    );
  }

  async save(values: unknown[]) {
    const file = await this.read();
    const byId = new Map(
      file.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot] as const),
    );
    const dedup = new Set(
      file.snapshots.map(
        (snapshot) => `${snapshot.date}|${snapshot.scannerRunId}`,
      ),
    );
    const accepted: DailyPortfolioSnapshot[] = [];
    for (const value of values) {
      const snapshot = validateDailyPortfolioSnapshot(value);
      const key = `${snapshot.date}|${snapshot.scannerRunId}`;
      if (byId.has(snapshot.snapshotId) || dedup.has(key)) continue;
      accepted.push(snapshot);
      byId.set(snapshot.snapshotId, snapshot);
      dedup.add(key);
    }
    if (accepted.length) {
      await this.writeSnapshots({
        version: 1,
        isExample: false,
        snapshots: [...byId.values()].sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp),
        ),
      });
    }
    return accepted;
  }

  async latest() {
    return (await this.read()).snapshots[0] ?? null;
  }
}
