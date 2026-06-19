import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NotificationDispatcher,
  NotificationScheduler,
} from "../dist-server/notifications.js";
import { AlertDeliveryRepository } from "../dist-server/signalEvents.js";
import { JsonStore } from "../dist-server/store.js";

function settings(overrides = {}) {
  return {
    version: 2,
    isExample: false,
    discord: { enabled: true },
    whatsapp: { enabled: false, provider: "stub" },
    migration: {
      legacyScannerDiscordEnabled: false,
      canonicalDashboardDiscordEnabled: true,
    },
    signalAlerts: {
      entry: true,
      exit: true,
      lowLiquidity: true,
      scannerError: true,
      watchlistOnly: false,
      dailySummary: true,
      weeklySummary: false,
    },
    dailySummary: {
      enabled: true,
      time: "21:15",
      timezone: "Europe/London",
      sendStaleSummaries: false,
      lastSentDate: null,
      metrics: {
        actualPortfolioValue: true,
        modelPortfolioValue: true,
        actualPL: true,
        modelPL: true,
        realisedPL: true,
        unrealisedPL: true,
        contributionsWithdrawals: true,
        drawdown: true,
        cashInvested: true,
        latestActionableSignal: true,
        scannerFreshness: true,
      },
    },
    weeklySummary: {
      enabled: false,
      automaticDeliveryEnabled: false,
      dayOfWeek: 5,
      time: "18:00",
      timezone: "Europe/London",
    },
    thresholds: {
      minimumAbsoluteDailyPL: 0,
      minimumDailyPLPercent: 0,
      lowLiquidityOnlyWhenActionable: true,
    },
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "07:00",
      timezone: "Europe/London",
    },
    retention: { maximumDeliveries: 1000 },
    ...overrides,
  };
}

