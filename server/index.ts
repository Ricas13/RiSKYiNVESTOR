import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  clearSessionCookie,
  createSession,
  csrfToken,
  readSession,
  requireCsrf,
  requireSession,
  setSessionCookie,
  verifyPassword,
} from "./auth.js";
import {
  buildDataStatusReport,
  cleanupDemoData,
} from "./dataStatus.js";
import {
  MultiStrategyService,
  trimMultiStrategyPublicState,
  type MultiStrategyEvent,
} from "./multiStrategy.js";
import {
  NotificationDispatcher,
  NotificationScheduler,
  type DailySummaryContext,
  type DailyPLReport,
} from "./notifications.js";
import {
  CredentialCipher,
  DiscordDestinationManager,
  loadCredentialEncryptionKey,
} from "./discordDestinations.js";
import { ScannerImportService } from "./scannerImport.js";
import { StrategyConfigurationRepository } from "./strategyConfig.js";
import {
  AlertDeliveryRepository,
  DailyPortfolioSnapshotRepository,
  SignalEventRepository,
} from "./signalEvents.js";
import { initialiseRuntimeData } from "./runtimeData.js";
import { JsonStore } from "./store.js";

interface TradeExit {
  id: string;
  exitDate: string;
  exitPrice: number;
  quantitySold: number;
  fees: number;
  reason: string;
  notes: string;
}

interface ManualTrade {
  id: string;
  strategyName: string;
  sleeve?:
    | "SuperTrend"
    | "SMA200 Regime"
    | "Discretionary / untagged";
  assetName: string;
  ticker: string;
  direction: "long" | "cash" | "other";
  riskTier: "CORE" | "AGGRESSIVE" | "SPECULATIVE" | "EXCLUDED";
  assetClass: string;
  isTechnology: boolean;
  isSingleStock: boolean;
  leverageMultiplier: number;
  entryDate: string;
  entryPrice: number;
  quantity: number;
  amountInvested: number;
  fees: number;
  notes: string;
  source: "manual" | "Discord alert" | "imported";
  referenceLink: string;
  currentPrice: number;
  journal: {
    entryReason: string;
    followedSystem: boolean;
    overrodeSystem: boolean;
    emotionalState: string;
    checkedChart: boolean;
    lesson: string;
  };
  exits: TradeExit[];
  createdAt: string;
  updatedAt: string;
}

interface ManualTradeFile {
  isExample: boolean;
  notice?: string;
  trades: ManualTrade[];
}

interface WealthSnapshot {
  id: string;
  date: string;
  totalPortfolioValue: number;
  cashBalance: number;
  investedValue: number;
  notes: string;
}

interface WealthSnapshotFile {
  isExample: boolean;
  notice?: string;
  snapshots: WealthSnapshot[];
}

interface CashFlow {
  id: string;
  date: string;
  type: "deposit" | "withdrawal";
  amount: number;
  notes: string;
}

interface CashFlowFile {
  isExample: boolean;
  notice?: string;
  cashFlows: CashFlow[];
}

interface SignalDecision {
  signalId: string;
  status:
    | "Taken"
    | "Skipped"
    | "Missed"
    | "Ignored due to risk"
    | "Entered late"
    | "Exited manually"
    | "Partially taken"
    | "Paper only";
  manualTradeId: string | null;
  notes: string;
  assumedStake: number;
  updatedAt: string;
}

interface SignalDecisionFile {
  isExample: boolean;
  notice?: string;
  decisions: SignalDecision[];
}

interface AlertRecord {
  id: string;
  strategyName: string;
  alertType:
    | "ENTRY"
    | "EXIT"
    | "TAKE PROFIT"
    | "DAILY SUMMARY"
    | "ERROR"
    | "LIQUIDITY";
  createdAt: string;
  ticker: string;
  message: string;
  signalId: string | null;
  manualTradeId: string | null;
  status: "unread" | "read" | "actioned" | "ignored";
}

interface AlertFile {
  isExample: boolean;
  notice?: string;
  alerts: AlertRecord[];
}

const projectRoot = process.cwd();
const dataRoot = path.resolve(
  process.env.PRIVATE_DATA_DIR ?? path.join(projectRoot, "data", "private"),
);
const store = new JsonStore(dataRoot);
const app = express();
const port = Number(process.env.PORT ?? 4180);
const dashboardSignalEventLimit = 500;
const dashboardStrategyEventsPerStrategy = 250;

function secretValue(name: string) {
  const filePath = process.env[`${name}_FILE`];
  if (filePath) {
    try {
      return readFileSync(filePath, "utf8").trim();
    } catch {
      throw new Error(`Unable to read ${name}_FILE from ${filePath}.`);
    }
  }
  return process.env[name];
}

const username = secretValue("RISKY_INVESTOR_USERNAME");
const passwordHash = secretValue("RISKY_INVESTOR_PASSWORD_HASH");
const sessionSecret = secretValue("SESSION_SECRET");
const configuredRole = ["owner", "user", "admin"].includes(
  process.env.RISKY_INVESTOR_ROLE ?? "",
)
  ? (process.env.RISKY_INVESTOR_ROLE as "owner" | "user" | "admin")
  : "owner";
const ttlHours = Number(process.env.SESSION_TTL_HOURS ?? 12);
const secureCookies = process.env.NODE_ENV === "production";
const credentialEncryptionKey = loadCredentialEncryptionKey(
  process.env,
  secureCookies,
);

if (!username || !passwordHash || !sessionSecret || sessionSecret.length < 32) {
  throw new Error(
    "Set RISKY_INVESTOR_USERNAME, RISKY_INVESTOR_PASSWORD_HASH and a SESSION_SECRET of at least 32 characters.",
  );
}

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
}

app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  response.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/healthz", (_request, response) => {
  response.json({ status: "ok" });
});

await initialiseRuntimeData(store, {
  username,
  role: configuredRole,
});

const signalEventRepository = new SignalEventRepository(store);
const alertDeliveryRepository = new AlertDeliveryRepository(store);
const dailyPortfolioSnapshotRepository =
  new DailyPortfolioSnapshotRepository(store);
const discordDestinationManager = new DiscordDestinationManager(
  store,
  credentialEncryptionKey
    ? new CredentialCipher(credentialEncryptionKey)
    : null,
  () =>
    secretValue("RISKY_INVESTOR_DISCORD_WEBHOOK_URL")?.trim() ?? null,
);
discordDestinationManager.validateLegacyConfiguration();
const notificationDispatcher = new NotificationDispatcher(
  store,
  alertDeliveryRepository,
  discordDestinationManager,
);
const strategyConfigurationRepository =
  new StrategyConfigurationRepository();
