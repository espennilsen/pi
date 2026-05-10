import assert from "node:assert/strict";
import test from "node:test";

import { createPiAuthentikExtension } from "../../index.ts";
import type { AuthentikResolvedSettings, AuthentikSessionRecord, AuthentikStoredSettings } from "../shared/types.ts";

const configuredSettings: AuthentikResolvedSettings = {
  authentikHost: "https://auth.example",
  providerSlug: "provider",
  clientId: "pi-client",
  scopes: ["openid", "profile", "email", "offline_access"],
  enableOfflineAccess: true,
  discoveryUrl: null,
  logoutUrl: null,
  llmBaseUrl: "https://llm.example/v1",
  authStorageBackend: null,
  modelFilters: ["gpt-*"],
};

const discoveryOnlySettings: AuthentikResolvedSettings = {
  ...configuredSettings,
  authentikHost: null,
  providerSlug: null,
  discoveryUrl: "https://auth.example/application/o/my-app/.well-known/openid-configuration",
};

test("session_start shows unauthenticated status when configured but no session exists", async () => {
  const harness = createHarness({
    settings: configuredSettings,
    loadStoredSession: async () => null,
  });

  await harness.start();

  assert.equal(harness.statuses.at(-1)?.value, "authentik: not signed in");
  assert.match(harness.notifications.join("\n"), /authentik-login/);
  assert.equal(harness.providers.length, 0);
});

test("session_start shows missing endpoint guidance", async () => {
  const harness = createHarness({
    settings: { ...configuredSettings, llmBaseUrl: null },
  });

  await harness.start();

  assert.equal(harness.statuses.at(-1)?.value, "authentik: missing LLM endpoint");
  assert.match(harness.notifications.join("\n"), /authentik-endpoint|authentik-setup/);
});

test("session_start treats explicit discovery URL without host/slug as fully configured OIDC-wise", async () => {
  const harness = createHarness({
    settings: discoveryOnlySettings,
    loadStoredSession: async () => null,
  });

  await harness.start();

  assert.equal(harness.statuses.at(-1)?.value, "authentik: not signed in");
  assert.match(harness.notifications.join("\n"), /authentik-login/);
  await harness.run("authentik-status");
  assert.match(harness.notifications.join("\n"), /Discovery:/);
});

test("session_start restores stored session, discovers models, filters them, and registers provider", async () => {
  const harness = createHarness({
    settings: configuredSettings,
    loadStoredSession: async () => exampleSession(),
    models: [{ id: "gpt-4.1" }, { id: "other-model" }],
  });

  await harness.start();

  assert.equal(harness.providers.length, 1);
  const provider = harness.providers[0];
  assert.equal(provider.name, "authentik");
  assert.equal(provider.provider.baseUrl, "https://llm.example/v1");
  assert.equal(provider.provider.authHeader, true);
  assert.deepEqual((provider.provider.models as Array<{ id: string }>).map((model) => model.id), ["gpt-4.1"]);
  assert.equal(harness.statuses.at(-1)?.value, "authentik: 1 model");
  assert.equal(harness.clientAuthHeaders[0], "Bearer access-token");
});

test("session_start refreshes an expired stored session when a refresh token exists", async () => {
  const savedSessions: AuthentikSessionRecord[] = [];
  const harness = createHarness({
    settings: configuredSettings,
    now: () => 1_700_000_000_000,
    loadStoredSession: async () => ({
      ...exampleSession(),
      tokens: {
        ...exampleSession().tokens,
        /** Expiry in epoch seconds — before `now` wall clock for refresh skew. */
        expiresAt: 1_699_999_900,
      },
    }),
    refreshSession: async () => ({
      ...exampleSession(),
      tokens: {
        ...exampleSession().tokens,
        accessToken: "refreshed-token",
        expiresAt: 1_700_010_000,
      },
    }),
    saveStoredSession: async (session) => {
      savedSessions.push(session);
    },
    models: [{ id: "gpt-4.1" }],
  });

  await harness.start();

  assert.equal(savedSessions[0]?.tokens.accessToken, "refreshed-token");
  assert.equal(harness.clientAuthHeaders[0], "Bearer refreshed-token");
  assert.match(harness.notifications.join("\n"), /restored session from refresh token/i);
});

