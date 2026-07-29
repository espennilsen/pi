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

test("runFirstRunSetup uses pasted discovery URL, confirms loopback, and saves discoveryUrl", async () => {
  const prompts: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const saved: AuthentikStoredSettings[] = [];

  const discoveryUrl = "https://auth.example/application/o/my-app/.well-known/openid-configuration";

  const ui = createUi({
    inputs: [
      discoveryUrl,
      "pi-client",
      "",
      "",
      "https://llm.example/v1",
    ],
    confirms: [true],
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
    saveExchangeClientId: () => {},
    clearExchangeClientId: () => {},
    fetchDiscoveryMetadata: async (url) => {
      assert.equal(url, discoveryUrl);
      return exampleMetadata();
    },
  });

  assert.deepEqual(prompts, ["OIDC discovery URL (OpenID configuration)", "OAuth2 Client ID", "Client secret (leave empty for public client)", "Outpost exchange client ID (provider used for JWT bearer token exchange, leave empty to skip)", "LLM base URL"]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.discoveryUrl, discoveryUrl);
  assert.equal(saved[0]?.authentikHost, undefined);
  assert.equal(saved[0]?.providerSlug, undefined);
  assert.equal(saved[0]?.clientId, "pi-client");
  assert.deepEqual(saved[0]?.scopes, ["openid", "profile", "email", "ak_proxy"]);
  assert.equal(saved[0]?.enableOfflineAccess, true);
  assert.deepEqual(result.settings, saved[0]);
  assert.equal("clientSecret" in saved[0]!, false);
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
      "",
      "https://llm.example/v1",
    ],
    confirms: [true],
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
    saveExchangeClientId: () => {},
    clearExchangeClientId: () => {},
    fetchDiscoveryMetadata: async (url) => {
      assert.match(url, /\/application\/o\/main-provider\/\.well-known\/openid-configuration$/);
      return exampleMetadata();
    },
  });

  assert.deepEqual(prompts, [
    "OIDC discovery URL (OpenID configuration)",
    "Authentik host",
    "Provider slug",
    "OAuth2 Client ID",
    "Client secret (leave empty for public client)",
    "Outpost exchange client ID (provider used for JWT bearer token exchange, leave empty to skip)",
    "LLM base URL",
  ]);
  assert.equal(saved[0]?.authentikHost, "https://auth.example");
  assert.equal(saved[0]?.providerSlug, "main-provider");
  assert.equal(saved[0]?.discoveryUrl, undefined);
});

test("runFirstRunSetup auto-appends /v1 to LLM base URL", async () => {
  const ui = createUi({
    inputs: ["", "https://auth.example", "main-provider", "pi-client", "", "", "https://llm.example/openai"],
    confirms: [true],
  });

  const saved: AuthentikStoredSettings[] = [];

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    saveExchangeClientId: () => {},
    clearExchangeClientId: () => {},
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saved[0]?.llmBaseUrl, "https://llm.example/openai/v1");
  assert.deepEqual(saved[0]?.scopes, ["openid", "profile", "email", "ak_proxy"]);
  assert.equal(saved[0]?.enableOfflineAccess, true);
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
      "",
      "not-a-url",
      "https://llm.example/v1",
    ],
    confirms: [true],
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
    saveExchangeClientId: () => {},
    clearExchangeClientId: () => {},
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saved[0]?.llmBaseUrl, "https://llm.example/v1");
  assert.match(notifications.map(({ message }) => message).join("\n"), /examples?:.*https:\/\/llm\.example\/v1.*https:\/\/llm\.example\/openai\/v1/i);
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

test("runFirstRunSetup persists non-empty clientSecret when provided", async () => {
  const prompts: string[] = [];
  const saved: AuthentikStoredSettings[] = [];
  const secret = "super-secret-confidential-key";
  let savedSecret: string | null = null;
  let clearCalled = false;

  const ui = createUi({
    inputs: ["", "https://auth.example", "provider", "client", secret, "", "https://llm.example/v1"],
    confirms: [true],
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
    saveExchangeClientId: () => {},
    clearExchangeClientId: () => {},
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
    inputs: ["", "https://auth.example", "provider", "client", "   ", "", "https://llm.example/v1"],
    confirms: [true],
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
    saveExchangeClientId: () => {},
    clearExchangeClientId: () => {},
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saved.length, 1);
  assert.equal(savedSecret, null);
  assert.equal(clearCalled, true);
  assert.equal("clientSecret" in saved[0]!, false);
});

test("runFirstRunSetup persists non-empty exchangeClientId when provided", async () => {
  const saved: AuthentikStoredSettings[] = [];
  const exchangeId = "exchange-client-123";
  let savedExchangeId: string | null = null;
  let clearExchangeCalled = false;

  const ui = createUi({
    inputs: ["", "https://auth.example", "provider", "client", "", exchangeId, "https://llm.example/v1"],
    confirms: [true],
  });

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    saveExchangeClientId(value) {
      savedExchangeId = value;
    },
    clearExchangeClientId() {
      clearExchangeCalled = true;
    },
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saved.length, 1);
  assert.equal(savedExchangeId, exchangeId);
  assert.equal(clearExchangeCalled, false);
  assert.equal("exchangeClientId" in saved[0]!, false);
  assert.equal(saved[0]!.clientId, "client");
});

test("runFirstRunSetup does not persist whitespace-only exchangeClientId", async () => {
  const saved: AuthentikStoredSettings[] = [];
  let savedExchangeId: string | null = null;
  let clearExchangeCalled = false;

  const ui = createUi({
    inputs: ["", "https://auth.example", "provider", "client", "", "   ", "https://llm.example/v1"],
    confirms: [true],
  });

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    saveClientSecret: () => {},
    clearClientSecret: () => {},
    saveExchangeClientId(value) {
      savedExchangeId = value;
    },
    clearExchangeClientId() {
      clearExchangeCalled = true;
    },
    fetchDiscoveryMetadata: async () => exampleMetadata(),
  });

  assert.equal(saved.length, 1);
  assert.equal(savedExchangeId, null);
  assert.equal(clearExchangeCalled, true);
  assert.equal("exchangeClientId" in saved[0]!, false);
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