function canonicalStrategyEvent(event: MultiStrategyEvent) {
  const actionableEntry = event.eventType === "entry";
  const actionableExit = event.eventType === "exit";
  const diagnosticSkippedEntry = event.eventType === "skipped_entry";
  const strategyName =
    event.strategyId === "daily-supertrend"
      ? "Daily SuperTrend"
      : "Nasdaq SMA200 Regime — 3x";
  const signalState =
    event.eventType === "entry"
      ? "actionable_entry"
      : event.eventType === "exit"
        ? "actionable_exit"
        : event.eventType === "lowLiquidity"
          ? "low_liquidity_warning"
          : event.eventType === "scannerError"
            ? "scanner_error"
            : "watchlist_only";
  const reasonCode =
    event.eventType === "dailySummary"
      ? "strategy_daily_summary"
      : event.eventType === "weeklySummary"
        ? "strategy_weekly_summary"
        : event.eventType === "stateUpdate"
          ? "strategy_state_update"
          : `strategy_${event.eventType}`;
  return {
    eventId: event.eventId,
    eventVersion: 1,
    occurredAt: new Date(event.occurredAt).toISOString(),
    signalDate: event.signalDate,
    generatedAt:
      event.generatedAt && !Number.isNaN(new Date(event.generatedAt).getTime())
        ? new Date(event.generatedAt).toISOString()
        : new Date(event.occurredAt).toISOString(),
    receivedAt: new Date().toISOString(),
    strategyId: event.strategyId,
    strategyName,
    source: "integrated_python_scanner",
    underlyingTicker: event.signalTicker,
    underlyingName: event.signalTicker,
    tradeTicker: event.executionTicker,
    tradeName: event.executionTicker,
    calculationTicker: event.calculationTicker ?? null,
    signalState,
    previousTrend: actionableEntry
      ? "red"
      : actionableExit
        ? "green"
        : "unknown",
    currentTrend: actionableEntry
      ? "green"
      : actionableExit
        ? "red"
        : "unknown",
    riskTier: "CORE",
    eligibility: actionableEntry || actionableExit ? "eligible" : "unknown",
    allocationStatus:
      actionableEntry || actionableExit ? "normal" : "not_applicable",
    allocationPercent: actionableEntry || actionableExit ? 100 : 0,
    reasonCode,
    reasonText: event.reason,
    scannerRunId: event.eventId,
    rawSourceReference: `multi_strategy_v1:${event.eventId}`,
    isActionable: actionableEntry || actionableExit,
    isAcknowledged: false,
    discordDeliveryEligible: !diagnosticSkippedEntry,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
const multiStrategyService = new MultiStrategyService(store, {
  onEvents: async (events) => {
    if (!events.length) return;
    const result = await signalEventRepository.saveCanonical(
      events.map(canonicalStrategyEvent),
    );
    for (const accepted of result.accepted) {
      await alertDeliveryRepository.recordDashboardSent(
        accepted.eventId,
        accepted.reasonText,
      );
      await notificationDispatcher
        .dispatchSignal(accepted)
        .catch(() => undefined);
    }
  },
});
await signalEventRepository.initialiseFromLegacy(
  (await store.readOptional<Array<Record<string, unknown>>>(
    "model/signals_archive.json",
  )) ?? [],
);
await alertDeliveryRepository.initialise();
const scannerImportService = new ScannerImportService(
  store,
  signalEventRepository,
  alertDeliveryRepository,
  dailyPortfolioSnapshotRepository,
  {
    onAcceptedEvent: async (event) => {
      await notificationDispatcher.dispatchSignal(event);
    },
  },
);

async function buildNotificationContext(): Promise<DailySummaryContext> {
  const [snapshot, signalEvents, scannerState, watchlist] =
    await Promise.all([
    dailyPortfolioSnapshotRepository.latest(),
    signalEventRepository.readPage({ limit: dashboardSignalEventLimit }),
    scannerImportService.readState(),
    store.read<Array<{
      tradeTicker?: string;
      underlyingTicker?: string;
      entryTicker?: string;
      currentTrend?: string;
    }>>("model/watchlist_status.json"),
  ]);
  const scanner = scannerImportService.toPublicState(scannerState);
  return {
    snapshot,
    latestActionableEvent:
      signalEvents.events.find((event) => event.isActionable) ?? null,
    scanner: {
      ...scanner,
      watchlist: watchlist.map((item) => ({
        tradeTicker: item.tradeTicker,
        underlyingTicker:
          item.underlyingTicker ?? item.entryTicker,
        currentTrend: item.currentTrend,
      })),
    },
  };
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginAllowed(request: Request) {
  const key = request.ip ?? "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  return entry.count < 10;
}

function recordFailedLogin(request: Request) {
  const key = request.ip ?? "unknown";
  const entry = loginAttempts.get(key) ?? {
    count: 0,
    resetAt: Date.now() + 15 * 60 * 1000,
  };
  entry.count += 1;
  loginAttempts.set(key, entry);
}

function numberValue(value: unknown, field: string, minimum = 0) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum) {
    throw new Error(`${field} must be a valid number.`);
  }
  return result;
}

function stringValue(value: unknown, field: string, required = true) {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new Error(`${field} is required.`);
  return result;
}

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function numberQuery(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = Array.isArray(value) ? value[0] : value;
  const result =
    typeof raw === "string" && raw.trim() ? Number(raw) : fallback;
  if (!Number.isFinite(result)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(result)));
}

function tradeSleeve(
  value: unknown,
): NonNullable<ManualTrade["sleeve"]> {
  return ["SuperTrend", "SMA200 Regime"].includes(String(value))
    ? (value as "SuperTrend" | "SMA200 Regime")
    : "Discretionary / untagged";
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRows(headers: string[], rows: Array<Record<string, unknown>>) {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("CSV must include a header and at least one row.");
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function safeMutation(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return async (request: Request, response: Response) => {
    try {
      await handler(request, response);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Invalid request.",
      });
    }
  };
}

function requireOwner(
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  const result = response.locals.session as
    | ReturnType<typeof readSession>
    | undefined;
  if (!result || !["owner", "admin"].includes(result.session.role)) {
    response.status(403).json({ error: "Owner or admin access is required." });
    return;
  }
  next();
}

async function syncTradeViews(file: ManualTradeFile) {
  const open = file.trades.filter(
    (trade) =>
      trade.quantity -
        trade.exits.reduce((sum, exit) => sum + exit.quantitySold, 0) >
      0.000001,
  );
  const closed = file.trades.filter(
    (trade) =>
      trade.quantity -
        trade.exits.reduce((sum, exit) => sum + exit.quantitySold, 0) <=
      0.000001,
  );
  await Promise.all([
    store.write("open_positions.json", {
      isExample: file.isExample,
      generatedAt: new Date().toISOString(),
      positions: open,
    }),
    store.write("closed_trades.json", {
      isExample: file.isExample,
      generatedAt: new Date().toISOString(),
      trades: closed,
    }),
  ]);
}

function manualPL(trades: ManualTrade[]) {
  return trades.reduce(
    (totals, trade) => {
      const quantitySold = trade.exits.reduce(
        (sum, exit) => sum + exit.quantitySold,
        0,
      );
      const remaining = Math.max(0, trade.quantity - quantitySold);
      const unitCost =
        trade.quantity > 0
          ? (trade.entryPrice * trade.quantity + trade.fees) / trade.quantity
          : 0;
      const realisedProceeds = trade.exits.reduce(
        (sum, exit) => sum + exit.exitPrice * exit.quantitySold - exit.fees,
        0,
      );
      totals.realisedPL += realisedProceeds - unitCost * quantitySold;
      totals.unrealisedPL += remaining * (trade.currentPrice - unitCost);
      return totals;
    },
    { realisedPL: 0, unrealisedPL: 0 },
  );
}

