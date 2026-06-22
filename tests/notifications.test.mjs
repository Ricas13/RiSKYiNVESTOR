import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NotificationDispatcher,
  NotificationScheduler,
} from "../dist-server/notifications.js";
import {
  CredentialCipher,
  DiscordDestinationManager,
  loadCredentialEncryptionKey,
  parseCredentialEncryptionKey,
} from "../dist-server/discordDestinations.js";
import {
  dailySummaryDiscordPayload,
  discordColors,
  signalDiscordPayload,
  testDiscordPayload,
  validateDiscordPayload,
} from "../dist-server/discordEmbeds.js";
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
      legacyServerDiscordAlongsideManaged: false,
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

function subscriptions(overrides = {}) {
  return {
    entry: true,
    exit: true,
    lowLiquidity: true,
    scannerError: true,
    watchlistOnly: true,
    dailySummary: true,
    weeklySummary: true,
    ...overrides,
  };
}

function noSubscriptions(overrides = {}) {
  return subscriptions({
    entry: false,
    exit: false,
    lowLiquidity: false,
    scannerError: false,
    watchlistOnly: false,
    dailySummary: false,
    weeklySummary: false,
    ...overrides,
  });
}

class FakeDiscordTransport {
  calls = [];
  failuresRemaining;

  constructor(failingEndings = []) {
    this.failuresRemaining = new Map(
      failingEndings.map((ending) => [ending, 1]),
    );
  }

  async send(webhook, payload) {
    this.calls.push({ webhook, payload });
    const ending = [...this.failuresRemaining.keys()].find(
      (candidate) =>
        webhook.endsWith(candidate) &&
        (this.failuresRemaining.get(candidate) ?? 0) > 0,
    );
    if (ending) {
      this.failuresRemaining.set(
        ending,
        (this.failuresRemaining.get(ending) ?? 1) - 1,
      );
      throw new Error(
        "Discord delivery failed token=private https://discord.com/api/webhooks/123/secret",
      );
    }
    return { providerReference: `message-${this.calls.length}` };
  }
}