function event(overrides = {}) {
  const now = "2026-06-19T12:00:00.000Z";
  return {
    eventId: "event-entry-1",
    eventVersion: 1,
    occurredAt: now,
    receivedAt: now,
    strategyId: "baseline-adaptive-supertrend",
    strategyName: "Baseline Adaptive SuperTrend",
    source: "supertrend_alerts",
    underlyingTicker: "QQQ",
    underlyingName: "Nasdaq reference",
    tradeTicker: "TQQQ",
    tradeName: "Leveraged trade instrument",
    signalState: "actionable_entry",
    previousTrend: "red",
    currentTrend: "green",
    riskTier: "CORE",
    eligibility: "eligible",
    allocationStatus: "normal",
    allocationPercent: 25,
    reasonCode: "confirmed_red_to_green_flip",
    reasonText: "Configured red-to-green entry flip confirmed.",
    scannerRunId: "run-1",
    rawSourceReference: "scanner://run-1/qqq",
    isActionable: true,
    isAcknowledged: false,
    discordDeliveryEligible: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function snapshot() {
  return {
    snapshotId: "snapshot-2026-06-19",
    timestamp: "2026-06-19T20:00:00.000Z",
    date: "2026-06-19",
    actualPortfolioValue: 102500,
    modelPortfolioValue: 107000,
    actualDailyPnl: 500,
    modelDailyPnl: 750,
    realisedPnl: 120,
    unrealisedPnl: 380,
    contributions: 0,
    withdrawals: 0,
    currentDrawdownPercent: -2.4,
    cashValue: 22500,
    investedValue: 80000,
    source: "scanner",
    scannerRunId: "run-1",
  };
}

class FakeDiscordProvider {
  id = "discord";
  available = true;
  calls = 0;
  failuresRemaining;

  constructor(failuresRemaining = 0) {
    this.failuresRemaining = failuresRemaining;
  }

  async configured() {
    return true;
  }

  async maskedEnding() {
    return "1234";
  }

  async send() {
    this.calls += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error(
        "Discord delivery failed token=private https://discord.com/api/webhooks/123/secret",
      );
    }
    return { providerReference: `message-${this.calls}` };
  }
}

async function fixture(provider = new FakeDiscordProvider()) {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-notifications-"));
  const store = new JsonStore(root);
  await Promise.all([
    store.write("notification_settings.json", settings()),
    store.write("notification_credentials.json", {
      version: 1,
      discordWebhookUrl: null,
      whatsapp: {},
    }),
    store.write("notification_deliveries.json", {
      version: 2,
      isExample: false,
      deliveries: [],
    }),
  ]);
  const deliveries = new AlertDeliveryRepository(store);
  const dispatcher = new NotificationDispatcher(
    store,
    deliveries,
    undefined,
    provider,
  );
  return { root, store, deliveries, dispatcher, provider };
}

test("canonical actionable signals send once and non-alert states do not send", async () => {
  const value = await fixture();
  try {
    const first = await value.dispatcher.dispatchSignal(event());
    const duplicate = await value.dispatcher.dispatchSignal(event());
    const unchanged = await value.dispatcher.dispatchSignal(
      event({
        eventId: "event-no-change",
        signalState: "no_change",
        previousTrend: "green",
        currentTrend: "green",
        isActionable: false,
        discordDeliveryEligible: false,
      }),
    );
    assert.equal(first.status, "sent");
    assert.equal(duplicate.deliveryId, first.deliveryId);
    assert.equal(unchanged, null);
    assert.equal(value.provider.calls, 1);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("disabled delivery is audited and provider errors are safely redacted", async () => {
  const disabled = await fixture();
  try {
    await disabled.dispatcher.updateSettings({
      discord: { enabled: false },
    });
    const record = await disabled.dispatcher.dispatchSignal(event());
    assert.equal(record.status, "disabled");
    assert.equal(disabled.provider.calls, 0);
  } finally {
    await rm(disabled.root, { recursive: true, force: true });
  }

  const failed = await fixture(new FakeDiscordProvider(1));
  try {
    const record = await failed.dispatcher.dispatchSignal(event());
    assert.equal(record.status, "failed");
    assert.doesNotMatch(record.errorMessage, /secret|\/123\//i);
    assert.match(record.errorMessage, /redacted/i);
    const retried = await failed.dispatcher.retryDelivery(record.deliveryId);
    assert.equal(retried.status, "sent");
    assert.equal(retried.retryCount, 1);
    assert.equal(failed.provider.calls, 2);
  } finally {
    await rm(failed.root, { recursive: true, force: true });
  }
});

test("daily summaries use canonical snapshots, honour staleness, and deduplicate local dates", async () => {
  const value = await fixture();
  const currentContext = {
    snapshot: snapshot(),
    latestActionableEvent: event(),
    scanner: {
      status: "current",
      lastSuccessfulScanAt: "2026-06-19T20:00:00.000Z",
      staleAfterMinutes: 180,
    },
  };
  try {
    const preview = await value.dispatcher.runDailySummary(currentContext, {
      dryRun: true,
      force: true,
      now: new Date("2026-06-19T20:15:00.000Z"),
    });
    assert.equal(preview.status, "skipped");
    assert.match(preview.preview, /Actual portfolio value/);
    assert.equal(value.provider.calls, 0);
    assert.equal((await value.deliveries.read()).length, 0);

    const first = await value.dispatcher.runDailySummary(currentContext, {
      now: new Date("2026-06-19T20:15:00.000Z"),
    });
    const duplicate = await value.dispatcher.runDailySummary(currentContext, {
      now: new Date("2026-06-19T20:15:30.000Z"),
    });
    assert.equal(first.status, "sent");
    assert.equal(duplicate.delivery.deliveryId, first.delivery.deliveryId);
    assert.equal(value.provider.calls, 1);

    const stale = await value.dispatcher.runDailySummary(
      {
        ...currentContext,
        scanner: { ...currentContext.scanner, status: "stale" },
      },
      { now: new Date("2026-06-20T20:15:00.000Z") },
    );
    assert.equal(stale.status, "skipped");
    assert.match(stale.reason, /stale/i);
    assert.equal(value.provider.calls, 1);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("scheduler only runs at the configured server-side local time", async () => {
  const value = await fixture();
  const context = {
    snapshot: snapshot(),
    latestActionableEvent: event(),
    scanner: {
      status: "current",
      lastSuccessfulScanAt: "2026-06-19T20:00:00.000Z",
      staleAfterMinutes: 180,
    },
  };
  try {
    const scheduler = new NotificationScheduler(
      value.dispatcher,
      async () => context,
    );
    assert.equal(
      await scheduler.tick(new Date("2026-06-19T20:14:00.000Z")),
      null,
    );
    const result = await scheduler.tick(
      new Date("2026-06-19T20:15:00.000Z"),
    );
    assert.equal(result.status, "sent");
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});
