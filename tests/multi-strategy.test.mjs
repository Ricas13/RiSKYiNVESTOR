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
    assert.equal(defaultStrategyConfiguration.strategies.nasdaqSma200.enabled, false);
    assert.deepEqual(
      defaultStrategyConfiguration.strategies.dailySuperTrend.watchlist,
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
