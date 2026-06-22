import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StrategyMonitor } from "../src/components/StrategyMonitor";
import type {
  MultiStrategyRecord,
  MultiStrategySnapshot,
} from "../src/types";

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
    ruleSummary: isSuperTrend
      ? "Daily SuperTrend ticker-pair model."
      : "SMA200 regime model.",
    parameters: isSuperTrend
      ? {
          watchlist: [
            {
              signalTicker: "ARM",
              executionTicker: "3ARM.L",
              enabled: true,
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
    modelValue: isSuperTrend ? 12_345 : 10_750,
    returnPercent: isSuperTrend ? 23.45 : 7.5,
    drawdownPercent: isSuperTrend ? -4.2 : -1.25,
    exposurePercent: isSuperTrend ? 55 : 100,
    cash: isSuperTrend ? 4_000 : 0,
    investedValue: isSuperTrend ? 8_345 : 10_750,
    referenceTicker: isSuperTrend ? undefined : "QQQ",
    executionTicker: isSuperTrend ? undefined : "QQQ3.L",
    regimeStartDate: isSuperTrend ? undefined : "2026-06-17",
    equitySnapshots: [
      { date: "2026-06-18", value: isSuperTrend ? 10_000 : 10_000 },
      { date: "2026-06-19", value: isSuperTrend ? 11_250 : 10_300 },
      { date: "2026-06-20", value: isSuperTrend ? 12_345 : 10_750 },
    ],
    virtualPositions: [
      {
        positionId: `${strategyId}:open`,
        label: "Virtual model position",
        signalTicker: isSuperTrend ? "ARM" : "QQQ",
        executionTicker: isSuperTrend ? "3ARM.L" : "QQQ3.L",
        state: isSuperTrend ? "in" : "risk_on",
        entryTimestamp: "2026-06-18T09:00:00.000Z",
        entryPrice: isSuperTrend ? 100 : 50,
        latestPrice: isSuperTrend ? 112 : 54,
        quantity: 10,
        allocation: isSuperTrend ? 1_000 : 5_000,
        openPnlValue: isSuperTrend ? 120 : 400,
        openPnlPercent: isSuperTrend ? 12 : 8,
        daysHeld: 2,
        latestSignal: isSuperTrend ? "entry" : "risk_on",
        reason: isSuperTrend
          ? "SuperTrend flipped green."
          : "Reference is above SMA200.",
      },
    ],
    closedVirtualTrades: [
      {
        positionId: `${strategyId}:closed`,
        executionTicker: isSuperTrend ? "3SMH.L" : "QQQ3.L",
        entryTimestamp: "2026-06-01",
        entryPrice: isSuperTrend ? 80 : 45,
        exitTimestamp: "2026-06-10",
        exitPrice: isSuperTrend ? 88 : 48,
        pnlValue: isSuperTrend ? 80 : 300,
        pnlPercent: isSuperTrend ? 10 : 6.67,
        exitReason: isSuperTrend ? "SuperTrend exit." : "Risk-off exit.",
      },
    ],
    events: [
      {
        eventId: `${strategyId}:entry`,
        strategyId,
        eventType: "entry",
        occurredAt: "2026-06-18T09:00:00.000Z",
        signalTicker: isSuperTrend ? "ARM" : "QQQ",
        executionTicker: isSuperTrend ? "3ARM.L" : "QQQ3.L",
        reason: isSuperTrend
          ? "SuperTrend flipped green."
          : "Reference is above SMA200.",
      },
    ],
    latestEvent: {
      eventId: `${strategyId}:entry`,
      strategyId,
      eventType: "entry",
      occurredAt: "2026-06-18T09:00:00.000Z",
      signalTicker: isSuperTrend ? "ARM" : "QQQ",
      executionTicker: isSuperTrend ? "3ARM.L" : "QQQ3.L",
      reason: isSuperTrend
        ? "SuperTrend flipped green."
        : "Reference is above SMA200.",
    },
    dataFreshness: "2026-06-21T00:00:00.000Z",
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<MultiStrategySnapshot> = {},
): MultiStrategySnapshot {
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
  };
}

function renderPerformance(snapshotValue: MultiStrategySnapshot | null = snapshot()) {
  return renderToStaticMarkup(
    createElement(StrategyMonitor, {
      monitor: {
        source: snapshotValue ? "current" : "awaiting",
        currentFileValid: Boolean(snapshotValue),
        lastError: snapshotValue ? null : "No scanner file found.",
        snapshot: snapshotValue,
      },
      showHeading: false,
    }),
  );
}

const performanceWarning = {
  severity: "warning" as const,
  code: "extreme_open_pnl",
  message:
    "Performance warning: this model result may be distorted by leveraged ETP price history or currency units.",
  affectedTickers: ["ARM", "3ARM.L"],
  metric: "openPnlPercent",
  value: 1200,
  threshold: 500,
};

test("strategy performance page renders with compact layout classes", () => {
  const source = readFileSync(
    new URL("../src/components/TradingControlPages.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /control-page-stack control-room-page strategy-performance-page/,
  );
  assert.match(source, /Model and actual signal performance/);
  assert.match(source, /Model performance is based on scanner virtual trades/);
});

test("strategy performance reads current scanner multi_strategy_v1 data", () => {
  const html = renderPerformance();

  assert.match(html, /Daily SuperTrend/);
  assert.match(html, /Nasdaq SMA200 Regime/);
  assert.match(html, /Virtual model value/);
  assert.match(html, /£12,345/);
  assert.match(html, /Model return/);
  assert.match(html, /23\.45%/);
  assert.match(html, /Model drawdown/);
  assert.match(html, /-4\.20%/);
  assert.match(html, /Virtual exposure/);
});

test("strategy performance shows SMA200 model stats and current regime", () => {
  const html = renderPerformance();

  assert.match(html, /Nasdaq SMA200 Regime/);
  assert.match(html, /risk on/);
  assert.match(html, /QQQ3\.L/);
  assert.match(html, /SMA200 signal\/reference mappings/);
  assert.match(html, /NVDA/);
  assert.match(html, /3NVD\.L/);
  assert.match(html, /Reference is above SMA200/);
  assert.match(html, /£10,750/);
});

test("strategy performance renders equity chart and collapses closed virtual trades", () => {
  const html = renderPerformance();

  assert.match(html, /Independent equity curve/);
  assert.match(html, /strategy-monitor__chart/);
  assert.match(html, /Closed virtual trades/);
  assert.match(html, /Show latest 20 closed trades/);
  assert.doesNotMatch(html, /3SMH\.L/);
  assert.match(html, /QQQ3\.L/);
});

test("strategy performance displays model warnings without hiding signal state", () => {
  const warned = strategy("daily-supertrend", {
    warnings: [performanceWarning],
    virtualPositions: [
      {
        ...strategy("daily-supertrend").virtualPositions[0],
        openPnlPercent: 1200,
        warnings: [performanceWarning],
      },
    ],
  });
  const html = renderPerformance(
    snapshot({
      strategies: [warned, strategy("nasdaq-sma200-3x")],
    }),
  );

  assert.match(html, /Model performance needs review/);
  assert.match(html, /Signal state may still be valid/);
  assert.match(html, /ARM → 3ARM\.L/);
  assert.match(html, /extreme_open_pnl/);
  assert.match(html, /Daily SuperTrend/);
});

test("strategy performance no longer shows misleading empty state when scanner data exists", () => {
  const html = renderPerformance();

  assert.doesNotMatch(html, /No model performance data imported/);
  assert.doesNotMatch(html, /Connect a canonical scanner export/);
});

test("strategy performance explains scanner unavailability when no scanner snapshot exists", () => {
  const html = renderPerformance(null);

  assert.match(html, /Awaiting first valid scanner snapshot/);
  assert.match(html, /multi_strategy_v1 snapshot/);
  assert.doesNotMatch(html, /No model performance data imported/);
});