test("authentik-setup triggers handleLogin when runFirstRunSetup returns loginRequested: true", async () => {
  let setupCalls = 0;
  let loginCalls = 0;
  const savedSessions: AuthentikSessionRecord[] = [];

  const harness = createHarness({
    settings: configuredSettings,
    loadStoredSession: async () => null,
    runFirstRunSetup: async () => {
      setupCalls += 1;
      return {
        saved: true,
        loginRequested: true,
        settings: {
          authentikHost: configuredSettings.authentikHost ?? undefined,
          providerSlug: configuredSettings.providerSlug ?? undefined,
          clientId: configuredSettings.clientId ?? undefined,
          scopes: configuredSettings.scopes,
          enableOfflineAccess: true,
          llmBaseUrl: configuredSettings.llmBaseUrl ?? undefined,
        },
        connectivityTested: true,
      };
    },
    runBrowserLogin: async () => {
      loginCalls += 1;
      return exampleSession();
    },
    saveStoredSession: async (session) => {
      savedSessions.push(session);
    },
    fetchOidcDiscoveryMetadata: async () => ({
      issuer: "https://auth.example/application/o/provider/",
      authorization_endpoint: "https://auth.example/application/o/authorize/",
      token_endpoint: "https://auth.example/application/o/token/",
      jwks_uri: "https://auth.example/application/o/jwks/",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    }),
    models: [{ id: "gpt-4.1" }],
  });

  await harness.start();
  await harness.run("authentik-setup");

  assert.equal(setupCalls, 1, "runFirstRunSetup should be called once");
  assert.equal(loginCalls, 1, "handleLogin should be called once when loginRequested is true");
  assert.equal(savedSessions.length, 1, "session should be saved after login");
  assert.equal(savedSessions[0]?.tokens.accessToken, "access-token");
  assert.equal(harness.providers.length, 1, "provider should be registered after login");
  assert.match(harness.notifications.join("\n"), /Signed in successfully/);
});

test("commands handle setup, login, status, endpoint, refresh-models, and logout", async () => {
  const savedSettings: AuthentikStoredSettings[] = [];
  const savedSessions: AuthentikSessionRecord[] = [];
  let cleared = 0;
  let setupCalls = 0;
  let loginCalls = 0;
  let logoutOpens = 0;

  const harness = createHarness({
    settings: configuredSettings,
    loadStoredSession: async () => null,
    runFirstRunSetup: async () => {
      setupCalls += 1;
      return {
        saved: true,
        settings: {
          authentikHost: configuredSettings.authentikHost ?? undefined,
          providerSlug: configuredSettings.providerSlug ?? undefined,
          clientId: configuredSettings.clientId ?? undefined,
          scopes: configuredSettings.scopes,
          enableOfflineAccess: true,
          llmBaseUrl: configuredSettings.llmBaseUrl ?? undefined,
        },
        connectivityTested: true,
      };
    },
    saveSettings: async (settings) => {
      savedSettings.push(settings);
    },
    runBrowserLogin: async () => {
      loginCalls += 1;
      return exampleSession();
    },
    saveStoredSession: async (session) => {
      savedSessions.push(session);
    },
    clearStoredSession: async () => {
      cleared += 1;
    },
    fetchOidcDiscoveryMetadata: async () => ({
      issuer: "https://auth.example/application/o/provider/",
      authorization_endpoint: "https://auth.example/application/o/authorize/",
      token_endpoint: "https://auth.example/application/o/token/",
      jwks_uri: "https://auth.example/application/o/jwks/",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      end_session_endpoint: "https://auth.example/application/o/logout/",
    }),
    openUrl: async (url) => {
      if (url.includes("logout")) logoutOpens += 1;
    },
    models: [{ id: "gpt-4.1" }, { id: "gpt-4.1-mini" }],
  });

  await harness.start();
  await harness.run("authentik-setup");
  await harness.run("authentik-login");
  await harness.run("authentik-status");
  await harness.run("authentik-endpoint", "https://new.example/openai/v1");
  harness.setModels([{ id: "gpt-4.1" }, { id: "o3-mini" }]);
  await harness.run("authentik-refresh-models");
  await harness.run("authentik-logout");

  assert.equal(setupCalls, 1);
  assert.equal(loginCalls, 1);
  assert.equal(savedSessions.length, 1);
  assert.equal(savedSettings.at(-1)?.llmBaseUrl, "https://new.example/openai/v1");
  assert.match(harness.notifications.join("\n"), /Configured: yes/);
  assert.equal(harness.providers.length >= 2, true);
  assert.deepEqual((harness.providers.at(-1)?.provider.models as Array<{ id: string }>).map((model) => model.id), ["gpt-4.1"]);
  assert.equal(cleared, 1);
  assert.equal(logoutOpens, 1);
  assert.equal(harness.statuses.at(-1)?.value, "authentik: not signed in");
});

