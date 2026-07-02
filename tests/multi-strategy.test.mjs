import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MultiStrategyService,
  selectStrategyEventImportCandidates,
  trimMultiStrategyPublicState,
  validateMultiStrategySnapshot,
} from "../dist-server/multiStrategy.js";
import {
  defaultStrategyConfiguration,
  StrategyConfigurationRepository,
  strategyConfigurationPresets,
  strategyConfigurationResources,
  strategyTickerCatalogue,
  validateStrategyConfiguration,
} from "../dist-server/strategyConfig.js";
import { JsonStore } from "../dist-server/store.js";

function strategy(strategyId, overrides = {}) {
  const isSuperTrend = strategyId === "daily-supertrend";
  return {
    strategyId,
    name: isSuperTrend
      ? "Daily SuperTrend"
      : "Nasdaq SMA200 Regime — 3x",
    enabled: true,
    configured: true,
    status: "current",
    ruleSummary: "Independent virtual model rules.",
    parameters: isSuperTrend ? { atrPeriod: 10 } : { smaLength: 200 },
    currentState: isSuperTrend ? "in_market" : "risk_on",
    modelValue: 10_200,
    returnPercent: 2,
    drawdownPercent: -1,
    exposurePercent: 100,
    equitySnapshots: [{ date: "2026-06-20", value: 10_200 }],
    virtualPositions: [
      {
        positionId: `${strategyId}:position`,
        label: "Virtual model position",
        signalTicker: isSuperTrend ? "SPY.US" : "QQQ.US",
        executionTicker: isSuperTrend ? "3USL.UK" : "QQQ3.UK",
        state: isSuperTrend ? "in" : "risk_on",
        entryTimestamp: "2026-06-19",
        entryPrice: 100,
        latestPrice: 102,
        quantity: 100,
        allocation: 10_000,
        openPnlValue: 200,
        openPnlPercent: 2,
        daysHeld: 1,
        latestSignal: "entry",
        reason: "Independent strategy transition.",
      },
    ],
    closedVirtualTrades: [],
    events: [
      {
        eventId: `${strategyId}:entry:1`,
        strategyId,
        eventType: "entry",
        occurredAt: "2026-06-19T00:00:00.000Z",
        signalTicker: isSuperTrend ? "SPY.US" : "QQQ.US",
        executionTicker: isSuperTrend ? "3USL.UK" : "QQQ3.UK",
        reason: "Independent strategy transition.",
      },
    ],
    latestEvent: {
      eventId: `${strategyId}:entry:1`,
      strategyId,
      eventType: "entry",
      occurredAt: "2026-06-19T00:00:00.000Z",
      signalTicker: isSuperTrend ? "SPY.US" : "QQQ.US",
      executionTicker: isSuperTrend ? "3USL.UK" : "QQQ3.UK",
      reason: "Independent strategy transition.",
    },
    dataFreshness: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function snapshot() {
  return {
    schemaVersion: "multi_strategy_v1",
    generatedAt: "2026-06-20T08:00:00.000Z",
    scanner: {
      name: "RiSKYiNVESTOR integrated scanner",
      version: "1.0.0",
      status: "current",
      errors: [],
      dataFreshness: {
        generatedAt: "2026-06-20T00:00:00.000Z",
        staleAfterMinutes: 5760,
      },
    },
    strategies: [
      strategy("daily-supertrend"),
      strategy("nasdaq-sma200-3x", {
        cash: 0,
        investedValue: 10_200,
        regimeStartDate: "2026-06-19",
        referenceTicker: "QQQ.US",
        executionTicker: "QQQ3.UK",
      }),
    ],
  };
}

test("strategy configuration is strict, disabled by default, and written atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-strategy-config-"));
  try {
    assert.equal(defaultStrategyConfiguration.strategies.dailySuperTrend.enabled, false);
    assert.equal(defaultStrategyConfiguration.strategies.dailySuperTrend.atrLength, 20);
    assert.equal(defaultStrategyConfiguration.strategies.dailySuperTrend.atrPeriod, 20);
    assert.equal(defaultStrategyConfiguration.strategies.dailySuperTrend.smoothing, "RMA");
    assert.equal(defaultStrategyConfiguration.strategies.dailySuperTrend.switchStoploss, false);
    assert.equal(defaultStrategyConfiguration.strategies.dailySuperTrend.referenceTimeframe, "D");
    assert.equal(defaultStrategyConfiguration.strategies.dailySuperTrend.useConfirmed, true);
    assert.equal(defaultStrategyConfiguration.strategies.nasdaqSma200.enabled, false);
    assert.deepEqual(
      defaultStrategyConfiguration.strategies.dailySuperTrend.watchlist,
      [],
    );
    assert.deepEqual(
      defaultStrategyConfiguration.strategies.nasdaqSma200.watchlist,
      [],
    );

    const invalid = structuredClone(defaultStrategyConfiguration);
    invalid.strategies.dailySuperTrend.enabled = true;
    assert.throws(
      () => validateStrategyConfiguration(invalid),
      /enabled watchlist row/i,
    );
    const privateProvider = structuredClone(defaultStrategyConfiguration);
    privateProvider.marketData.urlTemplate =
      "https://127.0.0.1/{ticker}.csv";
    assert.throws(
      () => validateStrategyConfiguration(privateProvider),
      /public host/i,
    );

    const valid = structuredClone(defaultStrategyConfiguration);
    valid.strategies.dailySuperTrend.watchlist.push({
      signalTicker: "SPY.US",
      executionTicker: "3USL.UK",
      enabled: true,
      allocationWeight: 1,
    });
    valid.strategies.dailySuperTrend.enabled = true;
    const repository = new StrategyConfigurationRepository(root);
    await repository.update(valid);
    const saved = await repository.read();
    assert.deepEqual(validateStrategyConfiguration(saved), validateStrategyConfiguration(valid));
    assert.ok(saved.resources);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, "strategy_config_v1.json"), "utf8")),
      validateStrategyConfiguration(valid),
    );
    assert.equal(
      (await readdir(root)).some((entry) => entry.endsWith(".tmp")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strategy presets and ticker catalogue are safe editable templates", () => {
  const resources = strategyConfigurationResources();
  assert.equal(resources.presets.length, 2);
  assert.ok(resources.tickerCatalogue.length >= 5);
  assert.notEqual(resources.presets, strategyConfigurationPresets);
  assert.notEqual(resources.tickerCatalogue, strategyTickerCatalogue);

  const nasdaqPreset = resources.presets.find(
    (preset) => preset.presetId === "nasdaq-sma-regime-3x",
  );
  assert.ok(nasdaqPreset);
  assert.equal(nasdaqPreset.strategy, "nasdaqSma200");
  assert.equal(
    nasdaqPreset.configuration.strategies.nasdaqSma200.enabled,
    false,
  );
  assert.equal(
    nasdaqPreset.configuration.strategies.nasdaqSma200.riskOffMode,
    "cash",
  );
  assert.ok(
    nasdaqPreset.configuration.strategies.nasdaqSma200.watchlist.every(
      (row) => row.enabled === false,
    ),
  );
  assert.equal(
    validateStrategyConfiguration(nasdaqPreset.configuration).strategies
      .nasdaqSma200.enabled,
    false,
  );

  const superTrendPreset = resources.presets.find(
    (preset) => preset.presetId === "daily-supertrend-watchlist-template",
  );
  assert.ok(superTrendPreset);
  assert.equal(superTrendPreset.strategy, "dailySuperTrend");
  assert.equal(
    superTrendPreset.configuration.strategies.dailySuperTrend.enabled,
    false,
  );
  assert.equal(
    superTrendPreset.configuration.strategies.dailySuperTrend.atrLength,
    20,
  );
  assert.equal(
    superTrendPreset.configuration.strategies.dailySuperTrend.smoothing,
    "RMA",
  );
  assert.equal(
    superTrendPreset.configuration.strategies.dailySuperTrend.switchStoploss,
    false,
  );
  assert.ok(
    superTrendPreset.configuration.strategies.dailySuperTrend.watchlist.every(
      (row) => row.enabled === false,
    ),
  );
  assert.deepEqual(
    validateStrategyConfiguration(superTrendPreset.configuration).strategies
      .dailySuperTrend.watchlist.map((row) => row.enabled),
    superTrendPreset.configuration.strategies.dailySuperTrend.watchlist.map(
      () => false,
    ),
  );

  const categories = new Set(
    resources.tickerCatalogue.map((entry) => entry.category),
  );
  for (const category of [
    "Nasdaq reference",
    "UK leveraged Nasdaq",
    "UK broad equity ETF",
    "UK bond/cash-like/risk-off",
    "Other watchlist",
  ]) {
    assert.ok(categories.has(category), `Missing category ${category}`);
  }

  const custom = structuredClone(defaultStrategyConfiguration);
  custom.strategies.dailySuperTrend.watchlist.push({
    signalTicker: "CUSTOM.L",
    executionTicker: "CUSTOMEXEC.L",
    enabled: true,
    allocationWeight: 1,
  });
  custom.strategies.dailySuperTrend.enabled = true;
  assert.equal(
    validateStrategyConfiguration(custom).strategies.dailySuperTrend.watchlist[0]
      .signalTicker,
    "CUSTOM.L",
  );

  const selected = resources.tickerCatalogue.find(
    (entry) => entry.category === "UK leveraged Nasdaq" && entry.enabled,
  );
  assert.ok(selected);
  const dropdownSelected = structuredClone(defaultStrategyConfiguration);
  dropdownSelected.strategies.nasdaqSma200.enabled = true;
  dropdownSelected.strategies.nasdaqSma200.referenceTicker = "QQQ.US";
  dropdownSelected.strategies.nasdaqSma200.riskOnTicker =
    selected.marketDataSymbol;
  assert.equal(
    validateStrategyConfiguration(dropdownSelected).strategies.nasdaqSma200
      .riskOnTicker,
    selected.marketDataSymbol,
  );

  const smaBook = structuredClone(defaultStrategyConfiguration);
  smaBook.strategies.nasdaqSma200.enabled = true;
  smaBook.strategies.nasdaqSma200.watchlist.push(
    {
      signalTicker: "QQQ.US",
      executionTicker: "QQQ3.UK",
      enabled: true,
      allocationWeight: 1,
    },
    {
      signalTicker: "NVDA.US",
      executionTicker: "3NVD.UK",
      enabled: true,
      allocationWeight: 5,
    },
  );
  const validatedSmaBook = validateStrategyConfiguration(smaBook);
  assert.equal(
    validatedSmaBook.strategies.nasdaqSma200.watchlist.length,
    2,
  );
  assert.deepEqual(
    validatedSmaBook.strategies.nasdaqSma200.watchlist.map(
      (row) => row.signalTicker,
    ),
    ["QQQ.US", "NVDA.US"],
  );
});

