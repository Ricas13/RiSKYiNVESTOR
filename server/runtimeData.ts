import type { NotificationSettings } from "./notifications.js";
import { JsonStore } from "./store.js";

type AccountRole = "owner" | "user" | "admin";

export const awaitingScannerState = {
  version: 1,
  isExample: false,
  status: "awaiting",
  lastGeneratedAt: null,
  lastSuccessfulScanAt: null,
  lastImportedAt: null,
  staleAfterMinutes: 180,
  scannerName: null,
  scannerRunId: null,
  summary: "Awaiting scanner data",
  warningCount: 0,
  errorCount: 0,
  lastError: null,
  importedEvents: 0,
  duplicateEvents: 0,
  rejectedEvents: 0,
  watchlist: [],
} as const;

export const disabledNotificationSettings: NotificationSettings = {
  version: 2,
  isExample: false,
  discord: { enabled: false },
  whatsapp: { enabled: false, provider: "stub" },
  migration: {
    legacyScannerDiscordEnabled: false,
    canonicalDashboardDiscordEnabled: false,
    legacyServerDiscordAlongsideManaged: false,
  },
  signalAlerts: {
    entry: false,
    exit: false,
    lowLiquidity: false,
    scannerError: false,
    watchlistOnly: false,
    dailySummary: false,
    weeklySummary: false,
  },
  strategyPolicies: {
    "daily-supertrend": {
      entry: [],
      exit: [],
      lowLiquidity: [],
      stateUpdate: [],
      dailySummary: [],
      weeklySummary: [],
      scannerError: [],
    },
    "nasdaq-sma200-3x": {
      entry: [],
      exit: [],
      lowLiquidity: [],
      stateUpdate: [],
      dailySummary: [],
      weeklySummary: [],
      scannerError: [],
    },
  },
  routes: {
    dailySummary: {
      enabled: false,
      destinationId: null,
      minimumSeverity: "warning",
    },
    supertrendSignals: {
      enabled: false,
      destinationId: null,
      minimumSeverity: "warning",
    },
    sma200Signals: {
      enabled: false,
      destinationId: null,
      minimumSeverity: "warning",
    },
    scannerErrors: {
      enabled: false,
      destinationId: null,
      minimumSeverity: "error",
    },
    modelWarnings: {
      enabled: false,
      destinationId: null,
      minimumSeverity: "warning",
    },
    deliveryFailures: {
      enabled: false,
      destinationId: null,
      minimumSeverity: "error",
    },
    manualTrades: {
      enabled: false,
      destinationId: null,
      minimumSeverity: "warning",
    },
  },
  dailySummary: {
    enabled: false,
    time: "21:15",
    timezone: "Europe/London",
    sendStaleSummaries: false,
    lastSentDate: null,
    metrics: {
      actualPortfolioValue: true,
      modelPortfolioValue: true,
      actualPL: true,
      modelPL: true,
      realisedPL: true,
      unrealisedPL: true,
      contributionsWithdrawals: true,
      drawdown: true,
      cashInvested: true,
      latestActionableSignal: true,
      scannerFreshness: true,
    },
  },
  weeklySummary: {
    enabled: false,
    automaticDeliveryEnabled: false,
    dayOfWeek: 5,
    time: "18:00",
    timezone: "Europe/London",
  },
  thresholds: {
    minimumAbsoluteDailyPL: 0,
    minimumDailyPLPercent: 0,
    lowLiquidityOnlyWhenActionable: true,
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
    timezone: "Europe/London",
  },
  retention: { maximumDeliveries: 1_000 },
};

export const emptyModelSummary = {
  strategyName: "Awaiting scanner data",
  lastScan: "",
  greenTickers: 0,
  redTickers: 0,
  entrySignalsToday: 0,
  exitSignalsToday: 0,
  openModelTrades: 0,
  realisedModelPL: 0,
  dataStatus: "Awaiting scanner data",
};

export const emptyModelPerformance = {
  realisedModelPL: 0,
  averageClosedTrade: 0,
  medianClosedTrade: 0,
  winRate: 0,
  closedTrades: 0,
  fixedStakeEquivalent: 0,
  realisedSeries: [],
  yearlyPL: [],
  winLoss: [
    { name: "Wins", value: 0 },
    { name: "Losses", value: 0 },
  ],
  openTradePL: [],
};

