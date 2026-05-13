import { spawn } from "node:child_process";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { exchangeAuthorizationCode, exchangeJwtBearer, refreshSession as refreshStoredSession, runBrowserLogin } from "./src/auth/auth-client.ts";
import { deriveDiscoveryUrl } from "./src/auth/auth-config.ts";
import { startCallbackServer } from "./src/auth/callback-server.ts";
import { fetchOidcDiscoveryMetadata, type OidcDiscoveryMetadata } from "./src/auth/discovery.ts";
import { validateOpenAIBaseUrl } from "./src/llm/endpoint-validator.ts";
import { runFirstRunSetup } from "./src/config/first-run.ts";
import { createOpenAICompatibleClient } from "./src/llm/llm-client.ts";
import { createLogger } from "./src/shared/logger.ts";
import { filterProviderModels, mapOpenAIModelsToProviderModels, type ProviderModelConfig } from "./src/llm/models.ts";
import { generateNonce, createPkcePair, generateState } from "./src/auth/pkce.ts";
import { createEmptySettings, resolveSettings } from "./src/config/settings.ts";
import { saveCurrentGlobalSettings } from "./src/config/settings-store.ts";
import { clearExchangeClientId, clearStoredSession, loadExchangeClientId, loadStoredSession, saveExchangeClientId, saveStoredSession } from "./src/session/token-store.ts";
import type { AuthentikResolvedSettings, AuthentikSessionRecord, AuthentikStoredSettings } from "./src/shared/types.ts";

export { DEFAULT_MODEL_FILTERS, DEFAULT_SCOPES, canonicalizeLlmBaseUrl, createEmptySettings, resolveSettings } from "./src/config/settings.ts";
export { normalizeOpenAIBaseUrl, testModelsEndpointConnectivity, validateOpenAIBaseUrl } from "./src/llm/endpoint-validator.ts";
export { createOpenAICompatibleClient } from "./src/llm/llm-client.ts";
export { filterProviderModels, mapOpenAIModelToProviderModel, mapOpenAIModelsToProviderModels } from "./src/llm/models.ts";
export type { AuthentikResolvedSettings, AuthentikStoredSettings } from "./src/shared/types.ts";

const STATUS_KEY = "pi-authentik";
const PROVIDER_NAME = "authentik";
const REFRESH_SKEW_SECONDS = 60;

type NotifyLevel = "info" | "warning" | "error";

interface UiLike {
  setStatus(key: string, value: string | undefined): void;
  notify(message: string, level?: NotifyLevel): void;
  input?(prompt: string, placeholder?: string, defaultValue?: string): Promise<string | null | undefined>;
  confirm?(title: string, message?: string): Promise<boolean>;
}

interface SessionContextLike {
  cwd: string;
  ui: UiLike;
}

interface CommandContextLike {
  cwd: string;
  ui: UiLike;
}

interface ProviderOAuthCredentialsLike {
  access: string;
  refresh: string;
  expires: number;
}

/** Injectable dependencies used to wire and test the extension runtime. */
export interface AuthentikExtensionDeps {
  resolveSettings: typeof resolveSettings;
  runFirstRunSetup: typeof runFirstRunSetup;
  saveSettings: (settings: AuthentikStoredSettings) => void | Promise<void>;
  loadStoredSession: typeof loadStoredSession;
  saveStoredSession: typeof saveStoredSession;
  clearStoredSession: typeof clearStoredSession;
  fetchOidcDiscoveryMetadata: typeof fetchOidcDiscoveryMetadata;
  runBrowserLogin: typeof runBrowserLogin;
  exchangeAuthorizationCode: typeof exchangeAuthorizationCode;
  exchangeJwtBearer: typeof exchangeJwtBearer;
  refreshSession: typeof refreshStoredSession;
  startCallbackServer: typeof startCallbackServer;
  createOpenAICompatibleClient: typeof createOpenAICompatibleClient;
  validateOpenAIBaseUrl: typeof validateOpenAIBaseUrl;
  mapOpenAIModelsToProviderModels: typeof mapOpenAIModelsToProviderModels;
  filterProviderModels: typeof filterProviderModels;
  createPkcePair: typeof createPkcePair;
  generateState: typeof generateState;
  generateNonce: typeof generateNonce;
  openUrl: (url: string) => Promise<void>;
  now: () => number;
}