async function buildDailyPLReport(): Promise<DailyPLReport> {
  const [
    snapshotsFile,
    cashFlowFile,
    tradeFile,
    performance,
    signalEvents,
    scannerSnapshot,
  ] =
    await Promise.all([
      store.read<WealthSnapshotFile>("wealth_snapshots.json"),
      store.read<CashFlowFile>("cash_flows.json"),
      store.read<ManualTradeFile>("manual_trades.json"),
      store.read<{
        realisedModelPL: number;
        realisedSeries: Array<{ date: string; value: number }>;
      }>("model/performance.json"),
      signalEventRepository.readPage({ limit: dashboardSignalEventLimit }),
      dailyPortfolioSnapshotRepository.latest(),
    ]);
  const snapshots = [...snapshotsFile.snapshots].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const latest = snapshots.at(-1);
  const previous = snapshots.at(-2);
  const intervalFlows = cashFlowFile.cashFlows.filter(
    (flow) =>
      (!previous || flow.date > previous.date) &&
      (!latest || flow.date <= latest.date),
  );
  const contributions = intervalFlows
    .filter((flow) => flow.type === "deposit")
    .reduce((sum, flow) => sum + flow.amount, 0);
  const withdrawals = intervalFlows
    .filter((flow) => flow.type === "withdrawal")
    .reduce((sum, flow) => sum + flow.amount, 0);
  const actualDailyPL =
    scannerSnapshot?.actualDailyPnl ??
    ((latest?.totalPortfolioValue ?? 0) -
      (previous?.totalPortfolioValue ?? latest?.totalPortfolioValue ?? 0) -
      contributions +
      withdrawals);
  const actualDailyPLPercent =
    (previous?.totalPortfolioValue ?? 0) > 0
      ? (actualDailyPL / previous!.totalPortfolioValue) * 100
      : 0;
  const netDeposits = cashFlowFile.cashFlows.reduce(
    (sum, flow) =>
      sum + (flow.type === "deposit" ? flow.amount : -flow.amount),
    0,
  );
  const modelSeries = [...performance.realisedSeries].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const currentModel = modelSeries.at(-1)?.value ?? performance.realisedModelPL;
  const previousModel = modelSeries.at(-2)?.value ?? currentModel;
  const peak = Math.max(
    0,
    ...snapshots.map((snapshot) => snapshot.totalPortfolioValue),
  );
  const currentValue = latest?.totalPortfolioValue ?? 0;
  const { realisedPL, unrealisedPL } = manualPL(tradeFile.trades);

  return {
    reportDate: latest?.date ?? new Date().toISOString().slice(0, 10),
    actualDailyPL,
    actualDailyPLPercent:
      scannerSnapshot?.actualPortfolioValue &&
      scannerSnapshot.actualDailyPnl !== null
        ? (scannerSnapshot.actualDailyPnl /
            Math.max(
              1,
              scannerSnapshot.actualPortfolioValue -
                scannerSnapshot.actualDailyPnl,
            )) *
          100
        : actualDailyPLPercent,
    actualTotalPL: currentValue - netDeposits,
    modelDailyPLPercent:
      scannerSnapshot?.modelDailyPnl ?? currentModel - previousModel,
    modelTotalPLPercent: performance.realisedModelPL,
    realisedPL: scannerSnapshot?.realisedPnl ?? realisedPL,
    unrealisedPL: scannerSnapshot?.unrealisedPnl ?? unrealisedPL,
    contributions: scannerSnapshot?.contributions ?? contributions,
    withdrawals: scannerSnapshot?.withdrawals ?? withdrawals,
    drawdownPercent:
      scannerSnapshot?.currentDrawdownPercent ??
      (peak > 0 ? ((currentValue - peak) / peak) * 100 : 0),
    actionableSignalEvents: signalEvents.events.filter(
      (event) =>
        event.occurredAt.slice(0, 10) ===
          (latest?.date ?? new Date().toISOString().slice(0, 10)) &&
        event.isActionable,
    ).length,
  };
}

const backupPaths = {
  account: "account.json",
  strategies: "strategies.json",
  settings: "settings.json",
  signalEvents: "signal_events.json",
  dailyPortfolioSnapshots: "daily_portfolio_snapshots.json",
  scannerImportState: "scanner_import_state.json",
  notificationSettings: "notification_settings.json",
  notificationDeliveries: "alert_deliveries.json",
  manualTrades: "manual_trades.json",
  wealthSnapshots: "wealth_snapshots.json",
  cashFlows: "cash_flows.json",
  signalDecisions: "signal_decisions.json",
  alerts: "alerts.json",
  signalArchive: "model/signals_archive.json",
  modelSummary: "model/latest_summary.json",
  watchlistStatus: "model/watchlist_status.json",
  signalsToday: "model/signals_today.json",
  modelOpenTrades: "model/open_trades.json",
  modelClosedTrades: "model/closed_trades.json",
  modelPerformance: "model/performance.json",
  siteConfig: "model/site_config.json",
  openPositions: "open_positions.json",
  closedTrades: "closed_trades.json",
  auditLog: "audit_log.json",
} as const;

const requiredBackupKeys = [
  "account",
  "strategies",
  "settings",
  "manualTrades",
  "wealthSnapshots",
  "cashFlows",
  "signalDecisions",
  "alerts",
  "signalArchive",
] as const;

async function readBackup() {
  const entries = await Promise.all(
    Object.entries(backupPaths).map(async ([key, relativePath]) => [
      key,
      await store.read(relativePath),
    ]),
  );
  return {
    format: "risky-investor-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: Object.fromEntries(entries),
  };
}

async function unlinkManualTrade(tradeId: string) {
  const [decisions, alerts] = await Promise.all([
    store.read<SignalDecisionFile>("signal_decisions.json"),
    store.read<AlertFile>("alerts.json"),
  ]);
  let decisionsChanged = false;
  let alertsChanged = false;
  decisions.decisions.forEach((decision) => {
    if (decision.manualTradeId === tradeId) {
      decision.manualTradeId = null;
      decision.updatedAt = new Date().toISOString();
      decisionsChanged = true;
    }
  });
  alerts.alerts.forEach((alert) => {
    if (alert.manualTradeId === tradeId) {
      alert.manualTradeId = null;
      alertsChanged = true;
    }
  });
  await Promise.all([
    decisionsChanged
      ? store.write("signal_decisions.json", decisions)
      : Promise.resolve(),
    alertsChanged ? store.write("alerts.json", alerts) : Promise.resolve(),
  ]);
}

app.get("/api/auth/session", (request, response) => {
  const result = readSession(request, sessionSecret);
  if (!result) {
    response.status(401).json({ authenticated: false });
    return;
  }
  response.json({
    authenticated: true,
    username: result.session.username,
    role: result.session.role,
    csrfToken: csrfToken(result.token, sessionSecret),
  });
});