function createHarness(overrides: Partial<DepsOverride> = {}) {
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const notifications: string[] = [];
  const providers: Array<{ name: string; provider: Record<string, unknown> }> = [];
  const clientAuthHeaders: string[] = [];
  const events = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, { handler: (args: string | undefined, ctx: any) => Promise<void> | void }>();
  let currentModels = overrides.models ?? [{ id: "gpt-4.1" }];

  const deps = {
    resolveSettings: async () => overrides.settings ?? configuredSettings,
    runFirstRunSetup: overrides.runFirstRunSetup ?? (async () => ({ saved: true, settings: null, connectivityTested: false })),
    saveSettings: overrides.saveSettings ?? (async () => undefined),
    loadStoredSession: overrides.loadStoredSession ?? (async () => null),
    saveStoredSession: overrides.saveStoredSession ?? (async () => undefined),
    clearStoredSession: overrides.clearStoredSession ?? (async () => undefined),
    fetchOidcDiscoveryMetadata: overrides.fetchOidcDiscoveryMetadata ?? (async () => ({
      issuer: "https://auth.example/application/o/provider/",
      authorization_endpoint: "https://auth.example/application/o/authorize/",
      token_endpoint: "https://auth.example/application/o/token/",
      jwks_uri: "https://auth.example/application/o/jwks/",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    })),
    runBrowserLogin: overrides.runBrowserLogin ?? (async () => exampleSession()),
    exchangeAuthorizationCode: overrides.exchangeAuthorizationCode ?? (async () => exampleSession()),
    refreshSession: overrides.refreshSession ?? (async () => exampleSession()),
    startCallbackServer: overrides.startCallbackServer ?? (async () => ({
      host: "127.0.0.1" as const,
      port: 43123,
      callbackPath: "/callback",
      redirectUri: "http://127.0.0.1:43123/callback",
      waitForCallback: async () => ({ code: "code", state: "state" }),
      close: async () => undefined,
    })),
    createOpenAICompatibleClient: overrides.createOpenAICompatibleClient ?? ((options: { authStrategy?: { apply: (headers: Headers) => void | Promise<void> } }) => ({
      listModels: async () => {
        const headers = new Headers();
        await options.authStrategy?.apply(headers);
        clientAuthHeaders.push(headers.get("authorization") ?? "");
        return currentModels;
      },
      chatCompletion: async () => ({}),
    })),
    validateOpenAIBaseUrl: overrides.validateOpenAIBaseUrl ?? ((value: string) => ({ ok: true as const, normalizedUrl: value })),
    mapOpenAIModelsToProviderModels: overrides.mapOpenAIModelsToProviderModels ?? ((models: Array<{ id: string }>) => models.map((model) => ({
      id: model.id,
      name: model.id,
      reasoning: false,
      input: ["text"] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    }))),
    filterProviderModels: overrides.filterProviderModels ?? ((models: Array<{ id: string }>, filters: string[]) => models.filter((model) => filters.some((filter) => filter === "*" || model.id.startsWith(filter.replace("*", ""))))),
    createPkcePair: overrides.createPkcePair ?? (() => ({ codeVerifier: "verifier", codeChallenge: "challenge", codeChallengeMethod: "S256" as const })),
    generateState: overrides.generateState ?? (() => "state"),
    generateNonce: overrides.generateNonce ?? (() => "nonce"),
    openUrl: overrides.openUrl ?? (async () => undefined),
    now: overrides.now ?? (() => 1_700_000_000_000),
  };

  const pi = {
    on(event: string, handler: (...args: any[]) => any) {
      events.set(event, handler);
    },
    registerCommand(name: string, command: { handler: (args: string | undefined, ctx: any) => Promise<void> | void }) {
      commands.set(name, command);
    },
    registerProvider(name: string, provider: Record<string, unknown>) {
      providers.push({ name, provider });
    },
  };

  createPiAuthentikExtension(pi as never, deps);

  const ctx = {
    cwd: process.cwd(),
    ui: {
      setStatus(key: string, value: string | undefined) {
        statuses.push({ key, value });
      },
      notify(message: string) {
        notifications.push(message);
      },
      async input() {
        return null;
      },
      async confirm() {
        return true;
      },
    },
  };

  return {
    statuses,
    notifications,
    providers,
    clientAuthHeaders,
    setModels(models: Array<{ id: string }>) {
      currentModels = models;
    },
    async start() {
      const handler = events.get("session_start");
      if (!handler) throw new Error("missing session_start handler");
      await handler({}, ctx);
    },
    async run(name: string, args?: string) {
      const command = commands.get(name);
      if (!command) throw new Error(`missing command ${name}`);
      await command.handler(args, ctx);
    },
  };
}

