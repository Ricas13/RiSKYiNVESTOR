import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const username = "startup-test-user";
const password = "startup-test-password";
const runtimeFiles = [
  "account.json",
  "alert_deliveries.json",
  "alerts.json",
  "audit_log.json",
  "cash_flows.json",
  "closed_trades.json",
  "daily_portfolio_snapshots.json",
  "discord_destinations.json",
  "manual_trades.json",
  "model/closed_trades.json",
  "model/latest_summary.json",
  "model/open_trades.json",
  "model/performance.json",
  "model/signals_archive.json",
  "model/signals_today.json",
  "model/site_config.json",
  "model/watchlist_status.json",
  "notification_settings.json",
  "open_positions.json",
  "scanner_import_state.json",
  "settings.json",
  "signal_decisions.json",
  "signal_events.json",
  "strategies.json",
  "wealth_snapshots.json",
];

function passwordHash(value) {
  const salt = "startup-test-salt";
  const hash = scryptSync(value, salt, 64, {
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

function startServer(privateData, port, applicationRoot, extraEnvironment = {}) {
  return spawn(process.execPath, [path.join(projectRoot, "dist-server/index.js")], {
    cwd: applicationRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      PRIVATE_DATA_DIR: privateData,
      SCANNER_EXPORT_DIR: path.join(privateData, "absent-scanner-export"),
      RISKY_INVESTOR_USERNAME: username,
      RISKY_INVESTOR_PASSWORD_HASH: passwordHash(password),
      SESSION_SECRET:
        "startup-test-session-secret-that-is-longer-than-thirty-two-characters",
      RISKY_INVESTOR_CREDENTIAL_ENCRYPTION_KEY_FILE: "",
      RISKY_INVESTOR_CREDENTIAL_ENCRYPTION_KEY:
        "startup-test-credential-encryption-key-32-bytes-minimum",
      ...extraEnvironment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function listFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = relative
      ? path.posix.join(relative.replaceAll("\\", "/"), entry.name)
      : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, child)));
    } else {
      files.push(child);
    }
  }
  return files.sort();
}

function capture(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    output: () => ({ stdout, stderr }),
  };
}

