import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
