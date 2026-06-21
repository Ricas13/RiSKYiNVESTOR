import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ScannerImportService } from "../dist-server/scannerImport.js";
import {
  AlertDeliveryRepository,
  DailyPortfolioSnapshotRepository,
  SignalEventRepository,
  validateCanonicalSignalEvent,
} from "../dist-server/signalEvents.js";
import { JsonStore } from "../dist-server/store.js";

function signalEvent(overrides = {}) {
  const now = new Date().toISOString();
  return {
    eventId: "evt-entry",
    eventVersion: 1,
    occurredAt: now,
    receivedAt: now,
    strategyId: "baseline-adaptive-supertrend",
    strategyName: "Baseline Adaptive SuperTrend",
    source: "supertrend_alerts",
    underlyingTicker: "QQQ",
    underlyingName: "Fictional Nasdaq reference",
    tradeTicker: "DEMO3X",
    tradeName: "Fictional leveraged instrument",
    signalState: "actionable_entry",
    previousTrend: "red",
    currentTrend: "green",
    riskTier: "CORE",
    eligibility: "eligible",
    allocationStatus: "normal",
    allocationPercent: 25,
    reasonCode: "confirmed_red_to_green_flip",
    reasonText: "Scanner confirmed the configured red-to-green entry flip.",
    scannerRunId: "run-001",
    rawSourceReference: "fictional://run-001/qqq",
    isActionable: true,
    isAcknowledged: false,
    discordDeliveryEligible: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function repositories(root) {
  const store = new JsonStore(root);
  await Promise.all([
    store.write("signal_events.json", {
      version: 2,
      isExample: true,
      events: [],
    }),
    store.write("alert_deliveries.json", {
      version: 2,
      isExample: true,
      deliveries: [],
    }),
    store.write("daily_portfolio_snapshots.json", {
      version: 1,
      isExample: true,
      snapshots: [],
    }),
    store.write("scanner_import_state.json", {
      version: 1,
      isExample: true,
      status: "awaiting",
      lastGeneratedAt: null,
      lastSuccessfulScanAt: null,
      lastImportedAt: null,
      staleAfterMinutes: 180,
      scannerName: null,
      scannerRunId: null,
      summary: "Awaiting scanner data.",
      warningCount: 0,
      errorCount: 0,
      lastError: null,
      importedEvents: 0,
      duplicateEvents: 0,
      rejectedEvents: 0,
      watchlist: [],
    }),
  ]);
  return {
    store,
    events: new SignalEventRepository(store),
    deliveries: new AlertDeliveryRepository(store),
    snapshots: new DailyPortfolioSnapshotRepository(store),
  };
}

test("canonical events remain explicit, deduplicated, and auditable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-events-"));
  try {
    const repo = await repositories(root);
    const entry = signalEvent();
    const first = await repo.events.saveCanonical([entry]);
    const repeated = await repo.events.saveCanonical([entry]);
    assert.equal(first.accepted.length, 1);
    assert.equal(repeated.accepted.length, 0);
    assert.equal(repeated.duplicates.length, 1);

    const unchanged = signalEvent({
      eventId: "evt-no-change",
      signalState: "no_change",
      previousTrend: "green",
      currentTrend: "green",
      allocationStatus: "not_applicable",
      allocationPercent: 0,
      reasonCode: "trend_unchanged",
      reasonText: "Current trend remains green; no new flip occurred.",
      scannerRunId: "run-002",
      rawSourceReference: "fictional://run-002/qqq",
      isActionable: false,
    });
    const exit = signalEvent({
      eventId: "evt-exit",
      signalState: "actionable_exit",
      previousTrend: "green",
      currentTrend: "red",
      allocationStatus: "not_applicable",
      allocationPercent: 0,
      reasonCode: "confirmed_green_to_red_exit",
      reasonText: "Scanner confirmed the configured exit transition.",
      scannerRunId: "run-003",
      rawSourceReference: "fictional://run-003/qqq",
    });
    const watchlist = signalEvent({
      eventId: "evt-watchlist",
      signalState: "watchlist_only",
      eligibility: "watchlist_only",
      allocationStatus: "zero",
      allocationPercent: 0,
      reasonCode: "speculative_zero_allocation",
      reasonText: "Signal retained for observation with zero allocation.",
      scannerRunId: "run-004",
      rawSourceReference: "fictional://run-004/qqq",
      isActionable: false,
    });
    const result = await repo.events.saveCanonical([
      unchanged,
      exit,
      watchlist,
    ]);
    assert.equal(result.accepted.length, 3);
    assert.equal(result.accepted.find((event) => event.eventId === "evt-no-change").isActionable, false);
    assert.equal(result.accepted.find((event) => event.eventId === "evt-exit").signalState, "actionable_exit");
    assert.equal(result.accepted.find((event) => event.eventId === "evt-watchlist").allocationPercent, 0);

    await assert.rejects(
      async () =>
        validateCanonicalSignalEvent({
          ...entry,
          eventId: "bad-current-green",
          signalState: "actionable_entry",
          previousTrend: "green",
          currentTrend: "green",
        }),
      /red-to-green/,
    );
    await assert.rejects(
      async () =>
        validateCanonicalSignalEvent({
          eventId: "malformed",
          eventVersion: 1,
        }),
      /occurredAt/,
    );

    const acknowledged = await repo.events.acknowledge(
      "evt-entry",
      true,
      "ricardo",
      "Reviewed on dashboard.",
    );
    assert.equal(acknowledged.isAcknowledged, true);
    assert.equal(acknowledged.acknowledgedBy, "ricardo");
    assert.match(acknowledged.acknowledgedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(acknowledged.acknowledgementNote, "Reviewed on dashboard.");
    const persisted = (await repo.events.read()).events.find(
      (event) => event.eventId === "evt-entry",
    );
    assert.equal(persisted.isAcknowledged, true);
    assert.equal(persisted.acknowledgedBy, "ricardo");
    const delivery = await repo.deliveries.recordDashboardSent(
      "evt-entry",
      entry.reasonText,
    );
    assert.equal(delivery.eventId, "evt-entry");
    assert.equal(delivery.channel, "dashboard");
    assert.equal(delivery.status, "sent");
    assert.equal((await repo.deliveries.read()).length, 1);

    const dashboard = await repo.events.dashboardItems();
    assert.equal(dashboard.latestActionable.isActionable, true);
    assert.equal(
      dashboard.actionable.some((event) => event.eventId === "evt-entry"),
      true,
    );
    assert.equal(dashboard.recent.length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scanner exports import once, retain watchlist state, and report staleness", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "risky-scanner-"));
  const privateRoot = path.join(parent, "private");
  const scannerRoot = path.join(parent, "scanner");
  try {
    const repo = await repositories(privateRoot);
    const event = signalEvent();
    const snapshot = {
      snapshotId: "snapshot-001",
      timestamp: event.occurredAt,
      date: event.occurredAt.slice(0, 10),
      actualPortfolioValue: null,
      modelPortfolioValue: 12500,
      actualDailyPnl: null,
      modelDailyPnl: 84.5,
      realisedPnl: null,
      unrealisedPnl: null,
      contributions: null,
      withdrawals: null,
      currentDrawdownPercent: -3.2,
      cashValue: null,
      investedValue: null,
      source: "supertrend_alerts",
      scannerRunId: "run-001",
    };
    const latest = {
      schemaVersion: 1,
      scannerRunId: "run-001",
      generatedAt: event.occurredAt,
      scannerName: "supertrend_alerts",
      scanMode: "dry-run",
      success: true,
      summary: "Fictional scanner export.",
      signalEvents: [event],
      dailyPortfolioSnapshot: snapshot,
      warnings: [],
      errors: [],
    };
    await writeFile(
      path.join(scannerRoot, "latest-scan.json"),
      JSON.stringify(latest),
      { encoding: "utf8", flag: "w" },
    ).catch(async (error) => {
      if (error.code !== "ENOENT") throw error;
      const { mkdir } = await import("node:fs/promises");
      await mkdir(scannerRoot, { recursive: true });
      await writeFile(
        path.join(scannerRoot, "latest-scan.json"),
        JSON.stringify(latest),
        "utf8",
      );
    });
    await writeFile(
      path.join(scannerRoot, "signal-events.jsonl"),
      `${JSON.stringify(event)}\n{not-json}\n`,
      "utf8",
    );
    await writeFile(
      path.join(scannerRoot, "watchlist-state.json"),
      JSON.stringify({
        watchlist: [
          {
            id: "watch-qqq",
            underlyingTicker: "QQQ",
            underlyingName: "Fictional Nasdaq reference",
            tradeTicker: "DEMO3X",
            currentTrend: "unknown",
            riskTier: "CORE",
            eligibility: "eligible",
            allocationPercent: 25,
            liquidityStatus: "Good",
            lastSignalAt: event.occurredAt,
          },
        ],
      }),
      "utf8",
    );

    const importer = new ScannerImportService(
      repo.store,
      repo.events,
      repo.deliveries,
      repo.snapshots,
      { sourceDirectory: scannerRoot, staleAfterMinutes: 180 },
    );
    const state = await importer.refreshIfDue(true);
    assert.equal(state.status, "current");
    assert.equal(state.importedEvents, 1);
    assert.equal(state.duplicateEvents, 0);
    assert.equal(state.rejectedEvents, 1);
    assert.equal(state.watchlist.length, 1);
    assert.equal(state.watchlist[0].currentTrend, "Unknown");
    assert.equal((await repo.events.read()).events.length, 1);
    assert.equal(
      (await repo.events.read()).events[0].discordDeliveryEligible,
      true,
    );
    assert.equal((await repo.deliveries.read())[0].eventId, event.eventId);
    assert.equal((await repo.snapshots.latest()).snapshotId, "snapshot-001");

    await writeFile(
      path.join(scannerRoot, "latest-scan.json"),
      JSON.stringify({
        ...latest,
        scannerRunId: "run-stale",
        generatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
        signalEvents: [],
        dailyPortfolioSnapshot: undefined,
      }),
      "utf8",
    );
    const staleImporter = new ScannerImportService(
      repo.store,
      repo.events,
      repo.deliveries,
      repo.snapshots,
      { sourceDirectory: scannerRoot, staleAfterMinutes: 1 },
    );
    assert.equal((await staleImporter.refreshIfDue(true)).status, "stale");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