test("invalid current scanner output preserves the last known good model dataset", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-multi-strategy-"));
  const privateRoot = path.join(root, "private");
  const outputRoot = path.join(root, "output");
  await Promise.all([
    mkdir(privateRoot, { recursive: true }),
    mkdir(outputRoot, { recursive: true }),
  ]);
  const service = new MultiStrategyService(new JsonStore(privateRoot), {
    outputDirectory: outputRoot,
  });
  try {
    await writeFile(
      path.join(outputRoot, "multi_strategy_v1.json"),
      JSON.stringify(snapshot()),
      "utf8",
    );
    const current = await service.refresh(true);
    assert.equal(current.source, "current");
    assert.equal(current.currentFileValid, true);
    assert.equal(current.snapshot.strategies.length, 2);

    await writeFile(
      path.join(outputRoot, "multi_strategy_v1.json"),
      '{"schemaVersion":"broken"}',
      "utf8",
    );
    const fallback = await service.refresh(true);
    assert.equal(fallback.source, "last_known_good");
    assert.equal(fallback.currentFileValid, false);
    assert.equal(fallback.snapshot.generatedAt, snapshot().generatedAt);
    assert.match(fallback.lastError, /unsupported scanner snapshot schema/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("large strategy event history is bounded for import and public control-room state", () => {
  const value = snapshot();
  const warning = {
    severity: "warning",
    code: "projection_warning",
    message: "Projection warning retained in bounded public state.",
    affectedTickers: ["QQQ3.UK"],
  };
  value.scanner.errors = Array.from({ length: 50 }, (_, index) => ({
    message: `Scanner error ${index}`,
  }));
    value.scanner.warnings = Array.from({ length: 80 }, (_, index) => ({
    ...warning,
    code: `scanner_warning_${index}`,
  }));
  const manyEvents = Array.from({ length: 10_050 }, (_, index) => ({
    eventId: `nasdaq-sma200-3x:history:${index}`,
    strategyId: "nasdaq-sma200-3x",
    eventType: index % 2 === 0 ? "entry" : "exit",
    occurredAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    signalDate: new Date(Date.UTC(2026, 0, 1, 0, index))
      .toISOString()
      .slice(0, 10),
    generatedAt: "2026-06-20T08:00:00.000Z",
    signalTicker: "QQQ.US",
    executionTicker: "QQQ3.UK",
    calculationTicker: "QQQ.US",
    price: 100 + index,
    reason: `Historical SMA event ${index}.`,
  }));
  value.strategies[1].events = manyEvents;
  value.strategies[1].warnings = Array.from({ length: 80 }, (_, index) => ({
    ...warning,
    code: `strategy_warning_${index}`,
  }));
  value.strategies[1].virtualPositions[0].warnings = Array.from(
    { length: 25 },
    (_, index) => ({ ...warning, code: `position_warning_${index}` }),
  );
  value.strategies[1].closedVirtualTrades = Array.from(
    { length: 2_000 },
    (_, index) => ({
      positionId: `closed-${index}`,
      executionTicker: "QQQ3.UK",
      exitTimestamp: new Date(Date.UTC(2026, 1, 1, 0, index)).toISOString(),
      pnlPercent: index,
      warnings: Array.from({ length: 25 }, (_unused, warningIndex) => ({
        ...warning,
        code: `closed_warning_${index}_${warningIndex}`,
      })),
    }),
  );
  value.strategies[1].equitySnapshots = Array.from(
    { length: 2_000 },
    (_, index) => ({
      date: new Date(Date.UTC(2021, 0, 1 + index)).toISOString().slice(0, 10),
      value: 10_000 + index,
    }),
  );
  value.strategies[1].chartData = [
    {
      executionTicker: "QQQ3.UK",
      candles: Array.from({ length: 1_000 }, (_, index) => ({
        date: new Date(Date.UTC(2023, 0, 1 + index)).toISOString().slice(0, 10),
        open: 100 + index,
        high: 101 + index,
        low: 99 + index,
        close: 100 + index,
        volume: 1_000_000,
      })),
    },
  ];
  const valid = validateMultiStrategySnapshot(value);
  const originalEventCount = valid.strategies[1].events.length;
  const importCandidates = selectStrategyEventImportCandidates(valid, 500);
  const publicState = trimMultiStrategyPublicState(
    {
      source: "current",
      currentFileValid: true,
      lastError: null,
      snapshot: valid,
    },
    { eventsPerStrategy: 250 },
  );

  assert.equal(originalEventCount, 10_050);
  assert.equal(importCandidates.length, 501);
  assert.equal(
    importCandidates.some(
      (event) => event.eventId === "nasdaq-sma200-3x:history:10049",
    ),
    true,
  );
  assert.equal(
    publicState.snapshot.strategies[1].events[0].eventId,
    "nasdaq-sma200-3x:history:10049",
  );
  assert.equal(publicState.snapshot.strategies[1].events.length, 250);
  assert.equal(publicState.snapshot.strategies[1].events[0].signalDate, "2026-01-07");
  assert.equal(publicState.snapshot.strategies[1].events[0].generatedAt, "2026-06-20T08:00:00.000Z");
  assert.equal(publicState.snapshot.strategies[1].closedVirtualTrades.length, 100);
  assert.equal(publicState.snapshot.strategies[1].equitySnapshots.length, 500);
  assert.equal(publicState.snapshot.strategies[1].chartData[0].candles.length, 250);
  assert.equal(publicState.snapshot.strategies[1].warnings.length, 50);
  assert.equal(publicState.snapshot.scanner.errors.length, 25);
  assert.equal(publicState.snapshot.scanner.warnings.length, 50);
  assert.equal(
    publicState.snapshot.strategies[1].virtualPositions[0].warnings.length,
    10,
  );
  assert.equal(
    publicState.snapshot.strategies[1].closedVirtualTrades[0].warnings.length,
    25,
  );
  assert.equal(valid.strategies[1].events.length, 10_050);
  assert.equal(valid.strategies[1].closedVirtualTrades.length, 2_000);
  assert.equal(valid.strategies[1].equitySnapshots.length, 2_000);
});

test("scanner schema enforces strategy isolation and virtual-only positions", () => {
  const valid = validateMultiStrategySnapshot(snapshot());
  assert.deepEqual(
    valid.strategies.map((item) => item.strategyId),
    ["daily-supertrend", "nasdaq-sma200-3x"],
  );
  assert.ok(
    valid.strategies.every((item) =>
      item.virtualPositions.every(
        (position) => position.label === "Virtual model position",
      ),
    ),
  );
  assert.equal(JSON.stringify(valid).includes("Actual manually entered trade"), false);

  const crossed = snapshot();
  crossed.strategies[0].events[0].strategyId = "nasdaq-sma200-3x";
  assert.throws(
    () => validateMultiStrategySnapshot(crossed),
    /wrong strategy/i,
  );

  const mislabeled = snapshot();
  mislabeled.strategies[0].virtualPositions[0].label = "Actual trade";
  assert.throws(
    () => validateMultiStrategySnapshot(mislabeled),
    /Virtual model position/i,
  );
});

test("scanner schema preserves skipped SuperTrend entries as diagnostics", () => {
  const value = snapshot();
  value.strategies[0].events.push({
    eventId: "daily-supertrend:skipped-entry:coin",
    strategyId: "daily-supertrend",
    eventType: "skipped_entry",
    occurredAt: "2026-06-20T00:00:00.000Z",
    signalDate: "2026-06-20",
    generatedAt: "2026-06-21T08:00:00.000Z",
    signalTicker: "COIN",
    executionTicker: "3CON.L",
    calculationTicker: "COIN",
    triggerTicker: "COIN",
    holdSafetyTicker: "3CON.L",
    sourceOfTruth: false,
    severity: "diagnostic",
    price: 123.45,
    reason:
      "Signal ticker gave BUY, but execution ticker was red/out, so entry was delayed.",
  });

  const valid = validateMultiStrategySnapshot(value);
  const skipped = valid.strategies[0].events.find(
    (event) => event.eventType === "skipped_entry",
  );
  const candidates = selectStrategyEventImportCandidates(valid, 10);

  assert.equal(skipped?.signalTicker, "COIN");
  assert.equal(skipped?.executionTicker, "3CON.L");
  assert.equal(skipped?.calculationTicker, "COIN");
  assert.equal(skipped?.triggerTicker, "COIN");
  assert.equal(skipped?.holdSafetyTicker, "3CON.L");
  assert.equal(skipped?.sourceOfTruth, false);
  assert.equal(skipped?.severity, "diagnostic");
  assert.equal(
    candidates.some((event) => event.eventId === "daily-supertrend:skipped-entry:coin"),
    true,
  );
});

test("scanner schema preserves additive performance warnings", () => {
  const warning = {
    severity: "warning",
    code: "extreme_open_pnl",
    message:
      "Performance warning: this model result may be distorted by leveraged ETP price history or currency units.",
    affectedTickers: ["3USL.UK"],
    metric: "openPnlPercent",
    value: 1200,
    threshold: 500,
  };
  const value = snapshot();
  value.scanner.warnings = [{ ...warning, strategyId: "daily-supertrend" }];
  value.strategies[0].warnings = [warning];
  value.strategies[0].virtualPositions[0].warnings = [warning];
  value.strategies[0].closedVirtualTrades = [
    {
      positionId: "closed-warning",
      executionTicker: "3USL.UK",
      warnings: [warning],
    },
  ];

  const valid = validateMultiStrategySnapshot(value);

  assert.equal(valid.scanner.warnings?.[0].code, "extreme_open_pnl");
  assert.equal(valid.strategies[0].warnings?.[0].threshold, 500);
  assert.equal(
    valid.strategies[0].virtualPositions[0].warnings?.[0].affectedTickers[0],
    "3USL.UK",
  );
  assert.deepEqual(validateMultiStrategySnapshot(snapshot()).scanner.warnings, []);
});
