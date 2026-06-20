import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultDashboardAppearance,
  normaliseDashboardAppearance,
} from "../dist-server/dashboardAppearance.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function passwordHash(password) {
  const salt = "appearance-test-salt";
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
      if (output.includes("private server listening")) finish();
      else if (child.exitCode !== null) {
        finish(new Error(`Server exited before startup.\n${output}\n${errors}`));
      }
    }, 25);
    const timeout = setTimeout(
      () =>
        finish(new Error(`Server startup timed out.\n${output}\n${errors}`)),
      10_000,
    );
  });
}

test("dashboard appearance defaults safely and accepts only curated values", () => {
  assert.deepEqual(
    normaliseDashboardAppearance(undefined),
    defaultDashboardAppearance,
  );
  assert.deepEqual(
    normaliseDashboardAppearance({
      theme: "ocean",
      density: "compact",
    }),
    {
      theme: "ocean",
      density: "compact",
    },
  );
  assert.deepEqual(
    normaliseDashboardAppearance({
      theme: "custom-neon",
      density: "tiny",
    }),
    {
      theme: "midnight",
      density: "comfortable",
    },
  );
});

test("appearance is private, defaults without rewriting, and persists safely", async () => {
  const privateData = await mkdtemp(path.join(os.tmpdir(), "risky-appearance-"));
  const username = "appearance-owner";
  const password = "appearance-test-password";
  const settingsPath = path.join(privateData, "settings.json");
  const originalSettings = `${JSON.stringify(
    {
      isExample: false,
      assumedMissedStake: 1250,
      riskLimits: {
        maxTickerPct: 25,
        maxTechnologyPct: 60,
        maxSpeculativePct: 10,
        maxLeveraged3xPct: 35,
        minimumCashPct: 10,
        elevatedDrawdownPct: 12,
      },
    },
    null,
    2,
  )}\n`;
  await writeFile(settingsPath, originalSettings, "utf8");
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["dist-server/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      PRIVATE_DATA_DIR: privateData,
      SCANNER_EXPORT_DIR: path.join(privateData, "absent-scanner-export"),
      RISKY_INVESTOR_USERNAME_FILE: "",
      RISKY_INVESTOR_USERNAME: username,
      RISKY_INVESTOR_PASSWORD_HASH_FILE: "",
      RISKY_INVESTOR_PASSWORD_HASH: passwordHash(password),
      SESSION_SECRET_FILE: "",
      SESSION_SECRET:
        "appearance-test-session-secret-longer-than-thirty-two-characters",
      RISKY_INVESTOR_CREDENTIAL_ENCRYPTION_KEY_FILE: "",
      RISKY_INVESTOR_CREDENTIAL_ENCRYPTION_KEY:
        "appearance-test-credential-encryption-key-32-bytes-minimum",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);
    let response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200);
    const session = await response.json();
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    response = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    const dashboard = await response.json();
    assert.deepEqual(
      dashboard.settings.appearance,
      defaultDashboardAppearance,
    );
    assert.equal(await readFile(settingsPath, "utf8"), originalSettings);

    response = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({
        ...dashboard.settings,
        appearance: { theme: "ocean", density: "compact" },
      }),
    });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.deepEqual(updated.appearance, {
      theme: "ocean",
      density: "compact",
    });
    assert.equal(updated.assumedMissedStake, 1250);
    assert.equal(updated.riskLimits.maxTickerPct, 25);

    response = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).settings.appearance, {
      theme: "ocean",
      density: "compact",
    });
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
