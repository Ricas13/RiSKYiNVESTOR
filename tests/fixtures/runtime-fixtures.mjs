import {
  awaitingScannerState,
  disabledNotificationSettings,
  emptySiteConfig,
  initialiseRuntimeData,
} from "../../dist-server/runtimeData.js";
import { JsonStore } from "../../dist-server/store.js";

const timestamp = "2026-06-17T21:35:00.000Z";

function demoTrade() {
  return {
    id: "example-trade-qqq3",
    isExample: true,
    strategyName: "Baseline Adaptive SuperTrend",
    assetName: "Nasdaq 100 3x",
    ticker: "QQQ3.L",
    direction: "long",
    riskTier: "CORE",
    assetClass: "US Index",
    isTechnology: true,
    isSingleStock: false,
    leverageMultiplier: 3,
    entryDate: "2026-02-10",
    entryPrice: 100,
    quantity: 10,
    amountInvested: 1000,
    fees: 0,
    notes: "Deterministic demo trade.",
    source: "manual",
    referenceLink: "",
    currentPrice: 110,
    journal: {
      entryReason: "Deterministic fixture.",
      followedSystem: true,
      overrodeSystem: false,
      emotionalState: "Neutral",
      checkedChart: true,
      lesson: "Fixture only.",
    },
    exits: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function archivedSignal(id, ticker) {
  return {
    id,
    strategyName: "Baseline Adaptive SuperTrend",
    title: `${ticker} deterministic signal`,
    assetName: ticker,
    signalType: "ENTRY",
    previousTrendState: "Red",
    newTrendState: "Green",
    underlyingTicker: ticker,
    tradeTicker: `${ticker}3.L`,
    signalDate: "2026-06-17",
    suggestedAction: "Review fixture signal",
    riskTier: "CORE",
    suggestedAllocation: "Normal allocation",
    liquidityWarning: null,
    referenceClose: 100,
    currency: "GBP",
    superTrendValue: 95,
    modelExitDate: null,
    modelExitPrice: null,
  };
}

export async function seedDemoRuntimeData(
  root,
  account = { username: "fixture-owner", role: "owner" },
) {
  const store = new JsonStore(root);
  await initialiseRuntimeData(store, account);

  const trade = demoTrade();
  const archive = [
    archivedSignal("sig-20260115-ark", "ARKK"),
    archivedSignal("sig-20260220-meta", "META"),
    archivedSignal("sig-20260210-qqq", "QQQ"),
    archivedSignal("sig-20260305-gold", "GLD"),
    archivedSignal("sig-20260617-smh", "SMH"),
  ];
  const demoSettings = {
    ...disabledNotificationSettings,
    isExample: true,
  };

  await Promise.all([
    store.write("manual_trades.json", {
      isExample: true,
      notice: "Deterministic demo records for tests.",
      trades: [trade],
    }),
    store.write("open_positions.json", {
      isExample: true,
      generatedAt: timestamp,
      positions: [trade],
    }),
    store.write("closed_trades.json", {
      isExample: true,
      generatedAt: timestamp,
      trades: [],
    }),
    store.write("wealth_snapshots.json", {
      isExample: true,
      notice: "Deterministic demo records for tests.",
      snapshots: [
        {
          id: "example-snapshot-1",
          date: "2026-06-17",
          totalPortfolioValue: 2500,
          cashBalance: 500,
          investedValue: 2000,
          notes: "Deterministic demo snapshot.",
        },
      ],
    }),
    store.write("cash_flows.json", {
      isExample: true,
      notice: "Deterministic demo records for tests.",
      cashFlows: [
        {
          id: "example-flow-1",
          date: "2026-06-01",
          type: "deposit",
          amount: 2000,
          notes: "Deterministic demo deposit.",
        },
      ],
    }),
    store.write("account.json", {
      isExample: true,
      account: {
        id: "example-account",
        username: account.username,
        displayName: account.username,
        role: account.role,
        currency: "GBP",
        createdAt: timestamp,
      },
    }),
    store.write("strategies.json", {
      isExample: true,
      notice: "Deterministic demo strategies for tests.",
      strategies: [
        {
          id: "baseline-supertrend",
          name: "Baseline Adaptive SuperTrend",
          status: "active",
          timeframe: "Daily",
          description: "Deterministic primary strategy.",
          historicalQuality: 82,
          defaultAssumedStake: 1000,
        },
        {
          id: "uk-nasdaq-sma200",
          name: "UK Nasdaq SMA200",
          status: "tracking",
          timeframe: "Daily",
          description: "Deterministic integration strategy.",
          historicalQuality: 72,
          defaultAssumedStake: 1000,
        },
      ],
    }),
    store.write("settings.json", {
      isExample: true,
      assumedMissedStake: 1000,
      riskLimits: {
        maxTickerPct: 25,
        maxTechnologyPct: 60,
        maxSpeculativePct: 10,
        maxLeveraged3xPct: 35,
        minimumCashPct: 10,
        elevatedDrawdownPct: 12,
      },
    }),
    store.write("signal_events.json", {
      version: 2,
      isExample: true,
      notice: "Deterministic empty canonical event fixture.",
      events: [],
    }),
    store.write("daily_portfolio_snapshots.json", {
      version: 1,
      isExample: true,
      snapshots: [],
    }),
    store.write("scanner_import_state.json", awaitingScannerState),
    store.write("notification_settings.json", demoSettings),
    store.write("alert_deliveries.json", {
      version: 2,
      isExample: true,
      deliveries: [],
    }),
    store.write("signal_decisions.json", {
      isExample: true,
      notice: "Deterministic demo decisions for tests.",
      decisions: [
        {
          signalId: "sig-20260617-smh",
          status: "Skipped",
          manualTradeId: null,
          notes: "Deterministic fixture decision.",
          assumedStake: 1000,
          updatedAt: timestamp,
        },
      ],
    }),
    store.write("alerts.json", {
      isExample: true,
      notice: "Deterministic demo alerts for tests.",
      alerts: [
        {
          id: "alert-smh-entry",
          strategyName: "Baseline Adaptive SuperTrend",
          alertType: "ENTRY",
          createdAt: timestamp,
          ticker: "3SMH.L",
          message: "Deterministic fixture alert.",
          signalId: "sig-20260617-smh",
          manualTradeId: null,
          status: "unread",
        },
      ],
    }),
    store.write("model/latest_summary.json", {
      isExample: true,
      strategyName: "Baseline Adaptive SuperTrend",
      lastScan: timestamp,
      greenTickers: 1,
      redTickers: 1,
      entrySignalsToday: 1,
      exitSignalsToday: 0,
      openModelTrades: 1,
      realisedModelPL: 148.6,
      dataStatus: "Demo fixture",
    }),
    store.write("model/watchlist_status.json", [
      {
        id: "nasdaq-100",
        assetName: "Nasdaq 100",
        entryTicker: "QQQ",
        tradeTicker: "QQQ3.L",
        currentTrend: "Green",
        riskTier: "CORE",
        liquidityStatus: "High",
      },
    ]),
    store.write("model/signals_today.json", [
      archivedSignal("sig-20260617-smh", "SMH"),
    ]),
    store.write("model/signals_archive.json", archive),
    store.write("model/open_trades.json", [
      {
        id: "open-qqq3",
        ticker: "QQQ3.L",
        strategyName: "Baseline Adaptive SuperTrend",
        entryDate: "2026-02-10",
        entryPrice: 100,
        currentPrice: 110,
        quantity: 10,
      },
    ]),
    store.write("model/closed_trades.json", {
      isExample: true,
      trades: [
        {
          id: "closed-001",
          ticker: "3GLD.L",
          strategyName: "Baseline Adaptive SuperTrend",
          entryDate: "2026-01-01",
          exitDate: "2026-02-01",
          entryPrice: 90,
          exitPrice: 100,
          quantity: 2,
          profit: 20,
        },
      ],
    }),
    store.write("model/performance.json", {
      isExample: true,
      realisedModelPL: 148.6,
      averageClosedTrade: 12.9,
      medianClosedTrade: 7.6,
      winRate: 62.5,
      closedTrades: 24,
      fixedStakeEquivalent: 2486,
      realisedSeries: [{ date: "Jun 26", value: 148.6 }],
      yearlyPL: [{ year: "2026", value: 148.6 }],
      winLoss: [
        { name: "Wins", value: 15 },
        { name: "Losses", value: 9 },
      ],
      openTradePL: [{ ticker: "QQQ3.L", value: 10 }],
    }),
    store.write("model/site_config.json", {
      ...emptySiteConfig,
      isExample: true,
      backtests: {
        baseline: {
          ...emptySiteConfig.backtests.baseline,
          title: "Deterministic demo backtest",
          startingCapital: 20000,
          finalEquity: 216897,
          totalReturn: 984.48,
          closedTrades: 134,
        },
        secondaryTests: [],
      },
    }),
  ]);

  return store;
}
