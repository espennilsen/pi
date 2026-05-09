import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const extensionDir = path.resolve(import.meta.dirname);

function readDoc(name: string): string {
  return fs.readFileSync(path.join(extensionDir, name), "utf8");
}

test("README covers setup, commands, /v1, troubleshooting, pi-secret storage, and settings-based config", () => {
  const readme = readDoc("README.md");

  assert.match(readme, /## Setup/i);
  assert.match(readme, /\/authentik-setup/i);
  assert.match(readme, /\/authentik-login/i);
  assert.match(readme, /loopback redirect/i);
  assert.match(readme, /\/v1/i);
  assert.match(readme, /troubleshooting/i);
  assert.match(readme, /pi-secret/i);
  assert.match(readme, /settings/i);
  assert.doesNotMatch(readme, /Quick start with environment variables/i);
});

test("AUTHENTIK_SETUP documents redirect URI, required scopes, and settings-based config", () => {
  const setup = readDoc("AUTHENTIK_SETUP.md");

  assert.match(setup, /127\.0\.0\.1/i);
  assert.match(setup, /loopback redirect/i);
  assert.match(setup, /openid/i);
  assert.match(setup, /profile/i);
  assert.match(setup, /email/i);
  assert.match(setup, /offline_access/i);
  assert.match(setup, /Pi settings/i);
});

test("LLM endpoint docs cover base URL rules, settings examples, and troubleshooting", () => {
  const setup = readDoc("LLM_ENDPOINT_SETUP.md");

  assert.match(setup, /OpenAI-compatible/i);
  assert.match(setup, /must end with \/v1/i);
  assert.match(setup, /\/models/i);
  assert.match(setup, /troubleshooting/i);
  assert.match(setup, /https:\/\/.*\/v1/i);
  assert.match(setup, /modelFilters/i);
});

test(".env.example explicitly says env vars are not supported and points to settings", () => {
  const envExample = readDoc(".env.example");

  assert.match(envExample, /does not read environment variables/i);
  assert.match(envExample, /"pi-authentik"/i);
  assert.match(envExample, /"authentikHost"/i);
  assert.match(envExample, /"llmBaseUrl"/i);
});