export const emptySiteConfig = {
  site: {
    name: "Risky Investor",
    domain: "",
    mode: "private",
    defaultTheme: "dark",
  },
  strategy: {
    name: "Awaiting scanner configuration",
    timeframe: "Daily",
    atrLength: 0,
    entryRule: "No scanner strategy configuration is available.",
    exitRule: "No scanner strategy configuration is available.",
    directionConvention: "No scanner direction convention is available.",
    ignoredRegimes: [],
  },
  riskTiers: {
    CORE: {
      allocation: "Not configured",
      status: "Awaiting scanner configuration.",
    },
    AGGRESSIVE: {
      allocation: "Not configured",
      status: "Awaiting scanner configuration.",
    },
    SPECULATIVE: {
      allocation: "0% allocation",
      status: "Watchlist only when scanner configuration is available.",
    },
    EXCLUDED: {
      allocation: "0% allocation",
      status: "Excluded until scanner configuration is available.",
    },
  },
  channels: {
    entryAlerts: "",
    exitAlerts: "",
    takeProfitAlerts: "",
  },
  display: {
    showFixedStakeEquivalent: false,
    currency: "GBP",
    compactTablesOnMobile: true,
  },
  backtests: {
    baseline: {
      title: "No backtest data available",
      startingCapital: 0,
      finalEquity: 0,
      totalReturn: 0,
      cagr: 0,
      maxDrawdown: 0,
      closedTrades: 0,
      skippedSignals: 0,
      averageTrade: 0,
      medianTrade: 0,
      winRate: 0,
    },
    secondaryTests: [],
  },
};

function runtimeDefaults(username: string, role: AccountRole) {
  return [
    [
      "manual_trades.json",
      {
        isExample: false,
        notice: "No manual trades recorded.",
        trades: [],
      },
    ],
    [
      "open_positions.json",
      {
        isExample: false,
        generatedAt: null,
        positions: [],
      },
    ],
    [
      "closed_trades.json",
      {
        isExample: false,
        generatedAt: null,
        trades: [],
      },
    ],
    [
      "wealth_snapshots.json",
      {
        isExample: false,
        notice: "No wealth snapshots recorded.",
        snapshots: [],
      },
    ],
    [
      "cash_flows.json",
      {
        isExample: false,
        notice: "No cash flows recorded.",
        cashFlows: [],
      },
    ],
    [
      "account.json",
      {
        isExample: false,
        account: {
          id: "owner-account",
          username,
          displayName: username,
          role,
          currency: "GBP",
          createdAt: new Date().toISOString(),
        },
      },
    ],
    [
      "strategies.json",
      {
        isExample: false,
        notice: "No strategies configured.",
        strategies: [],
      },
    ],
    [
      "settings.json",
      {
        isExample: false,
        assumedMissedStake: 0,
        riskLimits: {
          maxTickerPct: 100,
          maxTechnologyPct: 100,
          maxSpeculativePct: 100,
          maxLeveraged3xPct: 100,
          minimumCashPct: 0,
          elevatedDrawdownPct: 100,
        },
      },
    ],
    ["signal_events.json", []],
    ["daily_portfolio_snapshots.json", []],
    ["audit_log.json", []],
    ["scanner_import_state.json", awaitingScannerState],
    ["notification_settings.json", disabledNotificationSettings],
    [
      "discord_destinations.json",
      {
        version: 1,
        destinations: [],
      },
    ],
    [
      "signal_decisions.json",
      {
        isExample: false,
        notice: "No signal decisions recorded.",
        decisions: [],
      },
    ],
    [
      "alerts.json",
      {
        isExample: false,
        notice: "No alerts recorded.",
        alerts: [],
      },
    ],
    ["model/latest_summary.json", emptyModelSummary],
    ["model/watchlist_status.json", []],
    ["model/signals_today.json", []],
    ["model/signals_archive.json", []],
    ["model/open_trades.json", []],
    ["model/closed_trades.json", { trades: [] }],
    ["model/performance.json", emptyModelPerformance],
    ["model/site_config.json", emptySiteConfig],
  ] as const;
}

export async function initialiseRuntimeData(
  store: JsonStore,
  account: { username: string; role: AccountRole },
) {
  const defaults = runtimeDefaults(account.username, account.role);
  const existing = await Promise.all(
    defaults.map(([relativePath]) => store.readOptional(relativePath)),
  );
  const existingAlertDeliveries =
    await store.readOptional<unknown>("alert_deliveries.json");
  const legacyNotificationDeliveries =
    existingAlertDeliveries === null
      ? await store.readOptional<unknown>("notification_deliveries.json")
      : null;

  for (const [index, [relativePath, initialValue]] of defaults.entries()) {
    if (existing[index] === null) {
      await store.ensure(relativePath, initialValue);
    }
  }
  if (existingAlertDeliveries === null) {
    await store.ensure(
      "alert_deliveries.json",
      legacyNotificationDeliveries ?? [],
    );
  }
}
