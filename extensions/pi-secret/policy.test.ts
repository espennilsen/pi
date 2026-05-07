import test from "node:test";
import assert from "node:assert/strict";
import { assertCanAccessSecret, canAccessSecret, listPolicySecrets } from "./policy.ts";

void test("allows manifest-listed extension to access its own declared secret", () => {
  assert.equal(canAccessSecret("elevenlabs-extension", "api_key", "elevenlabs-extension"), true);
});

void test("denies undeclared own secret access by default", () => {
  assert.equal(canAccessSecret("elevenlabs-extension", "unknown", "elevenlabs-extension"), false);
});

void test("denies cross-extension access by default", () => {
  assert.equal(canAccessSecret("elevenlabs-extension", "api_key", "github-extension"), false);
});

void test("throws redacted authorization errors", () => {
  assert.throws(
    () => assertCanAccessSecret("elevenlabs-extension", "api_key", "github-extension"),
    /Access denied.*github-extension.*elevenlabs-extension.*api_key/,
  );
});

void test("lists manifest secrets without values", () => {
  assert.deepEqual(listPolicySecrets().map((s) => `${s.extensionId}:${s.secretName}`).sort(), [
    "elevenlabs-extension:api_key",
    "elevenlabs-extension:voice_id",
    "github-extension:token",
  ]);
});
