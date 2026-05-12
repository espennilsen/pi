import assert from "node:assert/strict";
import test from "node:test";

import type { OidcDiscoveryMetadata } from "../auth/discovery.ts";
import { runFirstRunSetup, type FirstRunUi } from "../config/first-run.ts";
import type { AuthentikStoredSettings } from "../shared/types.ts";

function exampleMetadata(): OidcDiscoveryMetadata {
  return {
    issuer: "https://auth.example/application/o/provider/",
    authorization_endpoint: "https://auth.example/application/o/authorize/",
    token_endpoint: "https://auth.example/application/o/token/",
    jwks_uri: "https://auth.example/application/o/jwks/",
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"],
    end_session_endpoint: "https://auth.example/application/o/logout/",
  };
}

test("runFirstRunSetup uses pasted discovery URL, confirms redirect URIs, tests endpoint, and saves discoveryUrl", async () => {
  const prompts: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const saved: AuthentikStoredSettings[] = [];
  const connectivityCalls: string[] = [];

  const discoveryUrl = "https://auth.example/application/o/my-app/.well-known/openid-configuration";

  const ui = createUi({
    inputs: [
      discoveryUrl,
      "pi-client",
      "",
      "openid profile email",
      "https://llm.example/v1",
    ],
    confirms: [true, true, true],
    prompts,
    notifications,
  });

  const result = await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    testConnectivity: async (baseUrl) => {
      connectivityCalls.push(baseUrl);
      return { ok: true, normalizedUrl: baseUrl, modelCount: 3 };
    },
    fetchDiscoveryMetadata: async (url) => {
      assert.equal(url, discoveryUrl);
      return exampleMetadata();
    },
  });

  assert.deepEqual(prompts, ["OIDC discovery URL (OpenID configuration)", "Client ID", "Client secret (leave empty for public client)", "Scopes", "LLM base URL"]);
  assert.equal(connectivityCalls[0], "https://llm.example/v1");
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.discoveryUrl, discoveryUrl);
  assert.equal(saved[0]?.authentikHost, undefined);
  assert.equal(saved[0]?.providerSlug, undefined);
  assert.equal(saved[0]?.clientId, "pi-client");
  assert.deepEqual(saved[0]?.scopes, ["openid", "profile", "email"]);
  assert.equal(saved[0]?.enableOfflineAccess, true);
  assert.deepEqual(result.settings, saved[0]);
  assert.equal("clientSecret" in saved[0]!, false);
  assert.match(notifications.map(({ message }) => message).join("\n"), /3 models/i);
  assert.match(notifications.map(({ message }) => message).join("\n"), /issuer:/i);
});

test("runFirstRunSetup falls back to Authentik host + slug when discovery URL blank", async () => {
  const prompts: string[] = [];
  const ui = createUi({
    inputs: [
      "",
      "https://auth.example/",
      "main-provider",
      "pi-client",
      "",
      "openid profile email",
      "https://llm.example/v1",
    ],
    confirms: [true, true, true],
    prompts,
  });

  const saved: AuthentikStoredSettings[] = [];

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    testConnectivity: async (baseUrl) => ({ ok: true, normalizedUrl: baseUrl, modelCount: 3 }),
    fetchDiscoveryMetadata: async (url) => {
      assert.match(url, /\/application\/o\/main-provider\/\.well-known\/openid-configuration$/);
      return exampleMetadata();
    },
  });

  assert.deepEqual(prompts, [
    "OIDC discovery URL (OpenID configuration)",
    "Authentik host",
    "Provider slug",
    "Client ID",
    "Client secret (leave empty for public client)",
    "Scopes",
    "LLM base URL",
  ]);
  assert.equal(saved[0]?.authentikHost, "https://auth.example");
  assert.equal(saved[0]?.providerSlug, "main-provider");
  assert.equal(saved[0]?.discoveryUrl, undefined);
});

test("runFirstRunSetup offers to auto-append /v1 after confirmation", async () => {
  const ui = createUi({
    inputs: ["", "https://auth.example", "main-provider", "pi-client", "", "", "https://llm.example/openai"],
    confirms: [true, false, true, true],
  });

  const saved: AuthentikStoredSettings[] = [];

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    testConnectivity: async (baseUrl) => ({ ok: true, normalizedUrl: baseUrl, modelCount: 1 }),
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saved[0]?.llmBaseUrl, "https://llm.example/openai/v1");
  assert.deepEqual(saved[0]?.scopes, ["openid", "profile", "email"]);
  assert.equal(saved[0]?.enableOfflineAccess, false);
});

test("runFirstRunSetup rejects invalid LLM URLs with helpful examples and retries", async () => {
  const notifications: Array<{ message: string; level: string }> = [];
  const ui = createUi({
    inputs: [
      "",
      "https://auth.example",
      "main-provider",
      "pi-client",
      "",
      "openid,email",
      "not-a-url",
      "https://llm.example/v1",
    ],
    confirms: [true, false, false],
    notifications,
  });

  const saved: AuthentikStoredSettings[] = [];

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    testConnectivity: async (baseUrl) => ({ ok: true, normalizedUrl: baseUrl, modelCount: 1 }),
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saved[0]?.llmBaseUrl, "https://llm.example/v1");
  assert.match(notifications.map(({ message }) => message).join("\n"), /examples?:.*https:\/\/llm\.example\/v1.*https:\/\/llm\.example\/openai\/v1/i);
});

