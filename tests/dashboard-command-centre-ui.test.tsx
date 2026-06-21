import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardCommandCentre } from "../src/components/DashboardCommandCentre";
import type {
  DashboardData,
  ManualTrade,
  MultiStrategyRecord,
  MultiStrategySnapshot,
  SignalEvent,
} from "../src/types";
import { buildActualTradeEquityModel } from "../src/utils/actualTradeEquity";
import { buildDashboardCommandCentreModel } from "../src/utils/dashboardCommandCentre";

Object.assign(globalThis, { React });

function strategy(
  strategyId: "daily-supertrend" | "nasdaq-sma200-3x",
  overrides: Partial<MultiStrategyRecord> = {},
): MultiStrategyRecord {
  const superTrend = strategyId === "daily-supertrend";
  return {
    strategyId,
    name: superTrend ? "Daily SuperTrend" : "Nasdaq SMA200 Regime — 3x",
    enabled: true,
    configured: true,
    status: "current",
    ruleSummary: "Scanner model output.",
    parameters: superTrend
      ? {
          watchlist: [
            {
              signalTicker: "ARM",
              executionTicker: "3ARM.L",
              enabled: true,
              allocationWeight: 1,
            },
            {
              signalTicker: "SMH",
              executionTicker: "3SMH.L",
              enabled: true,
              allocationWeight: 1,
            },
          ],
        }
      : {
          referenceTicker: "QQQ",
          riskOnTicker: "QQQ3.L",
        },
    currentState: superTrend ? "in_market" : "risk_on",
    modelValue: superTrend ? 12_450 : 10_880,
    returnPercent: superTrend ? 24.5 : 8.8,
    drawdownPercent: superTrend ? -3.2 : -1.4,
    exposurePercent: superTrend ? 45 : 100,
    equitySnapshots: [],
    virtualPositions: superTrend
      ? [
          {
            positionId: "daily-supertrend:arm",
            label: "Virtual model position",
            signalTicker: "ARM",
            executionTicker: "3ARM.L",
            state: "in",
            entryTimestamp: "2026-06-19T09:00:00.000Z",
            entryPrice: 100,
            latestPrice: 108,
            quantity: 10,
            allocation: 1250,
            openPnlValue: 80,
            openPnlPercent: 8,
            daysHeld: 2,
            latestSignal: "entry",
            reason: "SuperTrend flipped green.",
          },
        ]
      : [
          {
            positionId: "nasdaq-sma200-3x:qqq",
            label: "Virtual model position",
            signalTicker: "QQQ",
            executionTicker: "QQQ3.L",
            state: "risk_on",
            entryTimestamp: "2026-06-18T09:00:00.000Z",
            entryPrice: 50,
            latestPrice: 54,
            quantity: 100,
            allocation: 5000,
            openPnlValue: 400,
            openPnlPercent: 8,
            daysHeld: 3,
            latestSignal: "risk_on",
            reason: "Reference is 4.2% above SMA200.",
          },
        ],
    closedVirtualTrades: [],
    events: superTrend
      ? [
          {
            eventId: "daily-supertrend:arm-entry",
            strategyId,
            eventType: "entry",
            occurredAt: "2026-06-20T09:00:00.000Z",
            signalTicker: "ARM",
            executionTicker: "3ARM.L",
            reason: "SuperTrend flipped green.",
          },
          {
            eventId: "daily-supertrend:smh-exit",
            strategyId,
            eventType: "exit",
            occurredAt: "2026-06-19T09:00:00.000Z",
            signalTicker: "SMH",
            executionTicker: "3SMH.L",
            reason: "SuperTrend flipped red.",
          },
          {
            eventId: "daily-supertrend:old-error",
            strategyId,
            eventType: "scannerError",
            occurredAt: "2026-06-10T09:00:00.000Z",
            signalTicker: "SMH",
            executionTicker: "3SMH.L",
            reason: "Old provider failure.",
          },
        ]
      : [
          {
            eventId: "nasdaq-sma200-3x:risk-on",
            strategyId,
            eventType: "entry",
            occurredAt: "2026-06-18T09:00:00.000Z",
            signalTicker: "QQQ",
            executionTicker: "QQQ3.L",
            reason: "Reference is 4.2% above SMA200.",
          },
        ],
    regimeChangeEvents: undefined,
    latestEvent: superTrend
      ? null
      : {
          eventId: "nasdaq-sma200-3x:risk-on",
          strategyId,
          eventType: "entry",
          occurredAt: "2026-06-18T09:00:00.000Z",
          signalTicker: "QQQ",
          executionTicker: "QQQ3.L",
          reason: "Reference is 4.2% above SMA200.",
        },
    dataFreshness: "2026-06-21T00:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<MultiStrategySnapshot> = {}) {
  return {
    schemaVersion: "multi_strategy_v1",
    generatedAt: "2026-06-21T11:00:00.000Z",
    scanner: {
      name: "RiSKYiNVESTOR integrated scanner",
      version: "1.0.0",
      status: "current",
      errors: [],
      dataFreshness: {
        generatedAt: "2026-06-21T00:00:00.000Z",
        staleAfterMinutes: 5760,
      },
    },
    strategies: [strategy("daily-supertrend"), strategy("nasdaq-sma200-3x")],
    ...overrides,
  } satisfies MultiStrategySnapshot;
}

function signalEvent(overrides: Partial<SignalEvent>): SignalEvent {
  return {
    eventId: "event-entry",
    eventVersion: 1,
    occurredAt: "2026-06-20T09:00:00.000Z",
    receivedAt: "2026-06-20T09:01:00.000Z",
    strategyId: "daily-supertrend",
    strategyName: "Daily SuperTrend",
    source: "integrated_python_scanner",
    underlyingTicker: "ARM",
    underlyingName: "ARM",
    tradeTicker: "3ARM.L",
    tradeName: "3ARM.L",
    signalState: "actionable_entry",
    previousTrend: "red",
    currentTrend: "green",
    riskTier: "AGGRESSIVE",
    eligibility: "eligible",
    allocationStatus: "normal",
    allocationPercent: 10,
    reasonCode: "trend_changed",
    reasonText: "Fresh canonical entry.",
    scannerRunId: "run-2026-06-21",
    rawSourceReference: "scanner://run-2026-06-21/arm",
    isActionable: true,
    isAcknowledged: false,
    discordDeliveryEligible: true,
    createdAt: "2026-06-20T09:01:00.000Z",
    updatedAt: "2026-06-20T09:01:00.000Z",
    ...overrides,
  };
}

function manualTrade(overrides: Partial<ManualTrade> = {}): ManualTrade {
  return {
    id: "manual-arm",
    strategyName: "Daily SuperTrend",
    sleeve: "SuperTrend",
    assetName: "3ARM.L",
    ticker: "3ARM.L",
    direction: "long",
    riskTier: "CORE",
    assetClass: "Manual trade",
    isTechnology: false,
    isSingleStock: false,
    leverageMultiplier: 1,
    entryDate: "2026-06-18T10:00:00.000Z",
    entryPrice: 10,
    quantity: 10,
    amountInvested: 100,
    fees: 1,
    notes: "Manual ARM trade.",
    source: "manual",
    referenceLink: "",
    currentPrice: 12,
    journal: {
      entryReason: "Manual action.",
      followedSystem: false,
      overrodeSystem: false,
      emotionalState: "",
      checkedChart: false,
      lesson: "",
    },
    exits: [],
    createdAt: "2026-06-18T10:01:00.000Z",
    updatedAt: "2026-06-21T10:00:00.000Z",
    ...overrides,
  };
}

function dashboard(
  snapshotValue: MultiStrategySnapshot | null = snapshot(),
  overrides: Partial<DashboardData> = {},
): DashboardData {
  return {
    strategyMonitor: {
      source: snapshotValue ? "current" : "awaiting",
      currentFileValid: Boolean(snapshotValue),
      lastError: null,
      snapshot: snapshotValue,
    },
    scannerImport: {
      status: snapshotValue ? "current" : "awaiting",
      lastGeneratedAt: snapshotValue?.generatedAt ?? null,
      lastSuccessfulScanAt: snapshotValue?.generatedAt ?? null,
      lastImportedAt: snapshotValue?.generatedAt ?? null,
      staleAfterMinutes: 5760,
      scannerName: "RiSKYiNVESTOR integrated scanner",
      scannerRunId: "run-2026-06-21",
      summary: "Current scanner snapshot.",
      warningCount: 0,
      errorCount: 0,
      lastError: null,
      importedEvents: 3,
      duplicateEvents: 0,
      rejectedEvents: 0,
    },
    signalEvents: {
      version: 2,
      isExample: false,
      events: [
        signalEvent({}),
        signalEvent({
          eventId: "old-scanner-error",
          occurredAt: "2026-06-10T09:00:00.000Z",
          signalState: "scanner_error",
          reasonText: "Old provider failure.",
          isActionable: false,
        }),
      ],
    },
    notifications: {
      deliveries: [],
      settings: {},
      providers: {},
      retention: { retained: 0, maximum: 500 },
    },
    manualTrades: {
      isExample: false,
      trades: [
        manualTrade(),
        manualTrade({
          id: "manual-qqq-closed",
          strategyName: "Nasdaq SMA200",
          sleeve: "SMA200 Regime",
          assetName: "QQQ3.L",
          ticker: "QQQ3.L",
          entryDate: "2026-06-17T10:00:00.000Z",
          entryPrice: 50,
          quantity: 4,
          amountInvested: 200,
          fees: 2,
          currentPrice: 58,
          notes: "Manual QQQ3 trade.",
          exits: [
            {
              id: "exit-qqq",
              exitDate: "2026-06-20T11:00:00.000Z",
              exitPrice: 60,
              quantitySold: 4,
              fees: 1,
              reason: "Close trade",
              notes: "Closed QQQ3 trade.",
            },
          ],
        }),
      ],
    },
    ...overrides,
  } as DashboardData;
}

function render(data: DashboardData) {
  return renderToStaticMarkup(createElement(DashboardCommandCentre, { data }));
}

function actualTradePanelHtml(html: string) {
  const start = html.indexOf("actual-trade-equity-panel");
  const end = html.indexOf("</section>", start);
  return start >= 0 && end >= 0 ? html.slice(start, end) : "";
}

test("dashboard shows scanner current state", () => {
  const html = render(dashboard());

  assert.match(html, /Scanner health/);
  assert.match(html, /Current/);
  assert.match(html, /Market data freshness/);
  assert.match(html, /Active strategies/);
  assert.match(html, /2/);
});

test("dashboard typography layout still renders command-centre sections", () => {
  const html = render(dashboard());

  assert.match(html, /Action needed/);
  assert.match(html, /Current model positions/);
  assert.match(html, /Daily SuperTrend/);
  assert.match(html, /Nasdaq SMA200/);
  assert.match(html, /Recent signal history/);
});

test("action-needed section excludes old scannerError events when scanner is healthy", () => {
  const html = render(dashboard());

  assert.match(html, /Action needed/);
  assert.doesNotMatch(html, /Old provider failure/);
  assert.match(html, /Historical scanner error events are hidden/);
});

test("action-needed section includes recent entry, exit and risk events", () => {
  const model = buildDashboardCommandCentreModel(dashboard());

  assert.deepEqual(
    model.actionItems.map((item) => item.eventType),
    ["entry", "exit", "risk_on"],
  );
});

test("current model positions render across strategies", () => {
  const html = render(dashboard());

  assert.match(html, /Current model positions/);
  assert.match(html, /ARM/);
  assert.match(html, /3ARM\.L/);
  assert.match(html, /QQQ/);
  assert.match(html, /QQQ3\.L/);
});

test("SuperTrend summary counts render", () => {
  const html = render(dashboard());

  assert.match(html, /Daily SuperTrend/);
  assert.match(html, /Total ticker pairs/);
  assert.match(html, /In-market \/ green/);
  assert.match(html, /Out-of-market \/ red/);
  assert.match(html, /Changed this week/);
});

test("SMA200 summary renders", () => {
  const html = render(dashboard());

  assert.match(html, /Nasdaq SMA200/);
  assert.match(html, /risk on/);
  assert.match(html, /Reference ticker/);
  assert.match(html, /QQQ3\.L/);
  assert.match(html, /4\.2% above SMA200/);
});

test("actual trade equity chart renders when manual trade data exists", () => {
  const html = render(dashboard());

  assert.match(html, /Actual trade equity/);
  assert.match(html, /Actual trade equity chart/);
  assert.match(html, /Based only on trades you manually recorded/);
  assert.match(html, /This is not broker-synced/);
  assert.match(html, /Total invested/);
  assert.match(html, /Realised P\/L/);
  assert.match(html, /Unrealised P\/L/);
});

test("actual trade equity empty state renders when no manual trades exist", () => {
  const html = render(
    dashboard(snapshot(), {
      manualTrades: { isExample: false, trades: [] },
    } as Partial<DashboardData>),
  );

  assert.match(html, /No manual trades recorded yet/);
  assert.match(
    html,
    /Record trades in Trade Journal to build your actual equity curve/,
  );
});

test("realised P/L is calculated from closed trades", () => {
  const model = buildActualTradeEquityModel([
    manualTrade({
      entryPrice: 50,
      quantity: 4,
      amountInvested: 200,
      fees: 2,
      currentPrice: 58,
      exits: [
        {
          id: "exit-1",
          exitDate: "2026-06-20T11:00:00.000Z",
          exitPrice: 60,
          quantitySold: 4,
          fees: 1,
          reason: "Close trade",
          notes: "",
        },
      ],
    }),
  ]);

  assert.equal(model.realisedPnl, 37);
  assert.equal(model.closedTrades, 1);
  assert.equal(model.points.at(-1)?.realisedPnl, 37);
});

test("open trade unrealised P/L is included only when current price is available", () => {
  const withPrice = buildActualTradeEquityModel([
    manualTrade({ entryPrice: 10, quantity: 10, amountInvested: 100, fees: 1, currentPrice: 12 }),
  ]);
  const withoutPrice = buildActualTradeEquityModel([
    manualTrade({
      entryPrice: 10,
      quantity: 10,
      amountInvested: 100,
      fees: 1,
      currentPrice: undefined as unknown as number,
    }),
  ]);

  assert.equal(withPrice.unrealisedPnl, 19);
  assert.equal(withPrice.totalPnl, 19);
  assert.equal(withPrice.hasUnrealisedEstimate, true);
  assert.equal(withoutPrice.unrealisedPnl, null);
  assert.equal(withoutPrice.totalPnl, 0);
  assert.equal(withoutPrice.hasUnrealisedEstimate, false);
});

test("scanner model data is not used as actual trade equity", () => {
  const noTrades = buildActualTradeEquityModel([]);
  const hugeScannerModel = dashboard(snapshot({
    strategies: [
      strategy("daily-supertrend", { modelValue: 999_999 }),
      strategy("nasdaq-sma200-3x", { modelValue: 888_888 }),
    ],
  }), {
    manualTrades: { isExample: false, trades: [] },
  } as Partial<DashboardData>);
  const html = render(hugeScannerModel);
  const actualPanel = actualTradePanelHtml(html);

  assert.equal(noTrades.hasTrades, false);
  assert.equal(noTrades.totalPnl, 0);
  assert.match(actualPanel, /No manual trades recorded yet/);
  assert.doesNotMatch(actualPanel, /999,999/);
  assert.doesNotMatch(actualPanel, /888,888/);
});

test("scanner error state still displays when scanner is actually in error", () => {
  const errorSnapshot = snapshot({
    scanner: {
      name: "RiSKYiNVESTOR integrated scanner",
      version: "1.0.0",
      status: "error",
      errors: [{ message: "Current provider failure." }],
      dataFreshness: {
        generatedAt: "2026-06-21T00:00:00.000Z",
        staleAfterMinutes: 5760,
      },
    },
  });
  const html = render(
    dashboard(errorSnapshot, {
      scannerImport: {
        status: "error",
        lastGeneratedAt: "2026-06-21T11:00:00.000Z",
        lastSuccessfulScanAt: "2026-06-21T11:00:00.000Z",
        lastImportedAt: "2026-06-21T11:00:00.000Z",
        staleAfterMinutes: 5760,
        scannerName: "RiSKYiNVESTOR integrated scanner",
        scannerRunId: "run-2026-06-21",
        summary: "Scanner failed.",
        warningCount: 0,
        errorCount: 1,
        lastError: "Current provider failure.",
        importedEvents: 0,
        duplicateEvents: 0,
        rejectedEvents: 0,
      },
    } as Partial<DashboardData>),
  );

  assert.match(html, /Error/);
  assert.match(html, /Current provider failure/);
  assert.match(html, /Old provider failure/);
});