app.post("/api/auth/login", async (request, response) => {
  if (!loginAllowed(request)) {
    response.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }

  const suppliedUsername = String(request.body?.username ?? "");
  const suppliedPassword = String(request.body?.password ?? "");
  const validName =
    Buffer.byteLength(suppliedUsername) === Buffer.byteLength(username) &&
    suppliedUsername === username;
  const validPassword = verifyPassword(suppliedPassword, passwordHash);
  if (!validName || !validPassword) {
    recordFailedLogin(request);
    await new Promise((resolve) => setTimeout(resolve, 350));
    response.status(401).json({ error: "Invalid username or password." });
    return;
  }

  loginAttempts.delete(request.ip ?? "unknown");
  const token = createSession(username, configuredRole, sessionSecret, ttlHours);
  setSessionCookie(response, token, secureCookies, ttlHours);
  response.json({
    authenticated: true,
    username,
    role: configuredRole,
    csrfToken: csrfToken(token, sessionSecret),
  });
});

app.post(
  "/api/auth/logout",
  requireSession(sessionSecret),
  requireCsrf(sessionSecret),
  (_request, response) => {
    clearSessionCookie(response, secureCookies);
    response.status(204).end();
  },
);

const protectedApi = express.Router();
protectedApi.use(requireSession(sessionSecret));

protectedApi.get("/dashboard", async (request, response) => {
  const [scannerImport, strategyMonitor, strategyConfiguration] =
    await Promise.all([
      scannerImportService.refreshIfDue(),
      multiStrategyService.refresh(),
      strategyConfigurationRepository.read(),
    ]);
  const [
    summary,
    watchlist,
    signals,
    modelOpenTrades,
    modelClosedTrades,
    performance,
    config,
    manualTrades,
    wealthSnapshots,
    cashFlows,
    account,
    strategies,
    settings,
    signalArchive,
    signalDecisions,
    alerts,
    signalEvents,
    notifications,
    dailyPL,
    latestPortfolioSnapshot,
    dataStatus,
  ] = await Promise.all([
    store.read("model/latest_summary.json"),
    store.read("model/watchlist_status.json"),
    store.read("model/signals_today.json"),
    store.read("model/open_trades.json"),
    store.read("model/closed_trades.json"),
    store.read("model/performance.json"),
    store.read("model/site_config.json"),
    store.read("manual_trades.json"),
    store.read("wealth_snapshots.json"),
    store.read("cash_flows.json"),
    store.read("account.json"),
    store.read("strategies.json"),
    store.read("settings.json"),
    store.read("model/signals_archive.json"),
    store.read("signal_decisions.json"),
    store.read("alerts.json"),
    signalEventRepository.readPage({
      limit: numberQuery(
        request.query.signalEventLimit,
        dashboardSignalEventLimit,
        1,
        1_000,
      ),
      offset: numberQuery(request.query.signalEventOffset, 0, 0, 1_000_000),
    }),
    notificationDispatcher.publicState(),
    buildDailyPLReport(),
    dailyPortfolioSnapshotRepository.latest(),
    buildDataStatusReport(store, {
      username,
      role: configuredRole,
    }),
  ]);
  response.json({
    summary,
    watchlist: scannerImport.watchlist.length
      ? scannerImport.watchlist
      : watchlist,
    signals,
    openTrades: modelOpenTrades,
    closedTrades: modelClosedTrades,
    performance,
    config,
    manualTrades,
    wealthSnapshots,
    cashFlows,
    account,
    strategies,
    settings,
    signalArchive,
    signalDecisions,
    alerts,
    signalEvents,
    notifications,
    dailyPL,
    latestPortfolioSnapshot,
    scannerImport: scannerImportService.toPublicState(scannerImport),
    strategyMonitor: trimMultiStrategyPublicState(strategyMonitor, {
      eventsPerStrategy: dashboardStrategyEventsPerStrategy,
    }),
    strategyConfiguration,
    dataStatus,
  });
});

const cleanupBackupReceipts = new Map<string, number>();
const cleanupPreviewReceipts = new Map<string, number>();
const cleanupBackupReceiptTtl = 30 * 60 * 1000;

function sessionToken(response: Response) {
  const result = response.locals.session as
    | ReturnType<typeof readSession>
    | undefined;
  return result?.token ?? null;
}

protectedApi.get(
  "/data-cleanup/preview",
  requireOwner,
  safeMutation(async (_request, response) => {
    const token = sessionToken(response);
    if (!token) throw new Error("Authentication required.");
    cleanupPreviewReceipts.set(token, Date.now());
    const receipt = token ? cleanupBackupReceipts.get(token) : undefined;
    response.json({
      report: await buildDataStatusReport(store, {
        username,
        role: configuredRole,
      }),
      confirmationText: "REMOVE DEMO DATA",
      backupDownloaded:
        receipt !== undefined && Date.now() - receipt <= cleanupBackupReceiptTtl,
      backupReceiptExpiresMinutes: 30,
    });
  }),
);

protectedApi.get(
  "/data-cleanup/backup",
  requireOwner,
  safeMutation(async (_request, response) => {
    const token = sessionToken(response);
    if (!token) throw new Error("Authentication required.");
    if (!cleanupPreviewReceipts.has(token)) {
      throw new Error("Preview the demo-data cleanup before downloading a backup.");
    }
    const backup = await readBackup();
    cleanupBackupReceipts.set(token, Date.now());
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="risky-investor-pre-cleanup-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    response.json(backup);
  }),
);

protectedApi.post(
  "/data-cleanup",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    if (request.body?.confirmation !== "REMOVE DEMO DATA") {
      throw new Error('Type "REMOVE DEMO DATA" exactly to continue.');
    }
    const token = sessionToken(response);
    const receipt = token ? cleanupBackupReceipts.get(token) : undefined;
    const previewReceipt = token
      ? cleanupPreviewReceipts.get(token)
      : undefined;
    if (
      previewReceipt === undefined ||
      receipt === undefined ||
      Date.now() - receipt > cleanupBackupReceiptTtl ||
      receipt < previewReceipt
    ) {
      throw new Error(
        "Preview the cleanup and download a fresh pre-cleanup backup before removing demo data.",
      );
    }
    const result = await cleanupDemoData(store, {
      username,
      role: configuredRole,
    });
    cleanupBackupReceipts.delete(token!);
    cleanupPreviewReceipts.delete(token!);
    const archive = await store.read<Array<Record<string, unknown>>>(
      "model/signals_archive.json",
    );
    await signalEventRepository.initialiseFromLegacy(archive);
    response.json({
      ...result,
      report: await buildDataStatusReport(store, {
        username,
        role: configuredRole,
      }),
    });
  }),
);

