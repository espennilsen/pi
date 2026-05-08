import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FallbackSecretStore } from "./fallback-store.ts";

async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(await realpath(tmpdir()), "pi-secret-test-"));
}

void test("fallback store writes outside cwd with 0600 file permissions", async () => {
  const root = await makeTempRoot();
  const store = new FallbackSecretStore(root);

  await store.set("ext:test:secret:token", "super-secret");

  assert.equal(await store.get("ext:test:secret:token"), "super-secret");
  const mode = (await stat(store.filePath)).mode & 0o777;
  assert.equal(mode, 0o600);
});

void test("fallback store rejects symlinked secret file", async () => {
  const root = await makeTempRoot();
  const store = new FallbackSecretStore(root);
  await store.set("ext:test:secret:token", "value");
  await chmod(store.filePath, 0o600);

  // The production implementation should reject symlink replacement before reading.
  const fs = await import("node:fs/promises");
  await fs.unlink(store.filePath);
  await fs.symlink(join(root, "elsewhere.json"), store.filePath);

  await assert.rejects(() => store.get("ext:test:secret:token"), /symlink/i);
});

void test("fallback store rejects ancestor symlinks", async () => {
  const root = await makeTempRoot();
  const real = join(root, "real");
  const link = join(root, "link");
  await mkdir(real);
  await symlink(real, link, "dir");

  const store = new FallbackSecretStore(join(link, "secret.json"));
  await assert.rejects(() => store.set("ext:test:secret:token", "value"), /symlink/i);
});

void test("fallback store serializes concurrent mutations", async () => {
  const root = await makeTempRoot();
  const store = new FallbackSecretStore(root);

  await Promise.all([
    store.set("ext:test:secret:first", "one"),
    store.set("ext:test:secret:second", "two"),
  ]);

  assert.equal(await store.get("ext:test:secret:first"), "one");
  assert.equal(await store.get("ext:test:secret:second"), "two");
});