async function fixture(transport = new FakeDiscordTransport(), count = 1) {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-notifications-"));
  const store = new JsonStore(root);
  await Promise.all([
    store.write("notification_settings.json", settings()),
    store.write("discord_destinations.json", {
      version: 1,
      destinations: [],
    }),
    store.write("alert_deliveries.json", {
      version: 2,
      isExample: false,
      deliveries: [],
    }),
  ]);
  const deliveries = new AlertDeliveryRepository(store);
  const manager = new DiscordDestinationManager(
    store,
    new CredentialCipher(
      parseCredentialEncryptionKey(
        "notification-test-encryption-key-that-is-at-least-32-bytes",
      ),
    ),
    () => null,
    transport,
  );
  const destinations = [];
  for (let index = 0; index < count; index += 1) {
    const created = await manager.create({
      label: `Destination ${index + 1}`,
      webhook: `https://discord.com/api/webhooks/${index + 1}/secret-${index + 1}`,
      enabled: true,
      displayName: "Risky Investor",
    });
    destinations.push(
      await manager.update(created.destinationId, {
        enabled: true,
        subscriptions: subscriptions(),
      }),
    );
  }
  const dispatcher = new NotificationDispatcher(
    store,
    deliveries,
    manager,
  );
  return {
    root,
    store,
    deliveries,
    dispatcher,
    manager,
    transport,
    destinations,
  };
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
    assert.equal(value.transport.calls.length, 1);
    assert.equal("content" in value.transport.calls[0].payload, false);
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
    assert.equal(disabled.transport.calls.length, 0);
  } finally {
    await rm(disabled.root, { recursive: true, force: true });
  }

  const failed = await fixture(
    new FakeDiscordTransport(["secret-1"]),
  );
  try {
    const record = await failed.dispatcher.dispatchSignal(event());
    assert.equal(record.status, "failed");
    assert.doesNotMatch(record.errorMessage, /secret|\/123\//i);
    assert.match(record.errorMessage, /redacted/i);
    const retried = await failed.dispatcher.retryDelivery(record.deliveryId);
    assert.equal(retried.status, "sent");
    assert.equal(retried.retryCount, 1);
    assert.equal(failed.transport.calls.length, 2);
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
    assert.equal(value.transport.calls.length, 0);
    assert.equal((await value.deliveries.read()).length, 0);

    const first = await value.dispatcher.runDailySummary(currentContext, {
      now: new Date("2026-06-19T20:15:00.000Z"),
    });
    const duplicate = await value.dispatcher.runDailySummary(currentContext, {
      now: new Date("2026-06-19T20:15:30.000Z"),
    });
    assert.equal(first.status, "sent");
    assert.equal(duplicate.delivery.deliveryId, first.delivery.deliveryId);
    assert.equal(value.transport.calls.length, 1);

    const stale = await value.dispatcher.runDailySummary(
      {
        ...currentContext,
        scanner: { ...currentContext.scanner, status: "stale" },
      },
      { now: new Date("2026-06-20T20:15:00.000Z") },
    );
    assert.equal(stale.status, "skipped");
    assert.match(stale.reason, /stale/i);
    assert.equal(value.transport.calls.length, 1);
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

test("credential encryption round-trips and invalid keys fail safely", () => {
  const key = parseCredentialEncryptionKey(
    "a-secure-test-key-material-that-is-longer-than-thirty-two-bytes",
  );
  const cipher = new CredentialCipher(key);
  const webhook =
    "https://discord.com/api/webhooks/123456/private-token-value";
  const encrypted = cipher.encrypt(webhook, "destination:test");
  assert.equal(cipher.decrypt(encrypted, "destination:test"), webhook);
  assert.equal(JSON.stringify(encrypted).includes(webhook), false);
  assert.throws(
    () => parseCredentialEncryptionKey("too-short"),
    /at least 32 bytes/i,
  );
  assert.throws(
    () => loadCredentialEncryptionKey({ NODE_ENV: "production" }, true),
    /required in production/i,
  );
});

test("destination CRUD masks plaintext and supports replace, test, toggle and delete", async () => {
  const value = await fixture();
  const plaintext =
    "https://discord.com/api/webhooks/987654/super-private-token";
  try {
    const created = await value.manager.create({
      label: "Operations",
      webhook: plaintext,
      enabled: true,
      subscriptions: subscriptions(),
      displayName: "Adaptive SuperTrend",
      avatarUrl: "https://example.com/avatar.png",
    });
    assert.equal(created.maskedEnding, "oken");
    assert.equal(created.enabled, false);
    assert.deepEqual(created.subscriptions, noSubscriptions());
    assert.equal(JSON.stringify(created).includes(plaintext), false);
    const stored = JSON.stringify(
      await value.store.read("discord_destinations.json"),
    );
    assert.equal(stored.includes(plaintext), false);

    const updated = await value.manager.update(created.destinationId, {
      enabled: true,
      label: "Owner operations",
    });
    assert.equal(updated.enabled, true);
    assert.equal(updated.label, "Owner operations");
    assert.deepEqual(updated.subscriptions, noSubscriptions());

    const replaced = await value.manager.replaceWebhook(
      created.destinationId,
      "https://discordapp.com/api/webhooks/987654/replacement-token",
    );
    assert.equal(replaced.maskedEnding, "oken");

    const tested = await value.dispatcher.testDiscord(
      created.destinationId,
    );
    assert.equal(tested.status, "sent");
    assert.match(
      value.transport.calls.at(-1).payload.embeds[0].title,
      /Discord delivery test/,
    );

    await value.manager.delete(created.destinationId);
    assert.equal(
      (await value.manager.publicDestinations()).some(
        (item) => item.destinationId === created.destinationId,
      ),
      false,
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("fan-out isolates failures and preserves idempotency per destination", async () => {
  const value = await fixture(
    new FakeDiscordTransport(["secret-2"]),
    2,
  );
  try {
    await value.dispatcher.dispatchSignal(event());
    const firstHistory = await value.deliveries.read();
    const signalDeliveries = firstHistory.filter(
      (delivery) => delivery.eventId === event().eventId,
    );
    assert.equal(signalDeliveries.length, 2);
    assert.deepEqual(
      signalDeliveries.map((delivery) => delivery.status).sort(),
      ["failed", "sent"],
    );
    assert.equal(value.transport.calls.length, 2);

    await value.dispatcher.dispatchSignal(event());
    assert.equal(value.transport.calls.length, 2);
    assert.equal(
      new Set(signalDeliveries.map((delivery) => delivery.destinationId))
        .size,
      2,
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("destination subscriptions route every category after global gates", async () => {
  const value = await fixture(new FakeDiscordTransport(), 2);
  const [first, second] = value.destinations;
  try {
    await value.manager.update(first.destinationId, {
      subscriptions: noSubscriptions({
        entry: true,
        lowLiquidity: true,
        watchlistOnly: true,
        dailySummary: true,
      }),
    });
    await value.manager.update(second.destinationId, {
      subscriptions: noSubscriptions({
        exit: true,
        scannerError: true,
        weeklySummary: true,
      }),
    });
    await value.dispatcher.updateSettings({
      signalAlerts: { watchlistOnly: true },
    });

    await value.dispatcher.dispatchSignal(event({ eventId: "route-entry" }));
    await value.dispatcher.dispatchSignal(
      event({
        eventId: "route-exit",
        signalState: "actionable_exit",
        previousTrend: "green",
        currentTrend: "red",
      }),
    );
    await value.dispatcher.dispatchSignal(
      event({
        eventId: "route-liquidity",
        signalState: "low_liquidity_warning",
      }),
    );
    await value.dispatcher.dispatchSignal(
      event({
        eventId: "route-error",
        signalState: "scanner_error",
      }),
    );
    await value.dispatcher.dispatchSignal(
      event({
        eventId: "route-watchlist",
        signalState: "watchlist_only",
      }),
    );

    assert.deepEqual(
      value.transport.calls.map(({ webhook }) => webhook.slice(-8)),
      ["secret-1", "secret-2", "secret-1", "secret-2", "secret-1"],
    );

    const weeklyTargets = await value.manager.deliveryTargets(
      "weeklySummary",
      false,
    );
    assert.deepEqual(
      weeklyTargets.map((target) => target.destinationId),
      [second.destinationId],
    );

    const daily = await value.dispatcher.runDailySummary(
      {
        snapshot: snapshot(),
        latestActionableEvent: event(),
        scanner: {
          status: "current",
          lastSuccessfulScanAt: "2026-06-19T20:00:00.000Z",
          staleAfterMinutes: 180,
        },
      },
      { now: new Date("2026-06-19T20:15:00.000Z") },
    );
    assert.equal(daily.status, "sent");
    assert.equal(
      value.transport.calls.at(-1).webhook.endsWith("secret-1"),
      true,
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("no subscribed enabled destination records one skipped audit result", async () => {
  const value = await fixture();
  try {
    await value.manager.update(value.destinations[0].destinationId, {
      subscriptions: noSubscriptions(),
    });
    const result = await value.dispatcher.dispatchSignal(
      event({ eventId: "no-entry-subscriber" }),
    );
    assert.equal(result.status, "skipped");
    assert.match(
      result.errorMessage,
      /no enabled Discord destination is subscribed/i,
    );
    assert.equal(result.destinationId ?? null, null);
    assert.equal(value.transport.calls.length, 0);
    assert.equal(
      (await value.deliveries.read()).filter(
        (delivery) => delivery.eventId === "no-entry-subscriber",
      ).length,
      1,
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("missing strategy route falls back to default destination", async () => {
  const value = await fixture();
  try {
    const result = await value.dispatcher.dispatchSignal(
      event({
        eventId: "supertrend-muted",
        strategyId: "daily-supertrend",
        strategyName: "Daily SuperTrend",
        source: "integrated_python_scanner",
      }),
    );
    assert.equal(result.status, "sent");
    assert.equal(value.transport.calls.length, 1);
    assert.equal(
      (await value.deliveries.read()).some(
        (delivery) => delivery.eventId === "supertrend-muted",
      ),
      true,
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("strategy-specific policies isolate Discord routing and deduplicate per destination", async () => {
  const value = await fixture(new FakeDiscordTransport(), 2);
  const [superTrendDestination, smaDestination] = value.destinations;
  try {
    await value.dispatcher.updateSettings({
      strategyPolicies: {
        "daily-supertrend": {
          entry: [superTrendDestination.destinationId],
        },
        "nasdaq-sma200-3x": {
          entry: [smaDestination.destinationId],
        },
      },
    });

    const superTrendEvent = event({
      eventId: "supertrend-entry-routed",
      strategyId: "daily-supertrend",
      strategyName: "Daily SuperTrend",
      source: "integrated_python_scanner",
    });
    const smaEvent = event({
      eventId: "sma-entry-routed",
      strategyId: "nasdaq-sma200-3x",
      strategyName: "Nasdaq SMA200 Regime — 3x",
      source: "integrated_python_scanner",
    });

    await value.dispatcher.dispatchSignal(superTrendEvent);
    await value.dispatcher.dispatchSignal(smaEvent);
    await value.dispatcher.dispatchSignal(superTrendEvent);
    await value.dispatcher.dispatchSignal(smaEvent);

    assert.deepEqual(
      value.transport.calls.map(({ webhook }) => webhook.slice(-8)),
      ["secret-1", "secret-2"],
    );
    const history = await value.deliveries.read();
    assert.equal(
      history.filter((delivery) => delivery.eventId === superTrendEvent.eventId)
        .length,
      1,
    );
    assert.equal(
      history.filter((delivery) => delivery.eventId === smaEvent.eventId).length,
      1,
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("notification routes send categories to selected destinations", async () => {
  const value = await fixture(new FakeDiscordTransport(), 2);
  const [primary, secondary] = value.destinations;
  try {
    await value.manager.update(primary.destinationId, {
      subscriptions: noSubscriptions(),
    });
    await value.manager.update(secondary.destinationId, {
      subscriptions: noSubscriptions(),
    });
    await value.dispatcher.updateSettings({
      routes: {
        dailySummary: {
          enabled: true,
          destinationId: secondary.destinationId,
          minimumSeverity: "warning",
        },
        supertrendSignals: {
          enabled: true,
          destinationId: primary.destinationId,
          minimumSeverity: "warning",
        },
        sma200Signals: {
          enabled: true,
          destinationId: secondary.destinationId,
          minimumSeverity: "warning",
        },
        scannerErrors: {
          enabled: true,
          destinationId: secondary.destinationId,
          minimumSeverity: "error",
        },
      },
    });

    await value.dispatcher.dispatchSignal(
      event({
        eventId: "route-supertrend",
        strategyId: "daily-supertrend",
        strategyName: "Daily SuperTrend",
        source: "integrated_python_scanner",
      }),
    );
    await value.dispatcher.dispatchSignal(
      event({
        eventId: "route-sma",
        strategyId: "nasdaq-sma200-3x",
        strategyName: "Nasdaq SMA200 Regime — 3x",
        source: "integrated_python_scanner",
      }),
    );
    await value.dispatcher.dispatchSignal(
      event({
        eventId: "route-scanner-error",
        signalState: "scanner_error",
        isActionable: true,
        reasonText: "Scanner failed safely.",
      }),
    );
    await value.dispatcher.runDailySummary(
      {
        snapshot: snapshot(),
        latestActionableEvent: event(),
        scanner: {
          status: "current",
          lastSuccessfulScanAt: "2026-06-19T20:00:00.000Z",
          staleAfterMinutes: 180,
        },
      },
      { force: true, now: new Date("2026-06-19T21:15:00.000Z") },
    );

    assert.deepEqual(
      value.transport.calls.map(({ webhook }) => webhook.slice(-8)),
      ["secret-1", "secret-2", "secret-2", "secret-2"],
    );
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("disabled notification route does not send and missing route falls back", async () => {
  const value = await fixture(new FakeDiscordTransport(), 1);
  const [destination] = value.destinations;
  try {
    await value.dispatcher.updateSettings({
      routes: {
        supertrendSignals: {
          enabled: false,
          destinationId: destination.destinationId,
          minimumSeverity: "warning",
        },
      },
    });
    const disabled = await value.dispatcher.dispatchSignal(
      event({
        eventId: "route-disabled",
        strategyId: "daily-supertrend",
        strategyName: "Daily SuperTrend",
        source: "integrated_python_scanner",
      }),
    );
    assert.equal(disabled.status, "disabled");
    assert.equal(value.transport.calls.length, 0);

    await value.dispatcher.updateSettings({
      routes: {
        supertrendSignals: {
          enabled: false,
          destinationId: null,
          minimumSeverity: "warning",
        },
      },
    });
    const fallback = await value.dispatcher.dispatchSignal(
      event({
        eventId: "route-fallback",
        strategyId: "daily-supertrend",
        strategyName: "Daily SuperTrend",
        source: "integrated_python_scanner",
      }),
    );
    assert.equal(fallback.status, "sent");
    assert.equal(value.transport.calls.length, 1);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("Discord embed templates are compact, color-routed and contain no plaintext fallback", () => {
  const open = signalDiscordPayload(event());
  const close = signalDiscordPayload(
    event({ signalState: "actionable_exit", previousTrend: "green", currentTrend: "red" }),
  );
  const error = signalDiscordPayload(
    event({ signalState: "scanner_error", reasonText: "Safe scanner error." }),
  );
  const liquidity = signalDiscordPayload(
    event({ signalState: "low_liquidity_warning", reasonText: "Wide executable spread." }),
  );
  const daily = dailySummaryDiscordPayload({
    localDate: "2026-06-19",
    snapshot: snapshot(),
    latestActionableEvent: event(),
    scanner: {
      status: "current",
      lastSuccessfulScanAt: "2026-06-19T20:00:00.000Z",
      importedEvents: 2,
      warningCount: 1,
      errorCount: 0,
      watchlist: [
        { tradeTicker: "TQQQ", currentTrend: "Green" },
        { tradeTicker: "SQQQ", currentTrend: "Red" },
      ],
    },
    settings: settings(),
  });

  assert.match(open.embeds[0].title, /ACTIONABLE ENTRY/);
  assert.match(close.embeds[0].title, /ACTIONABLE EXIT/);
  assert.match(error.embeds[0].title, /SCANNER ERROR/);
  assert.match(liquidity.embeds[0].title, /LOW LIQUIDITY/);
  assert.deepEqual(
    [
      open.embeds[0].color,
      close.embeds[0].color,
      error.embeds[0].color,
      liquidity.embeds[0].color,
      daily.embeds.map((embed) => embed.color),
    ],
    [
      discordColors.green,
      discordColors.red,
      discordColors.red,
      discordColors.amber,
      [discordColors.gold, discordColors.blue, discordColors.green],
    ],
  );
  for (const payload of [
    open,
    close,
    error,
    liquidity,
    daily,
    testDiscordPayload(),
  ]) {
    assert.equal("content" in payload, false);
    assert.equal(validateDiscordPayload(payload), payload);
    assert.ok(JSON.stringify(payload).length < 20_000);
  }
});
