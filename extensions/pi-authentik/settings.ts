import { createRequire } from "node:module";

import type { AuthentikResolvedSettings, AuthentikStoredSettings, ResolveSettingsOptions } from "./types.ts";
import { sanitizeStoredSettings } from "./settings-store.ts";

const require = createRequire(import.meta.url);

/** Default scopes requested when no scopes are configured explicitly. */
export const DEFAULT_SCOPES = ["openid", "profile", "email"];
/** Default model filter that exposes every discovered model. */
export const DEFAULT_MODEL_FILTERS = ["*"];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sanitizeStringArray(value: unknown): string[] | null {
  if (typeof value === "string") {
    const split = value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return split.length > 0 ? split : null;
  }

  if (!Array.isArray(value)) return null;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function sanitizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function normalizeAbsoluteUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http/https URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an absolute http/https URL`);
  }

  if (url.search || url.hash) {
    throw new Error(`${name} must not include a query string or hash fragment`);
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

/**
 * Normalizes a configured OpenAI-compatible base URL to a canonical `/v1` form.
 * @param value - Raw configured base URL.
 * @returns The normalized base URL without a trailing slash.
 */
export function canonicalizeLlmBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("LLM_BASE_URL must be an absolute http/https URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LLM_BASE_URL must be an absolute http/https URL");
  }

  if (url.search || url.hash) {
    throw new Error("LLM_BASE_URL must not include a query string or hash fragment");
  }

  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = basePath.endsWith("/v1") ? basePath : `${basePath || ""}/v1`;
  return url.toString().replace(/\/$/, "");
}

function mergeStoredSettings(globalSettings: unknown, projectSettings: unknown): AuthentikStoredSettings {
  return {
    ...sanitizeStoredSettings(globalSettings),
    ...sanitizeStoredSettings(projectSettings),
  };
}

function readSettingsFromManager(cwd: string): { globalSettings: unknown; projectSettings: unknown } {
  try {
    const piModule = require("@earendil-works/pi-coding-agent") as {
      getAgentDir: () => string;
      SettingsManager: { create: (cwd: string, agentDir: string) => { getGlobalSettings(): unknown; getProjectSettings(): unknown } };
    };
    const sm = piModule.SettingsManager.create(cwd, piModule.getAgentDir());
    const global = asRecord(sm.getGlobalSettings())["pi-authentik"];
    const project = asRecord(sm.getProjectSettings())["pi-authentik"];
    return {
      globalSettings: global,
      projectSettings: project,
    };
  } catch {
    return {
      globalSettings: {},
      projectSettings: {},
    };
  }
}

/**
 * Resolves `pi-authentik` settings from Pi global and project settings.
 * @param cwd - Current workspace directory used for project settings lookup.
 * @param options - Optional test overrides for settings sources.
 * @returns The normalized runtime settings for the extension.
 */
export function resolveSettings(cwd: string, options: ResolveSettingsOptions = {}): AuthentikResolvedSettings {
  const sources = options.globalSettings === undefined && options.projectSettings === undefined
    ? readSettingsFromManager(cwd)
    : {
        globalSettings: options.globalSettings,
        projectSettings: options.projectSettings,
      };

  const stored = mergeStoredSettings(sources.globalSettings, sources.projectSettings);

  const enableOfflineAccess = stored.enableOfflineAccess ?? false;

  const scopes = stored.scopes ?? DEFAULT_SCOPES;
  const normalizedScopes = Array.from(new Set(scopes));
  const filteredScopes = normalizedScopes.filter((scope) => scope !== "offline_access");
  if (enableOfflineAccess) filteredScopes.push("offline_access");

  const modelFilters = stored.modelFilters ?? DEFAULT_MODEL_FILTERS;

  const llmBaseUrlValue = stored.llmBaseUrl ?? null;

  return {
    authentikHost: stored.authentikHost ?? null,
    providerSlug: stored.providerSlug ?? null,
    clientId: stored.clientId ?? null,
    scopes: filteredScopes,
    enableOfflineAccess,
    discoveryUrl: stored.discoveryUrl
      ? normalizeAbsoluteUrl("AUTHENTIK_DISCOVERY_URL", stored.discoveryUrl)
      : null,
    logoutUrl: stored.logoutUrl
      ? normalizeAbsoluteUrl("AUTHENTIK_LOGOUT_URL", stored.logoutUrl)
      : null,
    llmBaseUrl: llmBaseUrlValue ? canonicalizeLlmBaseUrl(llmBaseUrlValue) : null,
    authStorageBackend: stored.authStorageBackend ?? null,
    modelFilters,
  };
}
