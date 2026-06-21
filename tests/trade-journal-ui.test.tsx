import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualTrades } from "../src/components/ManualTrades";
import type {
  ManualTrade,
  MultiStrategyPublicState,
  MultiStrategyRecord,
  MultiStrategySnapshot,
} from "../src/types";
import {
  buildJournalActionRows,
  buildManualTradePayload,
  buildSignalActionOptions,
  emptySignalActionForm,
} from "../src/utils/tradeJournalSignalActions";

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
    modelValue: 10_500,
    returnPercent: 5,
    drawdownPercent: -1,
    exposurePercent: 50,
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
            allocation: 1000,
            openPnlValue: 80,
            openPnlPercent: 8,
            daysHeld: 2,
            latestSignal: "entry",
            reason: "SuperTrend flipped green.",
          },
        ]
      : [],
    closedVirtualTrades: [],
    events: superTrend
      ? [
          {
            eventId: "daily-supertrend:smh-exit",
            strategyId,
            eventType: "exit",
            occurredAt: "2026-06-20T09:00:00.000Z",
            signalTicker: "SMH",
            executionTicker: "3SMH.L",
            reason: "SuperTrend flipped red.",
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
          reason: "Reference closed above SMA200.",
        },
    dataFreshness: "2026-06-21T00:00:00.000Z",
    ...overrides,
  };
}

function monitor(): MultiStrategyPublicState {
  const snapshot: MultiStrategySnapshot = {
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
  };

  return {
    source: "current",
    currentFileValid: true,
    lastError: null,
    snapshot,
  };
}

function trade(overrides: Partial<ManualTrade> = {}): ManualTrade {
  return {
    id: "manual-1",
    strategyName: "Daily SuperTrend",
    sleeve: "SuperTrend",
    assetName: "ARM",
    ticker: "3ARM.L",
    direction: "long",
    riskTier: "SPECULATIVE",
    assetClass: "Thematic ETF",
    isTechnology: true,
    isSingleStock: true,
    leverageMultiplier: 3,
    entryDate: "2026-06-20T10:30",
    entryPrice: 10,
    quantity: 100,
    amountInvested: 1000,
    fees: 5,
    notes: "Acted on the ARM entry signal.",
    source: "manual",
    referenceLink: "https://example.com/chart",
    currentPrice: 11,
    journal: {
      entryReason: "Signal flipped green.",
      followedSystem: true,
      overrodeSystem: false,
      emotionalState: "Confident",
      checkedChart: true,
      lesson: "Keep it simple.",
    },
    exits: [],
    createdAt: "2026-06-20T10:31:00.000Z",
    updatedAt: "2026-06-20T10:31:00.000Z",
    ...overrides,
  };
}

function render(trades: ManualTrade[] = []) {
  return renderToStaticMarkup(
    createElement(ManualTrades, {
      trades,
      strategyMonitor: monitor(),
      isExample: false,
      mutate: async () => ({}),
    }),
  );
}

test("simplified trade form renders as a signal action form", () => {
  const html = render();

  assert.match(html, /Record signal action/);
  assert.match(html, /I acted on this signal/);
  assert.match(html, /This does not place a broker trade/);
  assert.match(html, /Strategy source/);
  assert.match(html, /Signal ticker/);
  assert.match(html, /Execution ticker/);
  assert.match(html, /Buy \/ Enter/);
  assert.match(html, /Sell \/ Exit/);
});

test("current scanner ticker pairs can be used in the form if available", () => {
  const options = buildSignalActionOptions(monitor());

  assert.ok(
    options.some(
      (option) =>
        option.label === "Current pair · Daily SuperTrend · ARM → 3ARM.L",
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.label === "Open model position · Daily SuperTrend · ARM → 3ARM.L",
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.label === "Recent exit · Daily SuperTrend · SMH → 3SMH.L",
    ),
  );
  assert.ok(
    options.some(
      (option) =>
        option.label === "Current pair · Nasdaq SMA200 · QQQ → QQQ3.L",
    ),
  );
});

test("user can create a signal action trade payload with custom ticker input", () => {
  const form = {
    ...emptySignalActionForm(),
    strategySource: "Manual / Discretionary" as const,
    signalTicker: "custom",
    executionTicker: "custom3.l",
    price: "10",
    amountInvested: "1000",
    quantity: "",
    fees: "2",
    notes: "Custom manual action.",
  };

  const payload = buildManualTradePayload(form);

  assert.equal(payload.strategyName, "Manual / Discretionary");
  assert.equal(payload.assetName, "CUSTOM");
  assert.equal(payload.ticker, "CUSTOM3.L");
  assert.equal(payload.quantity, 100);
  assert.equal(payload.amountInvested, 1000);
  assert.equal(payload.journal.entryReason, "Custom manual action.");
});

test("old existing trade fields and data are preserved in advanced details", () => {
  const html = render([trade()]);

  assert.match(html, /Advanced details/);
  assert.match(html, /Risk tier/);
  assert.match(html, /SPECULATIVE/);
  assert.match(html, /Asset class/);
  assert.match(html, /Thematic ETF/);
  assert.match(html, /Technology exposure/);
  assert.match(html, /Single-stock exposure/);
  assert.match(html, /Leverage multiplier/);
  assert.match(html, /Emotion journal/);
  assert.match(html, /Confident/);
});

test("journal table renders signal actions correctly", () => {
  const item = trade({
    exits: [
      {
        id: "exit-1",
        exitDate: "2026-06-21T10:30",
        exitPrice: 12,
        quantitySold: 40,
        fees: 1,
        reason: "Exit signal",
        notes: "Sold after red signal.",
      },
    ],
  });
  const rows = buildJournalActionRows([item]);
  const html = render([item]);

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.actionLabel),
    ["Sell / Exit", "Buy / Enter"],
  );
  assert.match(html, /Manual action log/);
  assert.match(html, /Daily SuperTrend/);
  assert.match(html, /ARM/);
  assert.match(html, /3ARM\.L/);
  assert.match(html, /Buy \/ Enter/);
  assert.match(html, /Sell \/ Exit/);
  assert.match(html, /Acted on the ARM entry signal/);
  assert.match(html, /Sold after red signal/);
});