interface DepsOverride {
  settings: AuthentikResolvedSettings;
  loadStoredSession: () => Promise<AuthentikSessionRecord | null>;
  saveStoredSession: (session: AuthentikSessionRecord) => Promise<void>;
  clearStoredSession: () => Promise<void>;
  refreshSession: (...args: any[]) => Promise<AuthentikSessionRecord | null>;
  runBrowserLogin: (...args: any[]) => Promise<AuthentikSessionRecord>;
  exchangeAuthorizationCode: (...args: any[]) => Promise<AuthentikSessionRecord>;
  fetchOidcDiscoveryMetadata: (...args: any[]) => Promise<any>;
  runFirstRunSetup: (...args: any[]) => Promise<any>;
  saveSettings: (settings: AuthentikStoredSettings) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  now: () => number;
  models: Array<{ id: string }>;
  createOpenAICompatibleClient: (options: any) => { listModels(): Promise<Array<{ id: string }>>; chatCompletion(request: unknown): Promise<unknown> };
  validateOpenAIBaseUrl: (value: string) => { ok: true; normalizedUrl: string } | { ok: false; error: string; suggestion?: string };
  mapOpenAIModelsToProviderModels: (models: Array<{ id: string }>) => Array<any>;
  filterProviderModels: (models: Array<{ id: string }>, filters: string[]) => Array<any>;
  createPkcePair: () => { codeVerifier: string; codeChallenge: string; codeChallengeMethod: "S256" };
  generateState: () => string;
  generateNonce: () => string;
  startCallbackServer: (...args: any[]) => Promise<any>;
}

function exampleSession(): AuthentikSessionRecord {
  return {
    tokens: {
      accessToken: "access-token",
      idToken: "id-token",
      tokenType: "Bearer",
      /** Stored in UNIX epoch seconds (`shouldRefresh`, token exchange). */
      expiresAt: 1_700_005_500,
      refreshToken: "refresh-token",
      scope: "openid profile email",
    },
    user: {
      issuer: "https://auth.example/application/o/provider/",
      audience: ["pi-client"],
      subject: "user-123",
      expiresAt: 1_700_005_500,
      nonce: "nonce",
      issuedAt: 1_700_000_000,
      email: "user@example.com",
      name: "Example User",
      preferredUsername: "example",
    },
  };
}
