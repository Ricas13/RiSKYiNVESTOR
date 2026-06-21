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
  applySignalActionOption,
  buildClosedTradeRows,
  buildManualExitPayload,
  buildManualTradePayload,
  buildOpenTradeRows,
  buildSignalActionOptions,
  emptySimpleTradeForm,
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
    notes: "Bought after the ARM entry signal.",
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

function mainFormHtml(html: string) {
  const start = html.indexOf("<form");
  const end = html.indexOf("</form>", start);
  return html.slice(start, end + "</form>".length);
}

test("main form renders only the simple trade fields by default", () => {
  const form = mainFormHtml(render());

  assert.match(form, /Record trade/);
  assert.match(
    form,
    /This only records what you did manually\. It does not place a broker order\./,
  );
  assert.match(form, /Strategy/);
  assert.match(form, /Ticker/);
  assert.match(form, /Action/);
  assert.match(form, /Buy \/ Open long/);
  assert.match(form, /Sell \/ Close long/);
  assert.match(form, /Trade date/);
  assert.match(form, /Quantity/);
  assert.match(form, /Price/);
  assert.match(form, /Total cost/);
  assert.match(form, /Fees/);
  assert.match(form, /Notes/);
  assert.doesNotMatch(form, /Signal ticker/);
  assert.doesNotMatch(form, /Execution ticker/);
  assert.doesNotMatch(form, /Amount invested/);
});

test("main form does not show legacy accounting fields by default", () => {
  const form = mainFormHtml(render([trade()]));

  assert.doesNotMatch(form, /Risk tier/);
  assert.doesNotMatch(form, /Asset class/);
  assert.doesNotMatch(form, /Technology exposure/);
  assert.doesNotMatch(form, /Single-stock exposure/);
  assert.doesNotMatch(form, /Leverage multiplier/);
  assert.doesNotMatch(form, /Emotion journal/);
  assert.doesNotMatch(form, /Followed the system/);
  assert.doesNotMatch(form, /Overrode the system/);
  assert.doesNotMatch(form, /Checked the chart/);
  assert.doesNotMatch(form, /Lesson/);
});

test("strategy dropdown always includes the three supported strategies", () => {
  const form = mainFormHtml(render());

  assert.match(form, /Daily SuperTrend/);
  assert.match(form, /Nasdaq SMA200/);
  assert.match(form, /Manual \/ Discretionary/);
});

test("user can create a simple open trade payload", () => {
  const form = {
    ...emptySimpleTradeForm(),
    strategySource: "Nasdaq SMA200" as const,
    ticker: "qqq3.l",
    tradeDate: "2026-06-21T10:30",
    quantity: "10",
    price: "479",
    totalCost: "4790",
    fees: "3",
    notes: "Opened after SMA200 risk-on signal.",
  };

  const payload = buildManualTradePayload(form);

  assert.equal(payload.strategyName, "Nasdaq SMA200");
  assert.equal(payload.sleeve, "SMA200 Regime");
  assert.equal(payload.assetName, "QQQ3.L");
  assert.equal(payload.ticker, "QQQ3.L");
  assert.equal(payload.entryDate, "2026-06-21T10:30");
  assert.equal(payload.quantity, 10);
  assert.equal(payload.entryPrice, 479);
  assert.equal(payload.amountInvested, 4790);
  assert.equal(payload.fees, 3);
  assert.equal(payload.source, "manual");
});

test("open trade appears in Open trades table", () => {
  const html = render([trade()]);
  const rows = buildOpenTradeRows([trade()]);

  assert.equal(rows.length, 1);
  assert.match(html, /Open trades/);
  assert.match(html, /3ARM\.L/);
  assert.match(html, /Bought after the ARM entry signal/);
  assert.match(html, /Close trade/);
});

test("user can close a trade", () => {
  const form = {
    ...emptySimpleTradeForm(),
    action: "close" as const,
    ticker: "3ARM.L",
    tradeDate: "2026-06-22T11:00",
    quantity: "100",
    price: "12",
    totalCost: "1200",
    fees: "1",
    notes: "Closed after exit signal.",
  };

  const payload = buildManualExitPayload(form, 100);

  assert.equal(payload.exitDate, "2026-06-22T11:00");
  assert.equal(payload.exitPrice, 12);
  assert.equal(payload.quantitySold, 100);
  assert.equal(payload.fees, 1);
  assert.equal(payload.reason, "Close trade");
  assert.equal(payload.notes, "Closed after exit signal.");
});

test("closed trade appears in Closed trades table", () => {
  const item = trade({
    exits: [
      {
        id: "exit-1",
        exitDate: "2026-06-22T11:00",
        exitPrice: 12,
        quantitySold: 100,
        fees: 1,
        reason: "Close trade",
        notes: "Closed after exit signal.",
      },
    ],
  });
  const rows = buildClosedTradeRows([item]);
  const html = render([item]);

  assert.equal(rows.length, 1);
  assert.match(html, /Closed trades/);
  assert.match(html, /3ARM\.L/);
  assert.match(html, /Closed after exit signal/);
  assert.match(html, /Total P\/L/);
});

test("old legacy trade data is preserved while rendering the simple workflow", () => {
  const legacy = trade();

  buildOpenTradeRows([legacy]);

  assert.equal(legacy.riskTier, "SPECULATIVE");
  assert.equal(legacy.assetClass, "Thematic ETF");
  assert.equal(legacy.isTechnology, true);
  assert.equal(legacy.isSingleStock, true);
  assert.equal(legacy.leverageMultiplier, 3);
  assert.equal(legacy.journal?.emotionalState, "Confident");
});

test("scanner prefill fills strategy, ticker, action and notes only", () => {
  const options = buildSignalActionOptions(monitor());
  const position = options.find(
    (option) =>
      option.label === "Open model position · Daily SuperTrend · 3ARM.L",
  );
  const exit = options.find(
    (option) => option.label === "Recent exit · Daily SuperTrend · 3SMH.L",
  );

  assert.ok(position);
  assert.ok(exit);

  const original = {
    ...emptySimpleTradeForm(),
    tradeDate: "2026-06-21T10:30",
    quantity: "10",
    price: "479",
    totalCost: "4790",
  };
  const updated = applySignalActionOption(original, exit);

  assert.equal(updated.strategySource, "Daily SuperTrend");
  assert.equal(updated.ticker, "3SMH.L");
  assert.equal(updated.action, "close");
  assert.equal(updated.notes, "SuperTrend flipped red.");
  assert.equal(updated.tradeDate, "2026-06-21T10:30");
  assert.equal(updated.quantity, "10");
  assert.equal(updated.price, "479");
  assert.equal(updated.totalCost, "4790");
});