protectedApi.put(
  "/signal-decisions/:signalId",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const allowedStatuses: SignalDecision["status"][] = [
      "Taken",
      "Skipped",
      "Missed",
      "Ignored due to risk",
      "Entered late",
      "Exited manually",
      "Partially taken",
      "Paper only",
    ];
    if (!allowedStatuses.includes(request.body.status)) {
      throw new Error("Select a valid signal decision status.");
    }
    const file = await store.read<SignalDecisionFile>("signal_decisions.json");
    const signalId = String(request.params.signalId);
    const manualTradeId = request.body.manualTradeId
      ? stringValue(request.body.manualTradeId, "Manual trade")
      : null;
    if (manualTradeId) {
      const trades = await store.read<ManualTradeFile>("manual_trades.json");
      if (!trades.trades.some((trade) => trade.id === manualTradeId)) {
        throw new Error("Linked manual trade was not found.");
      }
    }
    const decision: SignalDecision = {
      signalId,
      status: request.body.status,
      manualTradeId,
      notes: stringValue(request.body.notes, "Decision notes", false),
      assumedStake: numberValue(
        request.body.assumedStake ?? 1000,
        "Assumed stake",
      ),
      updatedAt: new Date().toISOString(),
    };
    const index = file.decisions.findIndex(
      (item) => item.signalId === signalId,
    );
    if (index >= 0) file.decisions[index] = decision;
    else file.decisions.push(decision);
    file.isExample = false;
    delete file.notice;
    await store.write("signal_decisions.json", file);
    response.json(decision);
  }),
);

protectedApi.put(
  "/alerts/:id",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const statuses: AlertRecord["status"][] = [
      "unread",
      "read",
      "actioned",
      "ignored",
    ];
    if (!statuses.includes(request.body.status)) {
      throw new Error("Select a valid alert status.");
    }
    const file = await store.read<AlertFile>("alerts.json");
    const alert = file.alerts.find((item) => item.id === request.params.id);
    if (!alert) {
      response.status(404).json({ error: "Alert not found." });
      return;
    }
    alert.status = request.body.status;
    if (request.body.manualTradeId) {
      const manualTradeId = stringValue(
        request.body.manualTradeId,
        "Manual trade",
      );
      const trades = await store.read<ManualTradeFile>("manual_trades.json");
      if (!trades.trades.some((trade) => trade.id === manualTradeId)) {
        throw new Error("Linked manual trade was not found.");
      }
      alert.manualTradeId = manualTradeId;
    }
    file.isExample = false;
    delete file.notice;
    await store.write("alerts.json", file);
    response.json(alert);
  }),
);

protectedApi.put(
  "/strategy-configuration",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.json(
      await strategyConfigurationRepository.update(request.body),
    );
  }),
);

protectedApi.post(
  "/scanner/refresh",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (_request, response) => {
    response.json(
      trimMultiStrategyPublicState(await multiStrategyService.refresh(true), {
        eventsPerStrategy: dashboardStrategyEventsPerStrategy,
      }),
    );
  }),
);

protectedApi.put(
  "/settings",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const settings = {
      isExample: false,
      assumedMissedStake: numberValue(
        request.body.assumedMissedStake,
        "Assumed missed stake",
      ),
      riskLimits: {
        maxTickerPct: numberValue(
          request.body.riskLimits?.maxTickerPct,
          "Ticker concentration limit",
        ),
        maxTechnologyPct: numberValue(
          request.body.riskLimits?.maxTechnologyPct,
          "Technology concentration limit",
        ),
        maxSpeculativePct: numberValue(
          request.body.riskLimits?.maxSpeculativePct,
          "Speculative exposure limit",
        ),
        maxLeveraged3xPct: numberValue(
          request.body.riskLimits?.maxLeveraged3xPct,
          "Leveraged exposure limit",
        ),
        minimumCashPct: numberValue(
          request.body.riskLimits?.minimumCashPct,
          "Minimum cash limit",
        ),
        elevatedDrawdownPct: numberValue(
          request.body.riskLimits?.elevatedDrawdownPct,
          "Elevated drawdown limit",
        ),
      },
    };
    await store.write("settings.json", settings);
    response.json(settings);
  }),
);

protectedApi.put(
  "/notification-settings",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const current = await notificationDispatcher.settings();
    const settings = await notificationDispatcher.updateSettings({
      ...current,
      ...request.body,
      discord: { ...current.discord, ...request.body?.discord },
      whatsapp: { ...current.whatsapp, ...request.body?.whatsapp },
      signalAlerts: {
        ...current.signalAlerts,
        ...request.body?.signalAlerts,
      },
      dailySummary: {
        ...current.dailySummary,
        ...request.body?.dailySummary,
        metrics: {
          ...current.dailySummary.metrics,
          ...request.body?.dailySummary?.metrics,
        },
      },
      weeklySummary: {
        ...current.weeklySummary,
        ...request.body?.weeklySummary,
      },
      migration: {
        ...current.migration,
        ...request.body?.migration,
      },
      thresholds: {
        ...current.thresholds,
        ...request.body?.thresholds,
      },
      quietHours: {
        ...current.quietHours,
        ...request.body?.quietHours,
      },
      retention: {
        ...current.retention,
        ...request.body?.retention,
      },
    });
    response.json(settings);
  }),
);

protectedApi.post(
  "/discord-destinations",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.status(201).json(
      await discordDestinationManager.create({
        label: request.body?.label,
        webhook: request.body?.webhook,
        enabled: request.body?.enabled,
        displayName: request.body?.displayName,
        avatarUrl: request.body?.avatarUrl,
      }),
    );
  }),
);

protectedApi.put(
  "/discord-destinations/:destinationId",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.json(
      await discordDestinationManager.update(
        String(request.params.destinationId),
        {
          label: request.body?.label,
          enabled: request.body?.enabled,
          displayName: request.body?.displayName,
          avatarUrl: request.body?.avatarUrl,
        },
      ),
    );
  }),
);

protectedApi.put(
  "/discord-destinations/:destinationId/webhook",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.json(
      await discordDestinationManager.replaceWebhook(
        String(request.params.destinationId),
        request.body?.webhook,
      ),
    );
  }),
);

protectedApi.delete(
  "/discord-destinations/:destinationId",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.json(
      await discordDestinationManager.delete(
        String(request.params.destinationId),
      ),
    );
  }),
);

protectedApi.post(
  "/discord-destinations/:destinationId/test",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.json(
      await notificationDispatcher.testDiscord(
        String(request.params.destinationId),
        false,
      ),
    );
  }),
);

protectedApi.post(
  "/notifications/test",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.json(
      await notificationDispatcher.testDiscord(
        undefined,
        request.body?.dryRun === true,
      ),
    );
  }),
);

protectedApi.post(
  "/notifications/daily-summary/dry-run",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.json(
      await notificationDispatcher.runDailySummary(
        await buildNotificationContext(),
        {
          dryRun: true,
          recordDryRun: request.body?.recordDryRun === true,
          force: request.body?.force === true,
        },
      ),
    );
  }),
);

protectedApi.post(
  "/notifications/daily-summary/run",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.json(
      await notificationDispatcher.runDailySummary(
        await buildNotificationContext(),
        { force: request.body?.force === true },
      ),
    );
  }),
);

protectedApi.post(
  "/notifications/deliveries/:deliveryId/retry",
  requireOwner,
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    response.json(
      await notificationDispatcher.retryDelivery(
        String(request.params.deliveryId),
        request.body?.confirmResend === true,
      ),
    );
  }),
);

