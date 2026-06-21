import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { once } from "node:events";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { seedDemoRuntimeData } from "./fixtures/runtime-fixtures.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
function passwordHash(password) {
  const salt = "integration-test-salt";
  const hash = scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt}$${hash.toString("base64url")}`;
}

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(child) {
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });

  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearInterval(interval);
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const interval = setInterval(() => {
      if (output.includes("private server listening")) {
        finish();
      } else if (child.exitCode !== null) {
        finish(
          new Error(`Server exited before startup.\n${output}\n${errors}`),
        );
      }
    }, 25);
    const timeout = setTimeout(
      () =>
        finish(
          new Error(`Server startup timed out.\n${output}\n${errors}`),
        ),
      10_000,
    );
  });
}

async function json(response) {
  return response.status === 204 ? undefined : response.json();
}

test("private API enforces auth and CSRF across the manual trade lifecycle", async () => {
  const privateData = await mkdtemp(
    path.join(os.tmpdir(), "risky-investor-api-"),
  );
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const username = "integration-user";
  const password = "correct horse battery staple";
  const usernameFile = path.join(privateData, "test-username");
  const passwordHashFile = path.join(privateData, "test-password-hash");
  const sessionSecretFile = path.join(privateData, "test-session-secret");
  await seedDemoRuntimeData(privateData, {
    username,
    role: "owner",
  });
  await Promise.all([
    writeFile(usernameFile, username, "utf8"),
    writeFile(passwordHashFile, passwordHash(password), "utf8"),
    writeFile(
      sessionSecretFile,
      "integration-test-secret-that-is-longer-than-32-characters",
      "utf8",
    ),
  ]);
  const child = spawn(process.execPath, ["dist-server/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      PRIVATE_DATA_DIR: privateData,
      SCANNER_CONFIG_DIR: path.join(privateData, "scanner-config"),
      SCANNER_OUTPUT_DIR: path.join(privateData, "scanner-output"),
      RISKY_INVESTOR_USERNAME_FILE: usernameFile,
      RISKY_INVESTOR_PASSWORD_HASH_FILE: passwordHashFile,
      SESSION_SECRET_FILE: sessionSecretFile,
      RISKY_INVESTOR_CREDENTIAL_ENCRYPTION_KEY:
        "integration-test-credential-encryption-key-at-least-32-bytes",
      SESSION_TTL_HOURS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);

    let response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { status: "ok" });

    response = await fetch(`${baseUrl}/api/auth/session`);
    assert.equal(response.status, 401);
    assert.deepEqual(await json(response), { authenticated: false });

    response = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get("x-content-type-options"),
      "nosniff",
    );
    assert.equal(response.headers.get("x-frame-options"), "DENY");

    response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password: "wrong password" }),
    });
    assert.equal(response.status, 401);

    response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200);
    const session = await json(response);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie?.startsWith("ri_session="));
    assert.equal(session.authenticated, true);
    assert.equal(session.username, username);
    assert.ok(session.csrfToken);

    const authenticatedHeaders = { cookie };
    response = await fetch(`${baseUrl}/api/dashboard`, {
      headers: authenticatedHeaders,
    });
    assert.equal(response.status, 200);
    const initialDashboard = await json(response);
    assert.equal(initialDashboard.manualTrades.isExample, true);
    assert.equal(initialDashboard.account.account.role, "owner");
    assert.ok(initialDashboard.strategies.strategies.length >= 2);
    assert.ok(initialDashboard.signalArchive.length >= 5);
    assert.ok(initialDashboard.alerts.alerts.length >= 1);
    assert.equal(initialDashboard.signalEvents.events.length, 0);
    assert.equal(initialDashboard.scannerImport.status, "awaiting");
    assert.equal(initialDashboard.latestPortfolioSnapshot, null);
    assert.equal(initialDashboard.strategyMonitor.source, "awaiting");
    assert.equal(
      initialDashboard.strategyConfiguration.strategies.dailySuperTrend.enabled,
      false,
    );
    assert.equal(
      initialDashboard.strategyConfiguration.strategies.nasdaqSma200.enabled,
      false,
    );
    assert.equal(initialDashboard.notifications.providers.discord.configured, false);
    assert.equal(initialDashboard.notifications.providers.discord.available, true);
    assert.equal(
      JSON.stringify(initialDashboard.notifications).includes("WebhookUrl"),
      false,
    );
    assert.ok(initialDashboard.dailyPL);

    const strategyResources = initialDashboard.strategyConfiguration.resources;
    assert.ok(strategyResources);
    const nasdaqPreset = strategyResources.presets.find(
      (preset) => preset.presetId === "nasdaq-sma-regime-3x",
    );
    const superTrendPreset = strategyResources.presets.find(
      (preset) => preset.presetId === "daily-supertrend-watchlist-template",
    );
    assert.ok(nasdaqPreset);
    assert.ok(superTrendPreset);
    assert.equal(
      nasdaqPreset.configuration.strategies.nasdaqSma200.enabled,
      false,
    );
    assert.equal(
      superTrendPreset.configuration.strategies.dailySuperTrend.enabled,
      false,
    );
    assert.ok(
      superTrendPreset.configuration.strategies.dailySuperTrend.watchlist.every(
        (row) => row.enabled === false,
      ),
    );
    assert.ok(
      strategyResources.tickerCatalogue.some(
        (entry) =>
          entry.category === "UK leveraged Nasdaq" &&
          entry.marketDataSymbol === "QQQ3.UK",
      ),
    );

    const notificationStateBeforePreset = structuredClone(
      initialDashboard.notifications,
    );
    const presetConfiguration = structuredClone(
      initialDashboard.strategyConfiguration,
    );
    presetConfiguration.strategies.nasdaqSma200 =
      nasdaqPreset.configuration.strategies.nasdaqSma200;
    response = await fetch(`${baseUrl}/api/strategy-configuration`, {
      method: "PUT",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify(presetConfiguration),
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await json(response)).strategies.nasdaqSma200.enabled,
      false,
    );
    response = await fetch(`${baseUrl}/api/dashboard`, {
      headers: authenticatedHeaders,
    });
    assert.equal(response.status, 200);
    const afterPresetDashboard = await json(response);
    assert.deepEqual(
      afterPresetDashboard.notifications,
      notificationStateBeforePreset,
    );
    assert.equal(afterPresetDashboard.strategyMonitor.source, "awaiting");
    assert.equal(
      (
        await readdir(path.join(privateData, "scanner-output")).catch(
          () => [],
        )
      ).includes("multi_strategy_v1.json"),
      false,
    );

    const strategyConfiguration = structuredClone(
      initialDashboard.strategyConfiguration,
    );
    strategyConfiguration.strategies.dailySuperTrend.watchlist.push({
      signalTicker: "SPY.US",
      executionTicker: "3USL.UK",
      enabled: true,
      allocationWeight: 1,
    });
    strategyConfiguration.strategies.dailySuperTrend.enabled = true;

    response = await fetch(`${baseUrl}/api/strategy-configuration`, {
      method: "PUT",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(strategyConfiguration),
    });
    assert.equal(response.status, 403);

    const invalidStrategyConfiguration = structuredClone(
      initialDashboard.strategyConfiguration,
    );
    invalidStrategyConfiguration.strategies.dailySuperTrend.enabled = true;
    response = await fetch(`${baseUrl}/api/strategy-configuration`, {
      method: "PUT",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify(invalidStrategyConfiguration),
    });
    assert.equal(response.status, 400);
    assert.match((await json(response)).error, /watchlist row/i);

    response = await fetch(`${baseUrl}/api/strategy-configuration`, {
      method: "PUT",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify(strategyConfiguration),
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await json(response)).strategies.dailySuperTrend.enabled,
      true,
    );
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(
            privateData,
            "scanner-config",
            "strategy_config_v1.json",
          ),
          "utf8",
        ),
      ).strategies.dailySuperTrend.watchlist[0].executionTicker,
      "3USL.UK",
    );

    const webhook =
      "https://discord.com/api/webhooks/123456/integration-private-token";
    response = await fetch(`${baseUrl}/api/discord-destinations`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ label: "Integration", webhook }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/api/discord-destinations`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        label: "Integration",
        webhook,
        enabled: true,
        displayName: "Risky Investor",
      }),
    });
    assert.equal(response.status, 201);
    const destination = await json(response);
    assert.equal(destination.label, "Integration");
    assert.equal(destination.maskedEnding, "oken");
    assert.equal(JSON.stringify(destination).includes(webhook), false);
    assert.equal(
      JSON.stringify(
        JSON.parse(
          await readFile(
            path.join(privateData, "discord_destinations.json"),
            "utf8",
          ),
        ),
      ).includes(webhook),
      false,
    );

    response = await fetch(
      `${baseUrl}/api/discord-destinations/${destination.destinationId}`,
      {
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
        },
        body: JSON.stringify({ enabled: false }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await json(response)).enabled, false);

    response = await fetch(
      `${baseUrl}/api/discord-destinations/${destination.destinationId}/webhook`,
      {
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
        },
        body: JSON.stringify({
          webhook:
            "https://discordapp.com/api/webhooks/123456/replaced-private-token",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await json(response)).maskedEnding, "oken");

    const tradeInput = {
      strategyName: "UK Nasdaq SMA200",
      sleeve: "SMA200 Regime",
      assetName: "Nasdaq 100 3x",
      ticker: "qqq3.l",
      direction: "long",
      entryDate: "2026-06-01",
      entryPrice: 100,
      quantity: 10,
      amountInvested: 1002,
      fees: 2,
      notes: "Integration test trade",
      source: "manual",
      referenceLink: "",
      currentPrice: 108,
    };

    response = await fetch(`${baseUrl}/api/manual-trades`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(tradeInput),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/api/manual-trades`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify(tradeInput),
    });
    assert.equal(response.status, 201);
    const trade = await json(response);
    assert.equal(trade.ticker, "QQQ3.L");
    assert.equal(trade.riskTier, "CORE");
    assert.equal(trade.leverageMultiplier, 1);
    assert.equal(trade.journal.followedSystem, false);
    assert.equal(trade.sleeve, "SMA200 Regime");

    response = await fetch(
      `${baseUrl}/api/signal-decisions/sig-20260617-smh`,
      {
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
        },
        body: JSON.stringify({
          status: "Taken",
          manualTradeId: trade.id,
          notes: "Linked during integration test.",
          assumedStake: 1250,
        }),
      },
    );
    assert.equal(response.status, 200);
    const decision = await json(response);
    assert.equal(decision.manualTradeId, trade.id);
    assert.equal(decision.status, "Taken");

    response = await fetch(`${baseUrl}/api/alerts/alert-smh-entry`, {
      method: "PUT",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        status: "actioned",
        manualTradeId: trade.id,
      }),
    });
    assert.equal(response.status, 200);
    const alert = await json(response);
    assert.equal(alert.status, "actioned");
    assert.equal(alert.manualTradeId, trade.id);

    response = await fetch(`${baseUrl}/api/manual-trades/${trade.id}/exits`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        exitDate: "2026-06-10",
        exitPrice: 112,
        quantitySold: 4,
        fees: 1,
        reason: "Partial take profit",
        notes: "",
      }),
    });
    assert.equal(response.status, 201);
    const firstExit = await json(response);

    response = await fetch(`${baseUrl}/api/manual-trades/${trade.id}`, {
      method: "PUT",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({ ...tradeInput, quantity: 3 }),
    });
    assert.equal(response.status, 400);
    assert.match((await json(response)).error, /already sold/);

    response = await fetch(`${baseUrl}/api/manual-trades/${trade.id}`, {
      method: "PUT",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({ ...tradeInput, ticker: "qqq3.l", currentPrice: 115 }),
    });
    assert.equal(response.status, 200);
    assert.equal((await json(response)).sleeve, "SMA200 Regime");

    response = await fetch(`${baseUrl}/api/manual-trades/${trade.id}/exits`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        exitDate: "2026-06-15",
        exitPrice: 116,
        quantitySold: 6,
        fees: 1,
        reason: "Exit signal",
        notes: "",
      }),
    });
    assert.equal(response.status, 201);
    const secondExit = await json(response);

    let openView = JSON.parse(
      await readFile(path.join(privateData, "open_positions.json"), "utf8"),
    );
    let closedView = JSON.parse(
      await readFile(path.join(privateData, "closed_trades.json"), "utf8"),
    );
    assert.equal(
      openView.positions.some((position) => position.id === trade.id),
      false,
    );
    assert.equal(
      closedView.trades.some((closedTrade) => closedTrade.id === trade.id),
      true,
    );

    response = await fetch(
      `${baseUrl}/api/manual-trades/${trade.id}/exits/${secondExit.id}`,
      {
        method: "DELETE",
        headers: {
          ...authenticatedHeaders,
          "x-csrf-token": session.csrfToken,
        },
      },
    );
    assert.equal(response.status, 204);

    response = await fetch(`${baseUrl}/api/export/trades.csv`, {
      headers: authenticatedHeaders,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(await response.text(), /strategyName/);

    response = await fetch(`${baseUrl}/api/export/wealth.csv`, {
      headers: authenticatedHeaders,
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /totalPortfolioValue/);

    response = await fetch(`${baseUrl}/api/backup`, {
      headers: authenticatedHeaders,
    });
    assert.equal(response.status, 200);
    const backup = await json(response);
    assert.equal(backup.format, "risky-investor-backup");
    assert.equal(backup.version, 1);
    assert.ok(backup.data.strategies);
    assert.ok(backup.data.signalEvents);
    assert.ok(backup.data.notificationSettings);
    assert.equal("notificationCredentials" in backup.data, false);

    const csv = [
      "strategyName,assetName,ticker,direction,riskTier,assetClass,isTechnology,isSingleStock,leverageMultiplier,entryDate,entryPrice,quantity,amountInvested,fees,currentPrice",
      "UK Nasdaq SMA200,Nasdaq 100,QQQ3.L,long,AGGRESSIVE,US Index,true,false,3,2026-06-18,120,2,240,1,125",
    ].join("\n");
    response = await fetch(`${baseUrl}/api/import/manual-trades-csv`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({ csv }),
    });
    assert.equal(response.status, 201);
    assert.equal((await json(response)).imported, 1);

    response = await fetch(`${baseUrl}/api/import/signals-json`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        signalEvents: [
          {
            eventId: "imported-no-change",
            eventVersion: 1,
            occurredAt: "2026-06-19T19:00:00.000Z",
            receivedAt: "2026-06-19T19:00:01.000Z",
            strategyId: "baseline-supertrend",
            strategyName: "Baseline Adaptive SuperTrend",
            source: "manual_test_import",
            underlyingTicker: "QQQ",
            underlyingName: "Fictional Nasdaq reference",
            tradeTicker: "QQQ3.L",
            tradeName: "Fictional leveraged instrument",
            signalState: "no_change",
            previousTrend: "green",
            currentTrend: "green",
            riskTier: "CORE",
            eligibility: "eligible",
            allocationStatus: "not_applicable",
            allocationPercent: 0,
            reasonCode: "trend_unchanged",
            reasonText: "Current trend remains green; no new flip occurred.",
            scannerRunId: "run-import-001",
            rawSourceReference: "fictional://run-import-001/qqq",
            isActionable: false,
            isAcknowledged: false,
            createdAt: "2026-06-19T19:00:01.000Z",
            updatedAt: "2026-06-19T19:00:01.000Z",
          },
          {
            eventId: "imported-entry",
            eventVersion: 1,
            occurredAt: "2026-06-19T20:00:00.000Z",
            receivedAt: "2026-06-19T20:00:01.000Z",
            strategyId: "baseline-supertrend",
            strategyName: "Baseline Adaptive SuperTrend",
            source: "manual_test_import",
            underlyingTicker: "SMH",
            underlyingName: "Fictional semiconductor reference",
            tradeTicker: "3SMH.L",
            tradeName: "Fictional leveraged semiconductor instrument",
            signalState: "actionable_entry",
            previousTrend: "red",
            currentTrend: "green",
            riskTier: "AGGRESSIVE",
            eligibility: "eligible",
            allocationStatus: "reduced",
            allocationPercent: 12.5,
            reasonCode: "confirmed_red_to_green_flip",
            reasonText: "Scanner confirmed the configured entry transition.",
            scannerRunId: "run-import-001",
            rawSourceReference: "fictional://run-import-001/smh",
            isActionable: true,
            isAcknowledged: false,
            createdAt: "2026-06-19T20:00:01.000Z",
            updatedAt: "2026-06-19T20:00:01.000Z",
          },
        ],
      }),
    });
    assert.equal(response.status, 201);
    const importedEvents = await json(response);
    assert.equal(importedEvents.imported, 2);
    assert.equal(importedEvents.actionable, 1);
    assert.equal(
      importedEvents.events.find(
        (event) => event.eventId === "imported-no-change",
      ).signalState,
      "no_change",
    );
    assert.equal(
      importedEvents.events.find((event) => event.eventId === "imported-entry")
        .signalState,
      "actionable_entry",
    );

    response = await fetch(`${baseUrl}/api/import/signals-json`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({ signalEvents: importedEvents.events }),
    });
    assert.equal(response.status, 201);
    assert.equal((await json(response)).duplicates, 2);

    response = await fetch(`${baseUrl}/api/import/signals-json`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        signalEvents: [
          {
            eventId: "malformed",
            eventVersion: 1,
          },
        ],
      }),
    });
    assert.equal(response.status, 400);

    response = await fetch(`${baseUrl}/api/notification-settings`, {
      method: "PUT",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        discord: { enabled: false },
        dailySummary: {
          enabled: true,
          time: "20:45",
          timezone: "Europe/London",
        },
        quietHours: { enabled: true, start: "22:00", end: "07:00" },
      }),
    });
    assert.equal(response.status, 200);
    const notificationSettings = await json(response);
    assert.equal(notificationSettings.dailySummary.enabled, true);
    assert.equal(notificationSettings.dailySummary.time, "20:45");

    response = await fetch(`${baseUrl}/api/notifications/test`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        dryRun: false,
      }),
    });
    assert.equal(response.status, 200);
    const testResult = await json(response);
    assert.equal(testResult.status, "disabled");
    assert.match(testResult.preview, /notification test/i);

    response = await fetch(`${baseUrl}/api/dashboard`, {
      headers: authenticatedHeaders,
    });
    assert.equal(response.status, 200);
    const eventDashboard = await json(response);
    assert.equal(
      eventDashboard.signalEvents.events.find(
        (event) => event.eventId === "imported-entry",
      ).isActionable,
      true,
    );
    assert.equal(
      eventDashboard.notifications.deliveries.find(
        (delivery) =>
          delivery.eventId === "imported-entry" &&
          delivery.channel === "dashboard",
      ).status,
      "sent",
    );
    assert.ok(eventDashboard.notifications.deliveries.length >= 2);
    const safeTestDelivery = eventDashboard.notifications.deliveries.find(
      (delivery) =>
        delivery.channel === "discord" && delivery.category === "test",
    );
    assert.equal(safeTestDelivery.status, "disabled");
    assert.match(safeTestDelivery.errorMessage, /not configured/i);
    assert.equal(
      JSON.stringify(eventDashboard.notifications).includes("/api/webhooks/"),
      false,
    );

    response = await fetch(
      `${baseUrl}/api/signal-events/imported-entry/acknowledge`,
      {
        method: "PUT",
        headers: {
          ...authenticatedHeaders,
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
        },
        body: JSON.stringify({ acknowledged: true }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await json(response)).isAcknowledged, true);

    openView = JSON.parse(
      await readFile(path.join(privateData, "open_positions.json"), "utf8"),
    );
    closedView = JSON.parse(
      await readFile(path.join(privateData, "closed_trades.json"), "utf8"),
    );
    assert.equal(
      openView.positions.some((position) => position.id === trade.id),
      true,
    );
    assert.equal(
      closedView.trades.some((closedTrade) => closedTrade.id === trade.id),
      false,
    );

    response = await fetch(
      `${baseUrl}/api/manual-trades/${trade.id}/exits/${firstExit.id}`,
      {
        method: "DELETE",
        headers: {
          ...authenticatedHeaders,
          "x-csrf-token": session.csrfToken,
        },
      },
    );
    assert.equal(response.status, 204);

    response = await fetch(`${baseUrl}/api/manual-trades/${trade.id}`, {
      method: "DELETE",
      headers: {
        ...authenticatedHeaders,
        "x-csrf-token": session.csrfToken,
      },
    });
    assert.equal(response.status, 204);

    response = await fetch(`${baseUrl}/api/dashboard`, {
      headers: authenticatedHeaders,
    });
    assert.equal(response.status, 200);
    const unlinkedDashboard = await json(response);
    assert.equal(
      unlinkedDashboard.signalDecisions.decisions.find(
        (item) => item.signalId === "sig-20260617-smh",
      ).manualTradeId,
      null,
    );
    assert.equal(
      unlinkedDashboard.alerts.alerts.find(
        (item) => item.id === "alert-smh-entry",
      ).manualTradeId,
      null,
    );

    response = await fetch(
      `${baseUrl}/api/discord-destinations/${destination.destinationId}`,
      {
        method: "DELETE",
        headers: {
          ...authenticatedHeaders,
          "x-csrf-token": session.csrfToken,
        },
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { deleted: true });

    response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: authenticatedHeaders,
    });
    assert.equal(response.status, 403);

    response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: {
        ...authenticatedHeaders,
        "x-csrf-token": session.csrfToken,
      },
    });
    assert.equal(response.status, 204);
    const clearedCookie = response.headers.get("set-cookie");
    assert.match(clearedCookie ?? "", /ri_session=/);
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    await rm(privateData, { recursive: true, force: true });
  }
});

test("strategy configuration permits admins and rejects non-admin users", async () => {
  for (const role of ["user", "admin"]) {
    const privateData = await mkdtemp(
      path.join(os.tmpdir(), `risky-strategy-role-${role}-`),
    );
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const username = `${role}-integration-user`;
    const password = "correct horse battery staple";
    const usernameFile = path.join(privateData, "test-username");
    const passwordHashFile = path.join(privateData, "test-password-hash");
    const sessionSecretFile = path.join(privateData, "test-session-secret");
    await seedDemoRuntimeData(privateData, { username, role });
    await Promise.all([
      writeFile(usernameFile, username, "utf8"),
      writeFile(passwordHashFile, passwordHash(password), "utf8"),
      writeFile(
        sessionSecretFile,
        "integration-test-secret-that-is-longer-than-32-characters",
        "utf8",
      ),
    ]);
    const child = spawn(process.execPath, ["dist-server/index.js"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        PRIVATE_DATA_DIR: privateData,
        SCANNER_CONFIG_DIR: path.join(privateData, "scanner-config"),
        SCANNER_OUTPUT_DIR: path.join(privateData, "scanner-output"),
        RISKY_INVESTOR_ROLE: role,
        RISKY_INVESTOR_USERNAME_FILE: usernameFile,
        RISKY_INVESTOR_PASSWORD_HASH_FILE: passwordHashFile,
        SESSION_SECRET_FILE: sessionSecretFile,
        RISKY_INVESTOR_CREDENTIAL_ENCRYPTION_KEY:
          "integration-test-credential-encryption-key-at-least-32-bytes",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await waitForServer(child);
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(login.status, 200);
      const session = await login.json();
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      const dashboardResponse = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { cookie },
      });
      assert.equal(dashboardResponse.status, 200);
      const dashboard = await dashboardResponse.json();

      const response = await fetch(
        `${baseUrl}/api/strategy-configuration`,
        {
          method: "PUT",
          headers: {
            cookie,
            "content-type": "application/json",
            "x-csrf-token": session.csrfToken,
          },
          body: JSON.stringify(dashboard.strategyConfiguration),
        },
      );
      assert.equal(response.status, role === "admin" ? 200 : 403);
    } finally {
      child.kill();
      if (child.exitCode === null) {
        await Promise.race([
          once(child, "exit"),
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ]);
      }
      await rm(privateData, { recursive: true, force: true });
    }
  }
});
