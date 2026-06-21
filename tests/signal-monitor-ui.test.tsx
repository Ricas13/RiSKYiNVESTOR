import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScannerSignalMonitor } from "../src/components/ScannerSignalMonitor";
import type {
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

test("Signal Monitor renders Daily SuperTrend ticker pairs from scanner output", () => {
  const html = render(monitor(snapshot()));

  assert.match(html, /Ticker-pair signal table/);
  assert.match(html, /SPY/);
  assert.match(html, /3USL\.L/);
  assert.match(html, /VT/);
  assert.match(html, /3VT\.L/);
  assert.match(html, /Daily SuperTrend/);
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
