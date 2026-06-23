import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScannerSignalMonitor } from "../src/components/ScannerSignalMonitor";
import { StrategyTickerChart } from "../src/components/StrategyTickerChart";
import { expandableRows } from "../src/utils/expandableRows";
import type {
  ManualTrade,
  MultiStrategyPublicState,
  MultiStrategyRecord,
  MultiStrategySnapshot,
} from "../src/types";
import { buildSignalMonitorModel } from "../src/utils/signalMonitorRows";

Object.assign(globalThis, { React });

function strategy(
  strategyId: "daily-supertrend" | "nasdaq-sma200-3x",
  overrides: Partial<MultiStrategyRecord> = {},
): MultiStrategyRecord {
  const isSuperTrend = strategyId === "daily-supertrend";
  return {
    strategyId,
    name: isSuperTrend ? "Daily SuperTrend" : "Nasdaq SMA200 Regime — 3x",
    enabled: true,
    configured: true,
    status: "current",
    ruleSummary: "Scanner model output.",
    parameters: isSuperTrend
      ? {
          watchlist: [
            {
              signalTicker: "SPY",
              executionTicker: "3USL.L",
              enabled: true,
              allocationWeight: 1,
            },
            {
              signalTicker: "VT",
              executionTicker: "3VT.L",
              enabled: true,
              allocationWeight: 1,
            },
          ],
        }
      : {
          referenceTicker: "QQQ",
          riskOnTicker: "QQQ3.L",
          watchlist: [
            {
              signalTicker: "QQQ",
              executionTicker: "QQQ3.L",
              enabled: true,
              allocationWeight: 1,
            },
            {
              signalTicker: "NVDA",
              executionTicker: "3NVD.L",
              enabled: true,
              allocationWeight: 1,
            },
          ],
        },
    currentState: isSuperTrend ? "in_market" : "risk_on",
    modelValue: 10_500,
    returnPercent: 5,
    drawdownPercent: -1,
    exposurePercent: 50,
    equitySnapshots: [],
    virtualPositions: isSuperTrend
      ? [
          {
            positionId: "daily-supertrend:spy",
            label: "Virtual model position",
            signalTicker: "SPY",
            executionTicker: "3USL.L",
            state: "in",
            entryTimestamp: "2026-06-19",
            entryPrice: 100,
            latestPrice: 104,
            quantity: 10,
            allocation: 1000,
            openPnlValue: 40,
            openPnlPercent: 4,
            daysHeld: 2,
            latestSignal: "entry",
            reason: "SuperTrend changed from out to in.",
          },
        ]
      : [
          {
            positionId: "nasdaq-sma200-3x:current",
            label: "Virtual model position",
            signalTicker: "QQQ",
            executionTicker: "QQQ3.L",
            state: "risk_on",
            entryTimestamp: "2026-06-18",
            entryPrice: 50,
            latestPrice: 52,
            quantity: 100,
            allocation: 5000,
            openPnlValue: 200,
            openPnlPercent: 4,
            daysHeld: 3,
            latestSignal: "risk_on",
            reason: "Reference is above SMA200.",
          },
        ],
    closedVirtualTrades: [],
    events: isSuperTrend
      ? [
          {
            eventId: "daily-supertrend:spy-entry",
            strategyId,
            eventType: "entry",
            occurredAt: "2026-06-20T09:00:00.000Z",
            signalTicker: "SPY",
            executionTicker: "3USL.L",
            reason: "SuperTrend changed from out to in.",
          },
          {
            eventId: "daily-supertrend:vt-exit",
            strategyId,
            eventType: "exit",
            occurredAt: "2026-06-10T09:00:00.000Z",
            signalTicker: "VT",
            executionTicker: "3VT.L",
            reason: "SuperTrend changed from in to out.",
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
            reason: "Reference closed above SMA200.",
          },
          {
            eventId: "nasdaq-sma200-3x:nvda-risk-off",
            strategyId,
            eventType: "exit",
            occurredAt: "2026-06-19T09:00:00.000Z",
            signalTicker: "NVDA",
            executionTicker: "3NVD.L",
            reason: "NVDA closed below SMA200.",
          },
        ],
    regimeChangeEvents: undefined,
    latestEvent: isSuperTrend
      ? null
      : {
          eventId: "nasdaq-sma200-3x:risk-on",
          strategyId,
          eventType: "entry",
          occurredAt: "2026-06-18T09:00:00.000Z",
          signalTicker: "QQQ",
          executionTicker: "QQQ3.L",
          reason: "Reference closed above SMA200.",
        },
    dataFreshness: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<MultiStrategySnapshot> = {}) {
  return {
    schemaVersion: "multi_strategy_v1",
    generatedAt: "2026-06-21T10:00:00.000Z",
    scanner: {
      name: "RiSKYiNVESTOR integrated scanner",
      version: "1.0.0",
      status: "current",
      errors: [],
      dataFreshness: {
        generatedAt: "2026-06-21T10:00:00.000Z",
        staleAfterMinutes: 5760,
      },
    },
    strategies: [strategy("daily-supertrend"), strategy("nasdaq-sma200-3x")],
    ...overrides,
  } satisfies MultiStrategySnapshot;
}

function monitor(
  snapshotValue: MultiStrategySnapshot | null,
  overrides: Partial<MultiStrategyPublicState> = {},
): MultiStrategyPublicState {
  return {
    source: snapshotValue ? "current" : "awaiting",
    currentFileValid: Boolean(snapshotValue),
    lastError: null,
    snapshot: snapshotValue,
    ...overrides,
  };
}

function render(monitorValue: MultiStrategyPublicState) {
  return renderToStaticMarkup(
    createElement(ScannerSignalMonitor, { monitor: monitorValue }),
  );
}

const performanceWarning = {
  severity: "warning" as const,
  code: "extreme_open_pnl",
  message:
    "Performance warning: this model result may be distorted by leveraged ETP price history or currency units.",
  affectedTickers: ["SPY", "3USL.L"],
  metric: "openPnlPercent",
  value: 1200,
  threshold: 500,
};

test("Signal Monitor renders Daily SuperTrend ticker pairs from scanner output", () => {
  const html = render(monitor(snapshot()));

  assert.match(html, /Ticker-pair signal table/);
  assert.match(html, /SPY/);
  assert.match(html, /3USL\.L/);
  assert.match(html, /VT/);
  assert.match(html, /3VT\.L/);
  assert.match(html, /Daily SuperTrend/);
});

test("Signal Monitor exposes execution ticker chart drilldown controls", () => {
  const html = renderToStaticMarkup(
    createElement(ScannerSignalMonitor, {
      monitor: monitor(snapshot()),
      onOpenTicker: () => undefined,
    }),
  );

  assert.match(html, /ticker-chart-link/);
  assert.match(html, />3USL\.L</);
  assert.match(html, />QQQ3\.L</);
});

test("expandable row helper shows all rows at ten or fewer and bounds longer lists", () => {
  const tenRows = Array.from({ length: 10 }, (_, index) => index);
  const twelveRows = Array.from({ length: 12 }, (_, index) => index);
  const manyRows = Array.from({ length: 75 }, (_, index) => index);

  assert.deepEqual(expandableRows(tenRows, false), {
    hasOverflow: false,
    totalRows: 10,
    visibleCount: 10,
    visibleRows: tenRows,
  });
  assert.deepEqual(expandableRows(twelveRows, false).visibleRows, tenRows);
  assert.equal(expandableRows(twelveRows, false).visibleCount, 10);
  assert.equal(expandableRows(twelveRows, true).visibleCount, 12);
  assert.equal(
    expandableRows(manyRows, true, { expandedLimit: 50 }).visibleCount,
    50,
  );
});

test("Signal Monitor ticker-pair table is bounded by default when over ten rows", () => {
  const watchlist = Array.from({ length: 12 }, (_, index) => ({
    signalTicker: `SIG${String(index + 1).padStart(2, "0")}`,
    executionTicker: `EXE${String(index + 1).padStart(2, "0")}.L`,
    enabled: true,
    allocationWeight: 1,
  }));
  const html = render(
    monitor(
      snapshot({
        strategies: [
          strategy("daily-supertrend", {
            parameters: { watchlist },
            virtualPositions: [],
            events: [],
          }),
          strategy("nasdaq-sma200-3x"),
        ],
      }),
    ),
  );

  assert.match(html, /Showing 10 of 12/);
  assert.match(html, /Show all/);
  assert.match(html, /SIG01/);
  assert.match(html, /SIG10/);
  assert.doesNotMatch(html, /SIG11/);
  assert.doesNotMatch(html, /SIG12/);
});

test("Signal Monitor ticker-pair table shows ten rows without expand controls", () => {
  const watchlist = Array.from({ length: 10 }, (_, index) => ({
    signalTicker: `TEN${String(index + 1).padStart(2, "0")}`,
    executionTicker: `TEN${String(index + 1).padStart(2, "0")}.L`,
    enabled: true,
    allocationWeight: 1,
  }));
  const html = render(
    monitor(
      snapshot({
        strategies: [
          strategy("daily-supertrend", {
            parameters: { watchlist },
            virtualPositions: [],
            events: [],
          }),
          strategy("nasdaq-sma200-3x"),
        ],
      }),
    ),
  );

  assert.doesNotMatch(html, /Showing 10 of 10/);
  assert.match(html, /TEN10/);
});

test("Signal Monitor displays performance warnings without breaking signal state", () => {
  const warned = snapshot({
    scanner: {
      ...snapshot().scanner,
      warnings: [{ ...performanceWarning, strategyId: "daily-supertrend" }],
    },
    strategies: [
      strategy("daily-supertrend", { warnings: [performanceWarning] }),
      strategy("nasdaq-sma200-3x"),
    ],
  });
  const html = render(monitor(warned));

  assert.match(html, /Performance warning/);
  assert.match(html, /Signal state may still be valid/);
  assert.match(html, /Ticker-pair signal table/);
  assert.match(html, /In market \/ green/);
});

test("Signal Monitor matches open positions to ticker pairs", () => {
  const model = buildSignalMonitorModel(snapshot());
  const spy = model.rows.find((row) => row.signalTicker === "SPY");
  const vt = model.rows.find((row) => row.signalTicker === "VT");

  assert.equal(spy?.statusLabel, "In market / green");
  assert.equal(spy?.modelPosition, "open");
  assert.equal(spy?.openPnlValue, 40);
  assert.equal(spy?.daysHeld, 2);
  assert.equal(vt?.statusLabel, "Out of market / red");
  assert.equal(vt?.modelPosition, "none");
});

test("Signal Monitor changed-this-week logic uses scanner generated week", () => {
  const model = buildSignalMonitorModel(snapshot());

  assert.deepEqual(
    model.rows.map((row) => [row.signalTicker, row.changedThisWeek]),
    [
      ["SPY", true],
      ["VT", false],
    ],
  );
});

test("Signal Monitor displays scanner error state without inventing rows", () => {
  const errorSnapshot = snapshot({
    scanner: {
      name: "RiSKYiNVESTOR integrated scanner",
      version: "1.0.0",
      status: "error",
      errors: [{ message: "Provider failed safely." }],
      dataFreshness: {
        generatedAt: "2026-06-21T10:00:00.000Z",
        staleAfterMinutes: 5760,
      },
    },
  });
  const html = render(monitor(errorSnapshot));

  assert.match(html, /Scanner status is error/);
  assert.match(html, /SPY/);
  assert.match(html, /VT/);
});

test("Signal Monitor displays empty state when no ticker pairs exist", () => {
  const empty = snapshot({
    strategies: [
      strategy("daily-supertrend", {
        parameters: { watchlist: [] },
        virtualPositions: [],
        events: [],
      }),
      strategy("nasdaq-sma200-3x"),
    ],
  });
  const html = render(monitor(empty));

  assert.match(html, /No Daily SuperTrend ticker pairs/);
  assert.match(html, /Settings → Strategy Configuration/);
});

test("Signal Monitor renders SMA200 ticker-pair book rows", () => {
  const html = render(monitor(snapshot()));

  assert.match(html, /Nasdaq SMA200 ticker-pair book/);
  assert.match(html, /Reference ticker/);
  assert.match(html, /Signal ticker/);
  assert.match(html, /QQQ/);
  assert.match(html, /QQQ3\.L/);
  assert.match(html, /NVDA/);
  assert.match(html, /3NVD\.L/);
  assert.match(html, /NVDA closed below SMA200/);
  assert.match(html, /risk on/);
});

test("strategy ticker chart renders bounded candle data and signal-date markers", () => {
  const candles = Array.from({ length: 300 }, (_, index) => ({
    date: `2026-06-${String((index % 28) + 1).padStart(2, "0")}`,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1_000_000,
  }));
  const monitorValue = monitor(
    snapshot({
      strategies: [
        strategy("daily-supertrend", {
          chartData: [{ executionTicker: "3USL.L", candles }],
          events: [
            {
              eventId: "daily-supertrend:chart-entry",
              strategyId: "daily-supertrend",
              eventType: "entry",
              occurredAt: "2026-06-22T09:00:00.000Z",
              signalDate: "2026-06-18",
              generatedAt: "2026-06-22T09:00:00.000Z",
              signalTicker: "SPY",
              executionTicker: "3USL.L",
              calculationTicker: "SPY",
              price: 117,
              reason: "SuperTrend BUY on signal ticker.",
            },
            {
              eventId: "daily-supertrend:chart-exit",
              strategyId: "daily-supertrend",
              eventType: "exit",
              occurredAt: "2026-06-22T09:00:00.000Z",
              signalDate: "2026-06-20",
              generatedAt: "2026-06-22T09:00:00.000Z",
              signalTicker: "SPY",
              executionTicker: "3USL.L",
              calculationTicker: "3USL.L",
              price: 119,
              reason: "SuperTrend SELL on execution ticker.",
            },
          ],
        }),
        strategy("nasdaq-sma200-3x", {
          chartData: [{ executionTicker: "3USL.L", candles }],
          events: [
            {
              eventId: "nasdaq-sma200-3x:chart-entry",
              strategyId: "nasdaq-sma200-3x",
              eventType: "entry",
              occurredAt: "2026-06-22T09:00:00.000Z",
              signalDate: "2026-06-19",
              generatedAt: "2026-06-22T09:00:00.000Z",
              signalTicker: "SPY",
              executionTicker: "3USL.L",
              calculationTicker: "SPY",
              price: 118,
              reason: "SMA200 risk on.",
            },
          ],
        }),
      ],
    }),
  );
  const manualTrades: ManualTrade[] = [
    {
      id: "manual-1",
      strategyName: "Manual / Discretionary",
      assetName: "3USL.L",
      ticker: "3USL.L",
      direction: "long",
      entryDate: "2026-06-18",
      entryPrice: 117,
      quantity: 2,
      amountInvested: 234,
      fees: 1,
      notes: "Manual action.",
      source: "manual",
      referenceLink: "",
      currentPrice: 119,
      exits: [
        {
          id: "exit-1",
          exitDate: "2026-06-20",
          exitPrice: 119,
          quantitySold: 2,
          fees: 1,
          reason: "Closed manually.",
          notes: "",
        },
      ],
      createdAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-20T09:00:00.000Z",
    },
  ];
  const html = renderToStaticMarkup(
    createElement(StrategyTickerChart, {
      ticker: "3USL.L",
      monitor: monitorValue,
      manualTrades,
      onClose: () => undefined,
    }),
  );

  assert.match(html, /3USL\.L strategy chart/);
  assert.match(html, /data-candle-count="250"/);
  assert.match(html, /SuperTrend entry/);
  assert.match(html, /SuperTrend exit/);
  assert.match(html, /SMA200 entry/);
  assert.match(html, /Manual buy/);
  assert.match(html, /Manual sell/);
  assert.match(html, /Calculated on: SPY/);
  assert.match(html, /Calculated on: 3USL\.L/);
  assert.match(html, /18 Jun 2026/);
});

test("strategy ticker chart shows empty state without candle data", () => {
  const html = renderToStaticMarkup(
    createElement(StrategyTickerChart, {
      ticker: "MISSING.L",
      monitor: monitor(snapshot()),
      manualTrades: [],
      onClose: () => undefined,
    }),
  );

  assert.match(html, /No chart data available for this ticker yet/);
  assert.match(html, /No strategy markers available for this ticker yet/);
});