const defaultDeps: AuthentikExtensionDeps = {
  resolveSettings,
  runFirstRunSetup,
  saveSettings: saveCurrentGlobalSettings,
  loadStoredSession,
  saveStoredSession,
  clearStoredSession,
  fetchOidcDiscoveryMetadata,
  runBrowserLogin,
  exchangeAuthorizationCode,
  exchangeJwtBearer,
  refreshSession: refreshStoredSession,
  startCallbackServer,
  createOpenAICompatibleClient,
  validateOpenAIBaseUrl,
  mapOpenAIModelsToProviderModels,
  filterProviderModels,
  createPkcePair,
  generateState,
  generateNonce,
  openUrl: openExternalUrl,
  now: () => Date.now(),
};

/**
 * Registers the pi-authentik extension lifecycle hooks, commands, and provider integration.
 * @param pi - Pi extension API used to register commands, providers, and event handlers.
 * @param deps - Optional dependency overrides for tests and alternate runtime wiring.
 */
export function createPiAuthentikExtension(pi: ExtensionAPI, deps: Partial<AuthentikExtensionDeps> = {}): void {
  const api = pi;
  const runtime = { ...defaultDeps, ...deps };
  const log = createLogger(pi, "pi-authentik");

  const state: {
    settings: AuthentikResolvedSettings;
    session: AuthentikSessionRecord | null;
    models: ProviderModelConfig[];
    lastCtx: SessionContextLike | CommandContextLike | null;
    discovery: OidcDiscoveryMetadata | null;
  } = {
    settings: createEmptySettings(),
    session: null,
    models: [],
    lastCtx: null,
    discovery: null,
  };

  api.on("session_start", async (_event: unknown, ctx: SessionContextLike) => {
    state.lastCtx = ctx;
    state.settings = await runtime.resolveSettings(ctx.cwd);
    state.discovery = null;
    await initializeSession(ctx).catch((error) => {
      log.error("session_start failed", error);
      ctx.ui.notify(`pi-authentik: ${formatError(error)}`, "error");
      updateStatus(ctx);
    });
  });

  api.registerCommand("authentik-setup", {
    description: "Run first-time pi-authentik setup",
    handler: async (_args: string | undefined, ctx: CommandContextLike) => {
      state.lastCtx = ctx;
      await handleSetup(ctx);
    },
  });

  api.registerCommand("authentik-login", {
    description: "Sign in to authentik and register the provider",
    handler: async (_args: string | undefined, ctx: CommandContextLike) => {
      state.lastCtx = ctx;
      await handleLogin(ctx);
    },
  });

  api.registerCommand("authentik-logout", {
    description: "Clear the authentik session",
    handler: async (_args: string | undefined, ctx: CommandContextLike) => {
      state.lastCtx = ctx;
      await handleLogout(ctx);
    },
  });

  api.registerCommand("authentik-status", {
    description: "Show pi-authentik configuration and session status",
    handler: async (_args: string | undefined, ctx: CommandContextLike) => {
      state.lastCtx = ctx;
      ctx.ui.notify(renderStatusSummary(), "info");
    },
  });

  api.registerCommand("authentik-endpoint", {
    description: "Show or update the configured OpenAI-compatible /v1 endpoint",
    handler: async (args: string | undefined, ctx: CommandContextLike) => {
      state.lastCtx = ctx;
      await handleEndpointCommand(args, ctx);
    },
  });

  api.registerCommand("authentik-refresh-models", {
    description: "Refresh models from the configured endpoint and re-register the provider",
    handler: async (_args: string | undefined, ctx: CommandContextLike) => {
      state.lastCtx = ctx;
      await handleRefreshModels(ctx, true);
    },
  });

  async function initializeSession(ctx: SessionContextLike): Promise<void> {
    if (!hasAuthConfig(state.settings)) {
      state.session = null;
      state.models = [];
      updateStatus(ctx);
      ctx.ui.notify("pi-authentik: Run /authentik-setup to configure authentik and the LLM endpoint.", "info");
      return;
    }

    if (!state.settings.llmBaseUrl) {
      state.session = null;
      state.models = [];
      updateStatus(ctx);
      ctx.ui.notify("pi-authentik: Configure the OpenAI-compatible endpoint with /authentik-setup or /authentik-endpoint.", "warning");
      return;
    }

    try {
      state.session = await runtime.loadStoredSession();
    } catch (error) {
      await runtime.clearStoredSession();
      state.session = null;
      ctx.ui.notify(`pi-authentik: Ignoring invalid stored session (${formatError(error)}).`, "warning");
    }

    if (state.session && shouldRefresh(state.session, runtime.now())) {
      state.session = await maybeRefreshSession(ctx, state.session);
    }

    if (state.session && state.settings.exchangeClientId) {
      state.session = await maybeExchangeToken(ctx, state.session);
    }

    if (state.session) {
      await registerProviderFromSession(ctx);
      return;
    }

    state.models = [];
    updateStatus(ctx);
    ctx.ui.notify("pi-authentik: Ready to sign in. Run /authentik-login.", "info");
  }

  async function handleSetup(ctx: CommandContextLike): Promise<void> {
    if (!ctx.ui.input || !ctx.ui.confirm) {
      throw new Error("Interactive setup is not available in this UI");
    }

    const result = await runtime.runFirstRunSetup({
      ui: {
        input: ctx.ui.input.bind(ctx.ui),
        confirm: ctx.ui.confirm.bind(ctx.ui),
        notify: ctx.ui.notify.bind(ctx.ui),
      },
      saveSettings: runtime.saveSettings,
    });

    if (!result.saved) return;
    state.settings = await runtime.resolveSettings(ctx.cwd);
    state.discovery = null;
    updateStatus(ctx);

    if (result.loginRequested) {
      await handleLogin(ctx);
    }
  }

  async function handleLogin(ctx: CommandContextLike): Promise<void> {
    ensureLoginConfigured();
    const discovery = await loadDiscovery();
    const pkce = runtime.createPkcePair();
    const loginState = runtime.generateState();
    const nonce = runtime.generateNonce();
    const session = await runtime.runBrowserLogin({
      authorizationEndpoint: discovery.authorization_endpoint,
      tokenEndpoint: discovery.token_endpoint,
      issuer: discovery.issuer,
      jwksUri: discovery.jwks_uri,
      clientId: state.settings.clientId!,
      clientSecret: state.settings.clientSecret ?? undefined,
      scopes: state.settings.scopes,
      state: loginState,
      nonce,
      codeVerifier: pkce.codeVerifier,
      codeChallenge: pkce.codeChallenge,
      codeChallengeMethod: pkce.codeChallengeMethod,
      createLoopbackServer: async () => runtime.startCallbackServer({ expectedState: loginState }),
      openBrowser: runtime.openUrl,
      exchangeCode: (request) =>
        runtime.exchangeAuthorizationCode({
          ...request,
          clientSecret: state.settings.clientSecret ?? undefined,
          tokenEndpoint: discovery.token_endpoint,
          issuer: discovery.issuer,
          jwksUri: discovery.jwks_uri,
        }),
    });

    state.session = session;
    await runtime.saveStoredSession(session);

    // If an exchange client ID is configured, swap the access token for one
    // issued by the target provider (e.g. an outpost provider).
    if (state.settings.exchangeClientId) {
      state.session = await maybeExchangeToken(ctx, session);
    }

    await registerProviderFromSession(ctx);
    ctx.ui.notify("pi-authentik: Signed in successfully.", "info");
  }

  async function handleLogout(ctx: CommandContextLike): Promise<void> {
    const logoutUrl = buildLogoutUrlFromState();
    state.session = null;
    state.models = [];
    await runtime.clearStoredSession();
    updateStatus(ctx);
    if (logoutUrl) {
      await runtime.openUrl(logoutUrl).catch((error) => {
        ctx.ui.notify(`pi-authentik: Could not open logout URL (${formatError(error)}).`, "warning");
      });
    }
    ctx.ui.notify("pi-authentik: Signed out.", "info");
  }

  async function handleEndpointCommand(args: string | undefined, ctx: CommandContextLike): Promise<void> {
    const raw = args?.trim();
    if (!raw) {
      ctx.ui.notify(state.settings.llmBaseUrl ?? "No LLM endpoint configured.", "info");
      return;
    }

    const result = runtime.validateOpenAIBaseUrl(raw);
    if (!result.ok) {
      throw new Error(result.error);
    }

    state.settings = {
      ...state.settings,
      llmBaseUrl: result.normalizedUrl,
    };
    await runtime.saveSettings(toStoredSettings(state.settings));
    if (state.session) {
      await registerProviderFromSession(ctx);
    } else {
      updateStatus(ctx);
    }
    ctx.ui.notify(`pi-authentik: LLM endpoint set to ${result.normalizedUrl}`, "info");
  }

  async function handleRefreshModels(ctx: CommandContextLike, notify: boolean): Promise<void> {
    if (!state.session) {
      throw new Error("Not signed in. Run /authentik-login first.");
    }
    await registerProviderFromSession(ctx);
    if (notify) {
      ctx.ui.notify(`pi-authentik: Registered ${state.models.length} model${state.models.length === 1 ? "" : "s"}.`, "info");
    }
  }

  async function maybeRefreshSession(ctx: SessionContextLike, session: AuthentikSessionRecord): Promise<AuthentikSessionRecord | null> {
    if (!session.tokens.refreshToken) return null;

    try {
      const discovery = await loadDiscovery();
      const refreshed = await runtime.refreshSession({
        tokenEndpoint: discovery.token_endpoint,
        clientId: state.settings.clientId!,
        clientSecret: state.settings.clientSecret ?? undefined,
        session,
        issuer: discovery.issuer,
        jwksUri: discovery.jwks_uri,
      });

      if (!refreshed) return session;
      await runtime.saveStoredSession(refreshed);
      ctx.ui.notify("pi-authentik: Restored session from refresh token.", "info");

      // Exchange the refreshed token for a target-provider token if configured.
      if (state.settings.exchangeClientId) {
        return maybeExchangeToken(ctx, refreshed);
      }

      return refreshed;
    } catch (error) {
      await runtime.clearStoredSession();
      ctx.ui.notify(`pi-authentik: Session refresh failed (${formatError(error)}). Please log in again.`, "warning");
      return null;
    }
  }

  async function registerProviderFromSession(ctx: SessionContextLike | CommandContextLike): Promise<void> {
    if (!state.session) throw new Error("Cannot register provider without an authenticated session");
    if (!state.settings.llmBaseUrl) throw new Error("Cannot register provider without an LLM endpoint");

    const models = await discoverProviderModels(state.settings.llmBaseUrl, state.session.tokens.accessToken);
    state.models = models;

    api.registerProvider(PROVIDER_NAME, {
      baseUrl: state.settings.llmBaseUrl,
      api: "openai-completions",
      authHeader: true,
      models,
      oauth: {
        name: "Authentik",
        login: async () => credentialsFromSession(await ensureSessionViaOAuth()),
        refreshToken: async () => credentialsFromSession(await refreshSessionViaOAuth()),
        getApiKey: () => state.session?.tokens.accessToken ?? "",
      },
    });

    updateStatus(ctx);
  }

  async function discoverProviderModels(baseUrl: string, accessToken: string): Promise<ProviderModelConfig[]> {
    const client = runtime.createOpenAICompatibleClient({
      baseUrl,
      authStrategy: {
        apply(headers) {
          headers.set("authorization", `Bearer ${accessToken}`);
        },
      },
    });

    const discovered = await client.listModels();
    const mapped = runtime.mapOpenAIModelsToProviderModels(discovered);
    return runtime.filterProviderModels(mapped, state.settings.modelFilters);
  }

  async function loadDiscovery(): Promise<OidcDiscoveryMetadata> {
    if (state.discovery) return state.discovery;
    const discoveryUrl = state.settings.discoveryUrl ?? deriveDiscoveryUrl(state.settings.authentikHost!, state.settings.providerSlug!);
    state.discovery = await runtime.fetchOidcDiscoveryMetadata({ discoveryUrl });
    return state.discovery;
  }

  async function ensureSessionViaOAuth(): Promise<AuthentikSessionRecord> {
    if (state.session) return state.session;
    if (!state.lastCtx) throw new Error("No active session context available for login");
    await handleLogin(state.lastCtx as CommandContextLike);
    if (!state.session) throw new Error("Login did not produce a session");
    return state.session;
  }

  async function refreshSessionViaOAuth(): Promise<AuthentikSessionRecord> {
    if (!state.session || !state.lastCtx) {
      return ensureSessionViaOAuth();
    }
    const refreshed = await maybeRefreshSession(state.lastCtx as SessionContextLike, state.session);
    if (!refreshed) {
      return ensureSessionViaOAuth();
    }
    state.session = refreshed;
    await registerProviderFromSession(state.lastCtx);
    return refreshed;
  }

  function renderStatusSummary(): string {
    const oidcLine = state.settings.discoveryUrl
      ? `Discovery: ${state.settings.discoveryUrl}`
      : state.settings.authentikHost && state.settings.providerSlug
        ? `Authentik: ${state.settings.authentikHost} (provider ${state.settings.providerSlug})`
        : `OIDC: (incomplete — run /authentik-setup)`;

    return [
      `Configured: ${hasAuthConfig(state.settings) ? "yes" : "no"}`,
      oidcLine,
      `Endpoint: ${state.settings.llmBaseUrl ?? "missing"}`,
      `Signed in: ${state.session ? "yes" : "no"}`,
      `Models: ${state.models.length}`,
    ].join("\n");
  }

  function updateStatus(ctx: SessionContextLike | CommandContextLike): void {
    ctx.ui.setStatus(STATUS_KEY, computeStatusLabel());
  }

  function computeStatusLabel(): string {
    if (!hasAuthConfig(state.settings)) return "authentik: setup required";
    if (!state.settings.llmBaseUrl) return "authentik: missing LLM endpoint";
    if (!state.session) return "authentik: not signed in";
    if (state.models.length > 0) return `authentik: ${state.models.length} model${state.models.length === 1 ? "" : "s"}`;
    return "authentik: signed in";
  }

  function ensureLoginConfigured(): void {
    if (!hasAuthConfig(state.settings)) {
      throw new Error("Run /authentik-setup before logging in");
    }
    if (!state.settings.llmBaseUrl) {
      throw new Error("Configure the OpenAI-compatible endpoint before logging in");
    }
  }

  function buildLogoutUrlFromState(): string | null {
    const endpoint = state.discovery?.end_session_endpoint ?? state.settings.logoutUrl;
    if (!endpoint || !state.session) return null;
    const url = new URL(endpoint);
    url.searchParams.set("id_token_hint", state.session.tokens.idToken);
    return url.toString();
  }

  async function maybeExchangeToken(ctx: SessionContextLike | CommandContextLike, session: AuthentikSessionRecord): Promise<AuthentikSessionRecord> {
    const exchangeClientId = state.settings.exchangeClientId;
    if (!exchangeClientId) return session;

    try {
      const discovery = await loadDiscovery();
      const exchanged = await runtime.exchangeJwtBearer({
        tokenEndpoint: discovery.token_endpoint,
        exchangeClientId,
        inputToken: session.tokens.accessToken,
        scopes: state.settings.scopes,
      });

      // Build a new session record with the exchanged token.
      const exchangedSession: AuthentikSessionRecord = {
        tokens: {
          ...session.tokens,
          accessToken: exchanged.accessToken,
          idToken: exchanged.idToken,
          tokenType: exchanged.tokenType,
          expiresAt: normalizeEpochSeconds((runtime.now)() / 1000) + exchanged.expiresIn,
          refreshToken: exchanged.refreshToken ?? session.tokens.refreshToken,
          scope: exchanged.scope ?? session.tokens.scope,
        },
        user: session.user,
      };

      await runtime.saveStoredSession(exchangedSession);
      ctx.ui.notify("pi-authentik: Exchanged token for target provider.", "info");
      return exchangedSession;
    } catch (error) {
      ctx.ui.notify(`pi-authentik: Token exchange failed (${formatError(error)}). Using original token.`, "warning");
      return session;
    }
  }

  function normalizeEpochSeconds(value: number): number {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
}

/**
 * Extension entrypoint used by Pi package discovery.
 * @param pi - Pi extension API instance.
 */
export default function (pi: ExtensionAPI): void {
  createPiAuthentikExtension(pi);
}

function hasAuthConfig(settings: AuthentikResolvedSettings): boolean {
  if (!settings.clientId) {
    return false;
  }

  const hasDerivedOidcEndpoints = Boolean(settings.authentikHost && settings.providerSlug);
  const hasExplicitDiscovery = Boolean(settings.discoveryUrl);

  return hasExplicitDiscovery || hasDerivedOidcEndpoints;
}

function shouldRefresh(session: AuthentikSessionRecord, nowMs: number): boolean {
  return session.tokens.expiresAt <= Math.floor(nowMs / 1000) + REFRESH_SKEW_SECONDS;
}

function toStoredSettings(settings: AuthentikResolvedSettings): AuthentikStoredSettings {
  return {
    authentikHost: settings.authentikHost ?? undefined,
    providerSlug: settings.providerSlug ?? undefined,
    clientId: settings.clientId ?? undefined,
    scopes: settings.scopes,
    enableOfflineAccess: settings.enableOfflineAccess,
    discoveryUrl: settings.discoveryUrl ?? undefined,
    logoutUrl: settings.logoutUrl ?? undefined,
    llmBaseUrl: settings.llmBaseUrl ?? undefined,
    authStorageBackend: settings.authStorageBackend ?? undefined,
    modelFilters: settings.modelFilters,
  };
}

function credentialsFromSession(session: AuthentikSessionRecord): ProviderOAuthCredentialsLike {
  return {
    access: session.tokens.accessToken,
    refresh: session.tokens.refreshToken ?? "",
    expires: session.tokens.expiresAt,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openExternalUrl(url: string): Promise<void> {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", detached: process.platform !== "win32" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

interface ExtensionApiLike {
  on(event: string, handler: (...args: any[]) => any): void;
  registerCommand(name: string, command: { description?: string; handler: (args: string | undefined, ctx: CommandContextLike) => Promise<void> | void }): void;
  registerProvider(name: string, provider: Record<string, unknown>): void;
}