protectedApi.get("/export/all", async (_request, response) => {
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="risky-investor-export-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  response.json(await readBackup());
});

protectedApi.get("/export/trades.csv", async (_request, response) => {
  const file = await store.read<ManualTradeFile>("manual_trades.json");
  const headers = [
    "id",
    "strategyName",
    "sleeve",
    "assetName",
    "ticker",
    "direction",
    "riskTier",
    "assetClass",
    "isTechnology",
    "isSingleStock",
    "leverageMultiplier",
    "entryDate",
    "entryPrice",
    "quantity",
    "amountInvested",
    "fees",
    "currentPrice",
    "source",
    "notes",
    "referenceLink",
    "entryReason",
    "followedSystem",
    "overrodeSystem",
    "emotionalState",
    "checkedChart",
    "lesson",
  ];
  const rows = file.trades.map((trade) => ({
    ...trade,
    entryReason: trade.journal?.entryReason ?? "",
    followedSystem: trade.journal?.followedSystem ?? false,
    overrodeSystem: trade.journal?.overrodeSystem ?? false,
    emotionalState: trade.journal?.emotionalState ?? "",
    checkedChart: trade.journal?.checkedChart ?? false,
    lesson: trade.journal?.lesson ?? "",
  }));
  response.type("text/csv");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="risky-investor-trades-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  response.send(csvRows(headers, rows));
});

protectedApi.get("/export/wealth.csv", async (_request, response) => {
  const file = await store.read<WealthSnapshotFile>("wealth_snapshots.json");
  const headers = [
    "id",
    "date",
    "totalPortfolioValue",
    "cashBalance",
    "investedValue",
    "notes",
  ];
  response.type("text/csv");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="risky-investor-wealth-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  response.send(
    csvRows(
      headers,
      file.snapshots.map((snapshot) => ({ ...snapshot })),
    ),
  );
});

protectedApi.post(
  "/import/manual-trades-csv",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const rows = parseCsv(stringValue(request.body.csv, "CSV"));
    const file = await store.read<ManualTradeFile>("manual_trades.json");
    const imported = rows.map((row): ManualTrade => {
      const now = new Date().toISOString();
      return {
        id: row.id?.trim() || randomUUID(),
        strategyName: stringValue(row.strategyName, "Strategy"),
        sleeve: tradeSleeve(row.sleeve),
        assetName: stringValue(row.assetName, "Asset name"),
        ticker: stringValue(row.ticker, "Ticker").toUpperCase(),
        direction: ["long", "cash", "other"].includes(row.direction)
          ? (row.direction as ManualTrade["direction"])
          : "long",
        riskTier: ["CORE", "AGGRESSIVE", "SPECULATIVE", "EXCLUDED"].includes(
          row.riskTier,
        )
          ? (row.riskTier as ManualTrade["riskTier"])
          : "CORE",
        assetClass: stringValue(row.assetClass || "Other", "Asset class"),
        isTechnology: booleanValue(row.isTechnology),
        isSingleStock: booleanValue(row.isSingleStock),
        leverageMultiplier: numberValue(
          row.leverageMultiplier || 1,
          "Leverage multiplier",
          1,
        ),
        entryDate: stringValue(row.entryDate, "Entry date"),
        entryPrice: numberValue(row.entryPrice, "Entry price", 0.000001),
        quantity: numberValue(row.quantity, "Quantity", 0.000001),
        amountInvested: numberValue(row.amountInvested, "Amount invested"),
        fees: numberValue(row.fees || 0, "Fees"),
        notes: row.notes?.trim() ?? "",
        source: "imported",
        referenceLink: row.referenceLink?.trim() ?? "",
        currentPrice: numberValue(
          row.currentPrice || row.entryPrice,
          "Current price",
          0.000001,
        ),
        journal: {
          entryReason: row.entryReason?.trim() ?? "",
          followedSystem: booleanValue(row.followedSystem),
          overrodeSystem: booleanValue(row.overrodeSystem),
          emotionalState: row.emotionalState?.trim() ?? "",
          checkedChart: booleanValue(row.checkedChart),
          lesson: row.lesson?.trim() ?? "",
        },
        exits: [],
        createdAt: now,
        updatedAt: now,
      };
    });
    const existingIds = new Set(file.trades.map((trade) => trade.id));
    file.trades.unshift(
      ...imported.map((trade) =>
        existingIds.has(trade.id) ? { ...trade, id: randomUUID() } : trade,
      ),
    );
    file.isExample = false;
    delete file.notice;
    await store.write("manual_trades.json", file);
    await syncTradeViews(file);
    response.status(201).json({ imported: imported.length });
  }),
);

protectedApi.post(
  "/import/signals-json",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const imported = Array.isArray(request.body.signalEvents)
      ? request.body.signalEvents
      : Array.isArray(request.body.signals)
        ? request.body.signals
      : Array.isArray(request.body)
        ? request.body
        : null;
    if (!imported) {
      throw new Error("Signals JSON must contain a signalEvents array.");
    }
    const result = await signalEventRepository.saveCanonical(imported);
    for (const event of result.accepted) {
      await alertDeliveryRepository.recordDashboardSent(
        event.eventId,
        event.reasonText,
      );
      await notificationDispatcher.dispatchSignal(event);
    }
    response.status(201).json({
      imported: result.accepted.length,
      duplicates: result.duplicates.length,
      actionable: result.accepted.filter((event) => event.isActionable).length,
      events: result.accepted,
    });
  }),
);

protectedApi.put(
  "/signal-events/:eventId/acknowledge",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const session = response.locals.session as
      | ReturnType<typeof readSession>
      | undefined;
    const event = await signalEventRepository.acknowledge(
      String(request.params.eventId),
      request.body?.acknowledged !== false,
      session?.session.username ?? "authenticated dashboard session",
      stringValue(request.body?.note, "note", false),
    );
    if (!event) {
      response.status(404).json({ error: "Signal event not found." });
      return;
    }
    response.json(event);
  }),
);

protectedApi.get("/backup", async (_request, response) => {
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="risky-investor-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  response.json(await readBackup());
});

protectedApi.post(
  "/restore",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    if (
      request.body?.format !== "risky-investor-backup" ||
      request.body?.version !== 1 ||
      typeof request.body?.data !== "object"
    ) {
      throw new Error("Unsupported or invalid Risky Investor backup.");
    }
    const data = request.body.data as Record<string, unknown>;
    const missingKey = requiredBackupKeys.find((key) => !(key in data));
    if (missingKey) throw new Error(`Backup is missing ${missingKey}.`);
    await Promise.all(
      Object.entries(backupPaths).map(async ([key, relativePath]) => {
        if (key in data) await store.write(relativePath, data[key]);
      }),
    );
    if (!("signalEvents" in data)) {
      await store.write("signal_events.json", {
        version: 2,
        isExample: false,
        events: [],
      });
    }
    const manualTrades = await store.read<ManualTradeFile>("manual_trades.json");
    await syncTradeViews(manualTrades);
    await signalEventRepository.initialiseFromLegacy(
      await store.read<Array<Record<string, unknown>>>(
        "model/signals_archive.json",
      ),
    );
    response.json({ restored: true });
  }),
);

