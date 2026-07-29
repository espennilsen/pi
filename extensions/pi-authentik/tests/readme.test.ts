import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const extensionDir = path.resolve(import.meta.dirname);

function readDoc(name: string): string {
  const relPath = name === "README.md" || name === ".env.example"
    ? path.join("..", name)
    : path.join("../docs", name);
  return fs.readFileSync(path.resolve(extensionDir, relPath), "utf8");
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

test("AUTHENTIK_SETUP includes the anchored loopback redirect regex pattern", () => {
  const setup = readDoc("AUTHENTIK_SETUP.md");

  // The exact regex pattern must appear in the doc
  assert.match(setup, /\^http:\/\/127\\\.0\\\.0\\\.1:\\d\+\/callback\$/);
});

test("AUTHENTIK_SETUP explains that the regex is anchored and restricts to 127.0.0.1 only", () => {
  const setup = readDoc("AUTHENTIK_SETUP.md");

  // Doc must explain the anchoring and host restriction
  assert.match(setup, /anchored/i);
  assert.match(setup, /127\.0\.0\.1.*only/i);
  assert.match(setup, /((not|excluded|is not allowed|is excluded).*localhost)|(localhost.*(not|excluded|is not allowed|is excluded))/i);
  assert.match(setup, /one or more digits/i); // Doc describes \d+ for port
});

// Regex behaviour tests: the pattern documented in AUTHENTIK_SETUP.md is
//   ^http://127\.0\.0\.1:\d+/callback$
// These tests confirm the regex behaves exactly as the documentation describes.
const LOOPBACK_REDIRECT_REGEX = /^http:\/\/127\.0\.0\.1:\d+\/callback$/;

test("loopback redirect regex matches a standard callback URI with a high port number", () => {
  assert.match("http://127.0.0.1:12345/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex matches port 80", () => {
  assert.match("http://127.0.0.1:80/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex matches a single-digit port (minimum digits)", () => {
  assert.match("http://127.0.0.1:1/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex matches the highest valid port number 65535", () => {
  assert.match("http://127.0.0.1:65535/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects https scheme", () => {
  assert.doesNotMatch("https://127.0.0.1:12345/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects localhost hostname", () => {
  assert.doesNotMatch("http://localhost:12345/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects IPv6 loopback address", () => {
  assert.doesNotMatch("http://[::1]:12345/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects 0.0.0.0 (all-interfaces) address", () => {
  assert.doesNotMatch("http://0.0.0.0:12345/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects empty port (no digits)", () => {
  assert.doesNotMatch("http://127.0.0.1:/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects non-digit port characters", () => {
  assert.doesNotMatch("http://127.0.0.1:abc/callback", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects trailing slash after /callback", () => {
  assert.doesNotMatch("http://127.0.0.1:12345/callback/", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects extra path segment after /callback", () => {
  assert.doesNotMatch("http://127.0.0.1:12345/callback/extra", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects wrong path", () => {
  assert.doesNotMatch("http://127.0.0.1:12345/", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects uppercase CALLBACK path", () => {
  assert.doesNotMatch("http://127.0.0.1:12345/CALLBACK", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects a query string appended to the callback URI", () => {
  assert.doesNotMatch("http://127.0.0.1:12345/callback?foo=bar", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects an empty string", () => {
  assert.doesNotMatch("", LOOPBACK_REDIRECT_REGEX);
});

test("loopback redirect regex rejects URI with no port separator", () => {
  assert.doesNotMatch("http://127.0.0.1/callback", LOOPBACK_REDIRECT_REGEX);
});

test("LLM endpoint docs cover base URL rules, settings examples, and troubleshooting", () => {
  const setup = readDoc("LLM_ENDPOINT_SETUP.md");


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
