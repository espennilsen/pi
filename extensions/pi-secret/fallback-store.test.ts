import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FallbackSecretStore } from "./fallback-store.ts";

void test("fallback store writes outside cwd with 0600 file permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-secret-test-"));
  const store = new FallbackSecretStore(root);

  await store.set("ext:test:secret:token", "super-secret");

  assert.equal(await store.get("ext:test:secret:token"), "super-secret");
  const mode = (await stat(store.filePath)).mode & 0o777;
  assert.equal(mode, 0o600);
});

void test("fallback store rejects symlinked secret file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-secret-test-"));
  const store = new FallbackSecretStore(root);
  await store.set("ext:test:secret:token", "value");
  await chmod(store.filePath, 0o600);

  // The production implementation should reject symlink replacement before reading.
  const fs = await import("node:fs/promises");
  await fs.unlink(store.filePath);
  await fs.symlink(join(root, "elsewhere.json"), store.filePath);

  await assert.rejects(() => store.get("ext:test:secret:token"), /symlink/i);
});