protectedApi.post(
  "/manual-trades",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const now = new Date().toISOString();
    const trade: ManualTrade = {
      id: randomUUID(),
      strategyName: stringValue(request.body.strategyName, "Strategy"),
      sleeve: tradeSleeve(request.body.sleeve),
      assetName: stringValue(request.body.assetName, "Asset name"),
      ticker: stringValue(request.body.ticker, "Ticker").toUpperCase(),
      direction: ["long", "cash", "other"].includes(request.body.direction)
        ? request.body.direction
        : "long",
      riskTier: ["CORE", "AGGRESSIVE", "SPECULATIVE", "EXCLUDED"].includes(
        request.body.riskTier,
      )
        ? request.body.riskTier
        : "CORE",
      assetClass: stringValue(
        request.body.assetClass ?? "Other",
        "Asset class",
      ),
      isTechnology: booleanValue(request.body.isTechnology),
      isSingleStock: booleanValue(request.body.isSingleStock),
      leverageMultiplier: numberValue(
        request.body.leverageMultiplier ?? 1,
        "Leverage multiplier",
        1,
      ),
      entryDate: stringValue(request.body.entryDate, "Entry date"),
      entryPrice: numberValue(request.body.entryPrice, "Entry price", 0.000001),
      quantity: numberValue(request.body.quantity, "Quantity", 0.000001),
      amountInvested: numberValue(
        request.body.amountInvested,
        "Amount invested",
      ),
      fees: numberValue(request.body.fees ?? 0, "Fees"),
      notes: stringValue(request.body.notes, "Notes", false),
      source: ["manual", "Discord alert", "imported"].includes(request.body.source)
        ? request.body.source
        : "manual",
      referenceLink: stringValue(
        request.body.referenceLink,
        "Reference link",
        false,
      ),
      currentPrice: numberValue(
        request.body.currentPrice ?? request.body.entryPrice,
        "Current price",
        0.000001,
      ),
      journal: {
        entryReason: stringValue(
          request.body.journal?.entryReason,
          "Entry reason",
          false,
        ),
        followedSystem: booleanValue(request.body.journal?.followedSystem),
        overrodeSystem: booleanValue(request.body.journal?.overrodeSystem),
        emotionalState: stringValue(
          request.body.journal?.emotionalState,
          "Emotional state",
          false,
        ),
        checkedChart: booleanValue(request.body.journal?.checkedChart),
        lesson: stringValue(
          request.body.journal?.lesson,
          "Trade lesson",
          false,
        ),
      },
      exits: [],
      createdAt: now,
      updatedAt: now,
    };
    const file = await store.read<ManualTradeFile>("manual_trades.json");
    file.isExample = false;
    delete file.notice;
    file.trades.unshift(trade);
    await store.write("manual_trades.json", file);
    await syncTradeViews(file);
    response.status(201).json(trade);
  }),
);

protectedApi.put(
  "/manual-trades/:id",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const file = await store.read<ManualTradeFile>("manual_trades.json");
    const index = file.trades.findIndex((trade) => trade.id === request.params.id);
    if (index < 0) {
      response.status(404).json({ error: "Trade not found." });
      return;
    }
    const current = file.trades[index];
    const quantity = numberValue(request.body.quantity, "Quantity", 0.000001);
    const quantitySold = current.exits.reduce(
      (sum, exit) => sum + exit.quantitySold,
      0,
    );
    if (quantity + 0.000001 < quantitySold) {
      throw new Error(
        `Quantity cannot be less than the ${quantitySold} units already sold.`,
      );
    }
    file.trades[index] = {
      ...current,
      strategyName: stringValue(request.body.strategyName, "Strategy"),
      sleeve: tradeSleeve(request.body.sleeve ?? current.sleeve),
      assetName: stringValue(request.body.assetName, "Asset name"),
      ticker: stringValue(request.body.ticker, "Ticker").toUpperCase(),
      direction: ["long", "cash", "other"].includes(request.body.direction)
        ? request.body.direction
        : current.direction,
      riskTier: ["CORE", "AGGRESSIVE", "SPECULATIVE", "EXCLUDED"].includes(
        request.body.riskTier,
      )
        ? request.body.riskTier
        : current.riskTier,
      assetClass: stringValue(
        request.body.assetClass ?? current.assetClass ?? "Other",
        "Asset class",
      ),
      isTechnology: booleanValue(request.body.isTechnology),
      isSingleStock: booleanValue(request.body.isSingleStock),
      leverageMultiplier: numberValue(
        request.body.leverageMultiplier ?? current.leverageMultiplier ?? 1,
        "Leverage multiplier",
        1,
      ),
      entryDate: stringValue(request.body.entryDate, "Entry date"),
      entryPrice: numberValue(request.body.entryPrice, "Entry price", 0.000001),
      quantity,
      amountInvested: numberValue(
        request.body.amountInvested,
        "Amount invested",
      ),
      fees: numberValue(request.body.fees ?? 0, "Fees"),
      notes: stringValue(request.body.notes, "Notes", false),
      source: ["manual", "Discord alert", "imported"].includes(request.body.source)
        ? request.body.source
        : current.source,
      referenceLink: stringValue(
        request.body.referenceLink,
        "Reference link",
        false,
      ),
      currentPrice: numberValue(
        request.body.currentPrice,
        "Current price",
        0.000001,
      ),
      journal: {
        entryReason: stringValue(
          request.body.journal?.entryReason,
          "Entry reason",
          false,
        ),
        followedSystem: booleanValue(request.body.journal?.followedSystem),
        overrodeSystem: booleanValue(request.body.journal?.overrodeSystem),
        emotionalState: stringValue(
          request.body.journal?.emotionalState,
          "Emotional state",
          false,
        ),
        checkedChart: booleanValue(request.body.journal?.checkedChart),
        lesson: stringValue(
          request.body.journal?.lesson,
          "Trade lesson",
          false,
        ),
      },
      updatedAt: new Date().toISOString(),
    };
    file.isExample = false;
    delete file.notice;
    await store.write("manual_trades.json", file);
    await syncTradeViews(file);
    response.json(file.trades[index]);
  }),
);

protectedApi.delete(
  "/manual-trades/:id",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const file = await store.read<ManualTradeFile>("manual_trades.json");
    const before = file.trades.length;
    file.trades = file.trades.filter((trade) => trade.id !== request.params.id);
    if (file.trades.length === before) {
      response.status(404).json({ error: "Trade not found." });
      return;
    }
    file.isExample = false;
    delete file.notice;
    await store.write("manual_trades.json", file);
    await syncTradeViews(file);
    await unlinkManualTrade(String(request.params.id));
    response.status(204).end();
  }),
);

