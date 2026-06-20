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
import {
  buildDataStatusReport,
  cleanupDemoData,
} from "../dist-server/dataStatus.js";
import { initialiseRuntimeData } from "../dist-server/runtimeData.js";
import { JsonStore } from "../dist-server/store.js";
import { seedDemoRuntimeData } from "./fixtures/runtime-fixtures.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const account = {
  username: "cleanup-owner",
  role: "owner",
};

async function seedDemoFixtures(root) {
  return seedDemoRuntimeData(root, account);
}

async function emptyStore(root, role = "owner") {
  const store = new JsonStore(root);
  await initialiseRuntimeData(store, {
    username: account.username,
    role,
  });
  return store;
}

test("demo-only data is reported, cleaned, audited, and leaves truthful empty model state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-demo-cleanup-"));
  try {
    const store = await seedDemoFixtures(root);
    const before = await buildDataStatusReport(store, account);
    assert.equal(before.hasDemoData, true);
    assert.ok(before.totals.demo > 0);
    assert.equal(
      before.areas.find((area) => area.id === "manual-trades")?.classification,
      "Demo",
    );
    assert.equal(
      before.areas.find((area) => area.id === "model-performance")?.classification,
      "Demo",
    );

    const result = await cleanupDemoData(store, account);
    assert.equal(result.cleaned, true);
    assert.ok(result.totalRemoved > 0);
    assert.deepEqual((await store.read("manual_trades.json")).trades, []);
    assert.deepEqual((await store.read("wealth_snapshots.json")).snapshots, []);
    assert.deepEqual((await store.read("cash_flows.json")).cashFlows, []);
    assert.deepEqual(await store.read("model/open_trades.json"), []);
    assert.deepEqual((await store.read("model/closed_trades.json")).trades, []);
    assert.deepEqual(await store.read("model/signals_archive.json"), []);
    assert.deepEqual(await store.read("model/watchlist_status.json"), []);
    assert.equal(
      (await store.read("model/performance.json")).closedTrades,
      0,
    );
    assert.equal(
      (await store.read("model/site_config.json")).backtests.baseline.startingCapital,
      0,
    );
    assert.equal((await store.read("scanner_import_state.json")).status, "awaiting");
    const audit = await store.read("audit_log.json");
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "demo-data-cleanup");
    assert.equal(audit[0].totalRemoved, result.totalRemoved);

    const after = await buildDataStatusReport(store, account);
    assert.equal(after.hasDemoData, false);
    assert.equal(after.totals.demo, 0);
    assert.equal(
      after.areas.find((area) => area.id === "model-performance")?.classification,
      "Empty",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mixed data removes only explicit demo records and preserves genuine owner fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-mixed-cleanup-"));
  try {
    const store = await emptyStore(root);
    const genuineTrade = {
      id: "owner-trade-1",
      strategyName: "Owner strategy",
      ticker: "REAL.L",
      quantity: 3,
      notes: "Keep this exact owner note.",
      exits: [],
      nested: { preserved: true },
    };
    const genuineSnapshot = {
      id: "owner-snapshot-1",
      date: "2026-06-19",
      totalPortfolioValue: 4321.09,
      cashBalance: 321.09,
      investedValue: 4000,
      notes: "Owner snapshot",
    };
    const genuineFlow = {
      id: "owner-flow-1",
      date: "2026-06-19",
      type: "deposit",
      amount: 250,
      notes: "Owner deposit",
    };
    await Promise.all([
      store.write("manual_trades.json", {
        isExample: false,
        trades: [
          { id: "demo-trade", isExample: true, quantity: 1, exits: [] },
          genuineTrade,
        ],
      }),
      store.write("wealth_snapshots.json", {
        isExample: false,
        snapshots: [
          { id: "demo-snapshot", isDemo: true },
          genuineSnapshot,
        ],
      }),
      store.write("cash_flows.json", {
        isExample: false,
        cashFlows: [{ id: "demo-flow", dataStatus: "demo" }, genuineFlow],
      }),
    ]);

    const report = await buildDataStatusReport(store, account);
    assert.equal(
      report.areas.find((area) => area.id === "manual-trades")?.classification,
      "Mixed",
    );
    await cleanupDemoData(store, account);
    assert.deepEqual((await store.read("manual_trades.json")).trades, [
      genuineTrade,
    ]);
    assert.deepEqual((await store.read("wealth_snapshots.json")).snapshots, [
      genuineSnapshot,
    ]);
    assert.deepEqual((await store.read("cash_flows.json")).cashFlows, [
      genuineFlow,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown historical data is surfaced for review and never removed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-unknown-cleanup-"));
  try {
    const store = await emptyStore(root);
    const unknownPerformance = {
      realisedModelPL: 11.25,
      averageClosedTrade: 2.5,
      medianClosedTrade: 1.75,
      winRate: 51,
      closedTrades: 7,
      fixedStakeEquivalent: 1112.5,
      realisedSeries: [{ date: "custom", value: 11.25 }],
      yearlyPL: [],
      winLoss: [],
      openTradePL: [],
      ownerAnnotation: "Unmarked import; review manually.",
    };
    await store.write("model/performance.json", unknownPerformance);
    const report = await buildDataStatusReport(store, account);
    assert.equal(
      report.areas.find((area) => area.id === "model-performance")
        ?.classification,
      "Unknown — requires review",
    );
    const result = await cleanupDemoData(store, account);
    assert.equal(result.cleaned, false);
    assert.deepEqual(
      await store.read("model/performance.json"),
      unknownPerformance,
    );
    assert.deepEqual(await store.read("audit_log.json"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empty data reports truthful empty onboarding states", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-empty-cleanup-"));
  try {
    const store = await emptyStore(root);
    const report = await buildDataStatusReport(store, account);
    assert.equal(report.hasDemoData, false);
    assert.equal(report.totals.demo, 0);
    for (const areaId of [
      "manual-trades",
      "portfolio-snapshots",
      "cash-flows",
      "signal-history",
      "alerts-deliveries",
      "model-performance",
      "model-trades",
      "watchlist-status",
      "strategy-definitions",
    ]) {
      assert.equal(
        report.areas.find((area) => area.id === areaId)?.classification,
        "Empty",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed JSON aborts before any cleanup write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-malformed-cleanup-"));
  try {
    const store = await seedDemoFixtures(root);
    const manualPath = path.join(root, "manual_trades.json");
    const auditPath = path.join(root, "audit_log.json");
    const beforeManual = await readFile(manualPath, "utf8");
    const beforeAudit = await readFile(auditPath, "utf8");
    await writeFile(path.join(root, "model", "performance.json"), '{"broken":', "utf8");

    await assert.rejects(
      cleanupDemoData(store, account),
      /Invalid JSON.*performance\.json.*not modified/,
    );
    assert.equal(await readFile(manualPath, "utf8"), beforeManual);
    assert.equal(await readFile(auditPath, "utf8"), beforeAudit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime cleanup implementation has no example-file dependency", async () => {
  const source = await readFile(
    path.join(projectRoot, "server", "dataStatus.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /\.example\.json/i);
  assert.doesNotMatch(source, /data[\\/]private/i);
});

function passwordHash(password) {
  const salt = "cleanup-integration-salt";
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
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (output.includes("private server listening")) return;
    if (child.exitCode !== null) {
      throw new Error(`Server exited early.\n${output}\n${errors}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Server startup timed out.\n${output}\n${errors}`);
}

async function stopServer(child) {
  child.kill();
  if (child.exitCode === null) {
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

async function startServer(privateData, role) {
  const port = await availablePort();
  const username = `cleanup-${role}`;
  const password = "cleanup-test-password";
  const child = spawn(process.execPath, ["dist-server/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      PRIVATE_DATA_DIR: privateData,
      SCANNER_EXPORT_DIR: path.join(privateData, "absent-scanner"),
      RISKY_INVESTOR_USERNAME: username,
      RISKY_INVESTOR_PASSWORD_HASH: passwordHash(password),
      RISKY_INVESTOR_ROLE: role,
      SESSION_SECRET:
        "cleanup-integration-session-secret-longer-than-thirty-two-characters",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(child);
  return {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
    username,
    password,
  };
}

async function login(server) {
  const response = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: server.username,
      password: server.password,
    }),
  });
  assert.equal(response.status, 200);
  return {
    session: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

test("cleanup routes enforce authentication, role, CSRF, preview, backup, and typed confirmation", async () => {
  const ownerData = await mkdtemp(path.join(os.tmpdir(), "risky-owner-route-"));
  const userData = await mkdtemp(path.join(os.tmpdir(), "risky-user-route-"));
  const ownerStore = await seedDemoFixtures(ownerData);
  await emptyStore(userData, "user");
  const ownerServer = await startServer(ownerData, "owner");
  const userServer = await startServer(userData, "user");

  try {
    let response = await fetch(`${ownerServer.baseUrl}/api/data-cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "REMOVE DEMO DATA" }),
    });
    assert.equal(response.status, 401);

    const user = await login(userServer);
    response = await fetch(`${userServer.baseUrl}/api/data-cleanup/preview`, {
      headers: { cookie: user.cookie },
    });
    assert.equal(response.status, 403);
    response = await fetch(`${userServer.baseUrl}/api/data-cleanup`, {
      method: "POST",
      headers: {
        cookie: user.cookie,
        "content-type": "application/json",
        "x-csrf-token": user.session.csrfToken,
      },
      body: JSON.stringify({ confirmation: "REMOVE DEMO DATA" }),
    });
    assert.equal(response.status, 403);

    const owner = await login(ownerServer);
    response = await fetch(`${ownerServer.baseUrl}/api/data-cleanup/backup`, {
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.status, 400);

    response = await fetch(`${ownerServer.baseUrl}/api/data-cleanup/preview`, {
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.report.hasDemoData, true);
    assert.equal(preview.backupDownloaded, false);
    assert.ok(preview.report.totals.demo > 0);

    response = await fetch(`${ownerServer.baseUrl}/api/data-cleanup/backup`, {
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.status, 200);
    const backup = await response.json();
    assert.equal(backup.format, "risky-investor-backup");
    assert.ok(backup.data.modelPerformance);
    assert.equal("notificationCredentials" in backup.data, false);

    response = await fetch(`${ownerServer.baseUrl}/api/data-cleanup`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmation: "REMOVE DEMO DATA" }),
    });
    assert.equal(response.status, 403);

    response = await fetch(`${ownerServer.baseUrl}/api/data-cleanup`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
        "x-csrf-token": owner.session.csrfToken,
      },
      body: JSON.stringify({ confirmation: "remove demo data" }),
    });
    assert.equal(response.status, 400);

    response = await fetch(`${ownerServer.baseUrl}/api/data-cleanup`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
        "x-csrf-token": owner.session.csrfToken,
      },
      body: JSON.stringify({ confirmation: "REMOVE DEMO DATA" }),
    });
    assert.equal(response.status, 200);
    const cleanup = await response.json();
    assert.equal(cleanup.cleaned, true);
    assert.equal(cleanup.report.hasDemoData, false);

    response = await fetch(`${ownerServer.baseUrl}/api/dashboard`, {
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.status, 200);
    const dashboard = await response.json();
    assert.deepEqual(dashboard.manualTrades.trades, []);
    assert.deepEqual(dashboard.wealthSnapshots.snapshots, []);
    assert.deepEqual(dashboard.cashFlows.cashFlows, []);
    assert.deepEqual(dashboard.openTrades, []);
    assert.deepEqual(dashboard.closedTrades.trades, []);
    assert.equal(dashboard.performance.closedTrades, 0);
    assert.equal(dashboard.performance.fixedStakeEquivalent, 0);
    assert.equal(dashboard.config.backtests.baseline.startingCapital, 0);
    assert.equal(dashboard.scannerImport.status, "awaiting");
    assert.equal(dashboard.dataStatus.hasDemoData, false);

    response = await fetch(`${ownerServer.baseUrl}/`, {
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<div id="root"><\/div>/);
    assert.equal((await ownerStore.read("audit_log.json")).length, 1);
  } finally {
    await stopServer(ownerServer.child);
    await stopServer(userServer.child);
    await rm(ownerData, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});

test("demo fixture seeding creates no runtime example filenames", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-no-example-name-"));
  try {
    await seedDemoFixtures(root);
    async function files(directory) {
      const entries = await readdir(directory, { withFileTypes: true });
      const result = [];
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...(await files(fullPath)));
        else result.push(fullPath);
      }
      return result;
    }
    assert.equal(
      (await files(root)).some((file) => file.endsWith(".example.json")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