async function waitForHealth(child, baseUrl, output) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const logs = output();
      throw new Error(
        `Server exited before health check.\n${logs.stdout}\n${logs.stderr}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return response;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const logs = output();
  throw new Error(`Health check timed out.\n${logs.stdout}\n${logs.stderr}`);
}

async function stopServer(child) {
  child.kill();
  if (child.exitCode === null) {
    await waitForExit(child, 2_000).catch(() => undefined);
  }
}

async function waitForExit(child, timeoutMilliseconds) {
  if (child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      reject(new Error("Server process did not exit."));
    }, timeoutMilliseconds);
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", onExit);
  });
}

async function loginAndLoadDashboard(baseUrl) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("ri_session="));
  assert.equal(session.authenticated, true);
  assert.equal(session.username, username);

  const response = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { cookie },
  });
  return { response, dashboard: await response.json() };
}

test("production startup refuses missing or short credential encryption keys", async () => {
  for (const supplied of ["", "too-short"]) {
    const privateData = await mkdtemp(
      path.join(os.tmpdir(), "risky-key-failure-"),
    );
    const applicationRoot = await mkdtemp(
      path.join(os.tmpdir(), "risky-key-failure-app-"),
    );
    const port = await availablePort();
    const child = startServer(privateData, port, applicationRoot, {
      RISKY_INVESTOR_CREDENTIAL_ENCRYPTION_KEY: supplied,
    });
    const logs = capture(child);
    try {
      await waitForExit(child, 5_000);
      assert.notEqual(child.exitCode, 0);
      const output = logs.output();
      assert.match(
        `${output.stdout}\n${output.stderr}`,
        /credential encryption key/i,
      );
      assert.doesNotMatch(
        `${output.stdout}\n${output.stderr}`,
        /too-short/,
      );
    } finally {
      await stopServer(child);
      await rm(privateData, { recursive: true, force: true });
      await rm(applicationRoot, { recursive: true, force: true });
    }
  }
});

test("production startup supports an authenticated dashboard load from empty private data", async () => {
  const privateData = await mkdtemp(path.join(os.tmpdir(), "risky-empty-"));
  const applicationRoot = await mkdtemp(
    path.join(os.tmpdir(), "risky-empty-app-"),
  );
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = startServer(privateData, port, applicationRoot);
  const logs = capture(child);

  try {
    const response = await waitForHealth(
      child,
      baseUrl,
      logs.output,
    );
    assert.deepEqual(await response.json(), { status: "ok" });
    const authenticated = await loginAndLoadDashboard(baseUrl);
    assert.equal(authenticated.response.status, 200);
    const dashboard = authenticated.dashboard;
    assert.equal(dashboard.account.account.username, username);
    assert.equal(dashboard.account.account.role, "owner");
    assert.equal(dashboard.manualTrades.isExample, false);
    assert.deepEqual(dashboard.manualTrades.trades, []);
    assert.deepEqual(dashboard.wealthSnapshots.snapshots, []);
    assert.deepEqual(dashboard.cashFlows.cashFlows, []);
    assert.deepEqual(dashboard.strategies.strategies, []);
    assert.deepEqual(dashboard.signalDecisions.decisions, []);
    assert.deepEqual(dashboard.alerts.alerts, []);
    assert.deepEqual(dashboard.signalEvents.events, []);
    assert.deepEqual(dashboard.signalArchive, []);
    assert.deepEqual(dashboard.signals, []);
    assert.deepEqual(dashboard.watchlist, []);
    assert.deepEqual(dashboard.openTrades, []);
    assert.deepEqual(dashboard.closedTrades.trades, []);
    assert.equal(dashboard.summary.dataStatus, "Awaiting scanner data");
    assert.equal(dashboard.summary.entrySignalsToday, 0);
    assert.equal(dashboard.summary.exitSignalsToday, 0);
    assert.equal(dashboard.performance.realisedModelPL, 0);
    assert.equal(dashboard.performance.closedTrades, 0);
    assert.deepEqual(dashboard.performance.realisedSeries, []);
    assert.equal(dashboard.scannerImport.status, "awaiting");
    assert.equal(dashboard.scannerImport.summary, "Awaiting scanner data");
    assert.equal(dashboard.latestPortfolioSnapshot, null);
    assert.equal(dashboard.notifications.settings.discord.enabled, false);
    assert.equal(dashboard.notifications.settings.dailySummary.enabled, false);
    assert.deepEqual(dashboard.notifications.deliveries, []);
    assert.equal(dashboard.dailyPL.actualDailyPL, 0);
    assert.equal(dashboard.dailyPL.modelTotalPLPercent, 0);

    assert.deepEqual(await listFiles(privateData), runtimeFiles);
    assert.equal(
      (await listFiles(privateData)).some((file) =>
        file.endsWith(".example.json"),
      ),
      false,
    );
    assert.deepEqual(await listFiles(applicationRoot), []);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(privateData, "signal_events.json"))),
      [],
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(
          path.join(privateData, "daily_portfolio_snapshots.json"),
        ),
      ),
      [],
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(privateData, "alert_deliveries.json"))),
      [],
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(privateData, "audit_log.json"))),
      [],
    );
    const scanner = JSON.parse(
      await readFile(path.join(privateData, "scanner_import_state.json")),
    );
    assert.equal(scanner.status, "awaiting");
    assert.equal(scanner.summary, "Awaiting scanner data");
    assert.deepEqual(scanner.watchlist, []);
    const notifications = JSON.parse(
      await readFile(path.join(privateData, "notification_settings.json")),
    );
    assert.equal(notifications.discord.enabled, false);
    assert.equal(notifications.dailySummary.enabled, false);
    assert.equal(
      notifications.migration.canonicalDashboardDiscordEnabled,
      false,
    );
  } finally {
    await stopServer(child);
    await rm(privateData, { recursive: true, force: true });
    await rm(applicationRoot, { recursive: true, force: true });
  }
});

test("production startup preserves an older private-data structure and creates only missing files", async () => {
  const privateData = await mkdtemp(path.join(os.tmpdir(), "risky-older-"));
  const applicationRoot = await mkdtemp(
    path.join(os.tmpdir(), "risky-older-app-"),
  );
  const signalEvents = "[\n]\n";
  const manualTrades =
    '{\n  "isExample": false,\n  "trades": []\n}\n';
  const notificationSettings =
    '{\n  "version": 2,\n  "discord": { "enabled": false },\n  "preserved": true\n}\n';
  const legacyDeliveries =
    '{\n  "version": 2,\n  "isExample": false,\n  "deliveries": []\n}\n';
  await Promise.all([
    writeFile(
      path.join(privateData, "signal_events.json"),
      signalEvents,
      "utf8",
    ),
    writeFile(
      path.join(privateData, "manual_trades.json"),
      manualTrades,
      "utf8",
    ),
    writeFile(
      path.join(privateData, "notification_settings.json"),
      notificationSettings,
      "utf8",
    ),
    writeFile(
      path.join(privateData, "notification_deliveries.json"),
      legacyDeliveries,
      "utf8",
    ),
  ]);
  const before = await listFiles(privateData);
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = startServer(privateData, port, applicationRoot);
  const logs = capture(child);

  try {
    const response = await waitForHealth(
      child,
      baseUrl,
      logs.output,
    );
    assert.equal(response.status, 200);
    const authenticated = await loginAndLoadDashboard(baseUrl);
    assert.equal(authenticated.response.status, 200);
    assert.deepEqual(authenticated.dashboard.manualTrades.trades, []);
    assert.equal(authenticated.dashboard.scannerImport.status, "awaiting");
    assert.equal(
      await readFile(path.join(privateData, "signal_events.json"), "utf8"),
      signalEvents,
    );
    assert.equal(
      await readFile(path.join(privateData, "manual_trades.json"), "utf8"),
      manualTrades,
    );
    assert.equal(
      await readFile(
        path.join(privateData, "notification_settings.json"),
        "utf8",
      ),
      notificationSettings,
    );
    assert.equal(
      await readFile(
        path.join(privateData, "notification_deliveries.json"),
        "utf8",
      ),
      legacyDeliveries,
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(privateData, "alert_deliveries.json"))),
      JSON.parse(legacyDeliveries),
    );
    const after = await listFiles(privateData);
    assert.deepEqual(
      after.filter((file) => !before.includes(file)),
      runtimeFiles.filter(
        (file) =>
          file !== "signal_events.json" &&
          file !== "manual_trades.json" &&
          file !== "notification_settings.json",
      ),
    );
  } finally {
    await stopServer(child);
    await rm(privateData, { recursive: true, force: true });
    await rm(applicationRoot, { recursive: true, force: true });
  }
});

test("production startup fails clearly without replacing malformed private JSON", async () => {
  const privateData = await mkdtemp(path.join(os.tmpdir(), "risky-malformed-"));
  const applicationRoot = await mkdtemp(
    path.join(os.tmpdir(), "risky-malformed-app-"),
  );
  const malformed = '{"status":';
  const malformedPath = path.join(privateData, "scanner_import_state.json");
  await writeFile(malformedPath, malformed, "utf8");
  const port = await availablePort();
  const child = startServer(privateData, port, applicationRoot);
  const logs = capture(child);

  try {
    await waitForExit(child, 10_000);
    const output = logs.output();
    assert.notEqual(child.exitCode, 0);
    assert.match(output.stderr, /scanner_import_state\.json/);
    assert.match(output.stderr, /not modified/);
    assert.equal(await readFile(malformedPath, "utf8"), malformed);
    assert.deepEqual(await readdir(privateData), ["scanner_import_state.json"]);
  } finally {
    await stopServer(child);
    await rm(privateData, { recursive: true, force: true });
    await rm(applicationRoot, { recursive: true, force: true });
  }
});