protectedApi.post(
  "/manual-trades/:id/exits",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const file = await store.read<ManualTradeFile>("manual_trades.json");
    const trade = file.trades.find((item) => item.id === request.params.id);
    if (!trade) {
      response.status(404).json({ error: "Trade not found." });
      return;
    }
    const soldAlready = trade.exits.reduce(
      (sum, exit) => sum + exit.quantitySold,
      0,
    );
    const quantitySold = numberValue(
      request.body.quantitySold,
      "Quantity sold",
      0.000001,
    );
    if (quantitySold > trade.quantity - soldAlready + 0.000001) {
      throw new Error("Exit quantity exceeds the remaining open quantity.");
    }
    const exit: TradeExit = {
      id: randomUUID(),
      exitDate: stringValue(request.body.exitDate, "Exit date"),
      exitPrice: numberValue(request.body.exitPrice, "Exit price", 0.000001),
      quantitySold,
      fees: numberValue(request.body.fees ?? 0, "Fees"),
      reason: stringValue(request.body.reason, "Exit reason"),
      notes: stringValue(request.body.notes, "Notes", false),
    };
    trade.exits.push(exit);
    trade.updatedAt = new Date().toISOString();
    file.isExample = false;
    delete file.notice;
    await store.write("manual_trades.json", file);
    await syncTradeViews(file);
    response.status(201).json(exit);
  }),
);

protectedApi.delete(
  "/manual-trades/:tradeId/exits/:exitId",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const file = await store.read<ManualTradeFile>("manual_trades.json");
    const trade = file.trades.find((item) => item.id === request.params.tradeId);
    if (!trade) {
      response.status(404).json({ error: "Trade not found." });
      return;
    }
    const before = trade.exits.length;
    trade.exits = trade.exits.filter(
      (exit) => exit.id !== request.params.exitId,
    );
    if (trade.exits.length === before) {
      response.status(404).json({ error: "Exit not found." });
      return;
    }
    trade.updatedAt = new Date().toISOString();
    await store.write("manual_trades.json", file);
    await syncTradeViews(file);
    response.status(204).end();
  }),
);

protectedApi.post(
  "/wealth/snapshots",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const snapshot: WealthSnapshot = {
      id: randomUUID(),
      date: stringValue(request.body.date, "Date"),
      totalPortfolioValue: numberValue(
        request.body.totalPortfolioValue,
        "Total portfolio value",
      ),
      cashBalance: numberValue(request.body.cashBalance, "Cash balance"),
      investedValue: numberValue(request.body.investedValue, "Invested value"),
      notes: stringValue(request.body.notes, "Notes", false),
    };
    const file = await store.read<WealthSnapshotFile>("wealth_snapshots.json");
    file.isExample = false;
    delete file.notice;
    file.snapshots.push(snapshot);
    file.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    await store.write("wealth_snapshots.json", file);
    response.status(201).json(snapshot);
  }),
);

protectedApi.put(
  "/wealth/snapshots/:id",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const file = await store.read<WealthSnapshotFile>("wealth_snapshots.json");
    const index = file.snapshots.findIndex(
      (snapshot) => snapshot.id === request.params.id,
    );
    if (index < 0) {
      response.status(404).json({ error: "Snapshot not found." });
      return;
    }
    file.snapshots[index] = {
      id: file.snapshots[index].id,
      date: stringValue(request.body.date, "Date"),
      totalPortfolioValue: numberValue(
        request.body.totalPortfolioValue,
        "Total portfolio value",
      ),
      cashBalance: numberValue(request.body.cashBalance, "Cash balance"),
      investedValue: numberValue(request.body.investedValue, "Invested value"),
      notes: stringValue(request.body.notes, "Notes", false),
    };
    file.isExample = false;
    delete file.notice;
    file.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    await store.write("wealth_snapshots.json", file);
    response.json(file.snapshots[index]);
  }),
);

protectedApi.delete(
  "/wealth/snapshots/:id",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const file = await store.read<WealthSnapshotFile>("wealth_snapshots.json");
    file.snapshots = file.snapshots.filter(
      (snapshot) => snapshot.id !== request.params.id,
    );
    file.isExample = false;
    delete file.notice;
    await store.write("wealth_snapshots.json", file);
    response.status(204).end();
  }),
);

protectedApi.post(
  "/wealth/cash-flows",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const cashFlow: CashFlow = {
      id: randomUUID(),
      date: stringValue(request.body.date, "Date"),
      type: request.body.type === "withdrawal" ? "withdrawal" : "deposit",
      amount: numberValue(request.body.amount, "Amount", 0.000001),
      notes: stringValue(request.body.notes, "Notes", false),
    };
    const file = await store.read<CashFlowFile>("cash_flows.json");
    file.isExample = false;
    delete file.notice;
    file.cashFlows.push(cashFlow);
    file.cashFlows.sort((a, b) => a.date.localeCompare(b.date));
    await store.write("cash_flows.json", file);
    response.status(201).json(cashFlow);
  }),
);

protectedApi.put(
  "/wealth/cash-flows/:id",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const file = await store.read<CashFlowFile>("cash_flows.json");
    const index = file.cashFlows.findIndex(
      (cashFlow) => cashFlow.id === request.params.id,
    );
    if (index < 0) {
      response.status(404).json({ error: "Cash flow not found." });
      return;
    }
    file.cashFlows[index] = {
      id: file.cashFlows[index].id,
      date: stringValue(request.body.date, "Date"),
      type: request.body.type === "withdrawal" ? "withdrawal" : "deposit",
      amount: numberValue(request.body.amount, "Amount", 0.000001),
      notes: stringValue(request.body.notes, "Notes", false),
    };
    file.isExample = false;
    delete file.notice;
    file.cashFlows.sort((a, b) => a.date.localeCompare(b.date));
    await store.write("cash_flows.json", file);
    response.json(file.cashFlows[index]);
  }),
);

protectedApi.delete(
  "/wealth/cash-flows/:id",
  requireCsrf(sessionSecret),
  safeMutation(async (request, response) => {
    const file = await store.read<CashFlowFile>("cash_flows.json");
    file.cashFlows = file.cashFlows.filter(
      (cashFlow) => cashFlow.id !== request.params.id,
    );
    file.isExample = false;
    delete file.notice;
    await store.write("cash_flows.json", file);
    response.status(204).end();
  }),
);

app.use("/api", protectedApi);

const distPath = path.join(projectRoot, "dist");
app.use(
  express.static(distPath, {
    index: false,
    maxAge: secureCookies ? "1h" : 0,
    setHeaders(response, filePath) {
      if (filePath.endsWith(".html")) response.setHeader("Cache-Control", "no-store");
    },
  }),
);

app.use((request, response) => {
  if (request.method !== "GET") {
    response.status(404).end();
    return;
  }
  if (request.path === "/login") {
    response.sendFile(path.join(distPath, "index.html"));
    return;
  }
  if (!readSession(request, sessionSecret)) {
    response.redirect(302, "/login");
    return;
  }
  response.sendFile(path.join(distPath, "index.html"));
});

const notificationScheduler = new NotificationScheduler(
  notificationDispatcher,
  buildNotificationContext,
);
notificationScheduler.start();

app.listen(port, "0.0.0.0", () => {
  console.log(`Risky Investor private server listening on port ${port}.`);
});
