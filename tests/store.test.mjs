import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStore } from "../dist-server/store.js";

test("JsonStore keeps reads and writes inside the configured private root", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "risky-investor-store-"));
  const root = path.join(parent, "private");
  const sibling = path.join(parent, "private-escape");
  const store = new JsonStore(root);

  try {
    await store.write("nested/value.json", { safe: true });
    assert.deepEqual(await store.read("nested/value.json"), { safe: true });

    await assert.rejects(
      store.write("../private-escape/leak.json", { safe: false }),
      /Invalid data path/,
    );
    await assert.rejects(
      store.read("../private-escape/leak.json"),
      /Invalid data path/,
    );
    await assert.rejects(readFile(path.join(sibling, "leak.json"), "utf8"));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("JsonStore initialises only missing files and never replaces malformed JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "risky-store-init-"));
  const store = new JsonStore(root);
  const existingPath = path.join(root, "existing.json");
  const malformedPath = path.join(root, "malformed.json");
  const existing = '{\n  "preserved": true,\n  "spacing": "exact"\n}\n';
  const malformed = '{"broken":';

  try {
    await Promise.all([
      writeFile(existingPath, existing, "utf8"),
      writeFile(malformedPath, malformed, "utf8"),
    ]);

    assert.equal(await store.ensure("missing.json", []), true);
    assert.equal(await store.ensure("existing.json", { replaced: true }), false);
    assert.equal(await readFile(existingPath, "utf8"), existing);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, "missing.json"), "utf8")), []);

    await assert.rejects(
      store.ensure("malformed.json", { replacement: true }),
      /Invalid JSON.*not modified/,
    );
    assert.equal(await readFile(malformedPath, "utf8"), malformed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