test("runFirstRunSetup offers endpoint test before final save and can skip it", async () => {
  const notifications: Array<{ message: string; level: string }> = [];
  const ui = createUi({
    inputs: [
      "",
      "https://auth.example",
      "main-provider",
      "pi-client",
      "",
      "openid profile email offline_access",
      "https://llm.example/v1",
    ],
    confirms: [true, false, false],
    notifications,
  });

  let connectivityCalled = false;
  let saveCount = 0;

  await runFirstRunSetup({
    ui,
    saveSettings() {
      saveCount += 1;
    },
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    testConnectivity: async () => {
      connectivityCalled = true;
      return { ok: true, normalizedUrl: "https://llm.example/v1", modelCount: 1 };
    },
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(connectivityCalled, false);
  assert.equal(saveCount, 1);
  assert.match(notifications.map(({ message }) => message).join("\n"), /skip.*connectivity test/i);
});

test("runFirstRunSetup does not save when loopback redirect confirmation is declined", async () => {
  const ui = createUi({
    inputs: ["https://auth.example/application/o/x/.well-known/openid-configuration"],
    confirms: [false],
  });

  let saveCount = 0;

  const result = await runFirstRunSetup({
    ui,
    saveSettings() {
      saveCount += 1;
    },
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saveCount, 0);
  assert.equal(result.saved, false);
  assert.equal(result.settings, null);
});
test("runFirstRunSetup returns loginRequested: true when auth redirect detected and user accepts prompt", async () => {
  const ui = createUi({
    inputs: ["", "https://auth.example", "provider", "client", "", "openid", "https://llm.example/v1"],
    confirms: [true, false, true, true], // acknowledge loopback, skip offline, test connectivity, login now
  });

  const result = await runFirstRunSetup({
    ui,
    saveSettings: () => {},
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    testConnectivity: async () => ({
      ok: false,
      error: "Auth required",
      authUrl: "https://auth.example/login",
    }),
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(result.loginRequested, true);
});

test("runFirstRunSetup persists non-empty clientSecret when provided", async () => {
  const prompts: string[] = [];
  const saved: AuthentikStoredSettings[] = [];
  const secret = "super-secret-confidential-key";
  let savedSecret: string | null = null;
  let clearCalled = false;

  const ui = createUi({
    inputs: ["", "https://auth.example", "provider", "client", secret, "openid", "https://llm.example/v1"],
    confirms: [true, false, false], // acknowledge loopback, skip offline, skip connectivity
    prompts,
  });

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    saveClientSecret(value) {
      savedSecret = value;
    },
    clearClientSecret() {
      clearCalled = true;
    },
    testConnectivity: async () => ({ ok: true, normalizedUrl: "https://llm.example/v1", modelCount: 1 }),
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saved.length, 1);
  assert.equal(savedSecret, secret);
  assert.equal(clearCalled, false);
  assert.equal("clientSecret" in saved[0]!, false);
  assert.equal(saved[0]!.clientId, "client");
});

test("runFirstRunSetup does not persist whitespace-only clientSecret", async () => {
  const saved: AuthentikStoredSettings[] = [];
  let savedSecret: string | null = null;
  let clearCalled = false;

  const ui = createUi({
    inputs: ["", "https://auth.example", "provider", "client", "   ", "openid", "https://llm.example/v1"],
    confirms: [true, false, false],
  });

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    saveClientSecret(value) {
      savedSecret = value;
    },
    clearClientSecret() {
      clearCalled = true;
    },
    testConnectivity: async () => ({ ok: true, normalizedUrl: "https://llm.example/v1", modelCount: 1 }),
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saved.length, 1);
  assert.equal(savedSecret, null);
  assert.equal(clearCalled, true);
  assert.equal("clientSecret" in saved[0]!, false);
});

function createUi(options: {
  inputs: string[];
  confirms: boolean[];
  prompts?: string[];
  notifications?: Array<{ message: string; level: string }>;
}): FirstRunUi {
  const inputs = [...options.inputs];
  const confirms = [...options.confirms];
  const prompts = options.prompts ?? [];
  const notifications = options.notifications ?? [];

  return {
    async input(prompt) {
      prompts.push(prompt);
      const value = inputs.shift();
      if (value === undefined) throw new Error(`Unexpected input prompt: ${prompt}`);
      return value;
    },
    async confirm(title, message) {
      notifications.push({ message: `${title}${message ? `: ${message}` : ""}`, level: "confirm" });
      const value = confirms.shift();
      if (value === undefined) throw new Error(`Unexpected confirm prompt: ${title}`);
      return value;
    },
    notify(message, level = "info") {
      notifications.push({ message, level });
    },
  };
}
