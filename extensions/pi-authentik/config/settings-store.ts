import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AuthentikStoredSettings } from "../shared/types.ts";

/** Top-level Pi settings key used by this extension. */
export const SETTINGS_KEY = "pi-authentik";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

/**
 * Filters unknown persisted data down to the supported `pi-authentik` settings shape.
 * @param value - Raw settings value loaded from storage.
 * @returns Sanitized settings containing only recognized fields.
 */
export function sanitizeStoredSettings(value: unknown): AuthentikStoredSettings {
  const input = asRecord(value);
  const sanitized: AuthentikStoredSettings = {};

  const authentikHost = sanitizeString(input.authentikHost);
  const providerSlug = sanitizeString(input.providerSlug);
  const clientId = sanitizeString(input.clientId);
  const scopes = sanitizeStringArray(input.scopes);
  const discoveryUrl = sanitizeString(input.discoveryUrl);
  const logoutUrl = sanitizeString(input.logoutUrl);
  const llmBaseUrl = sanitizeString(input.llmBaseUrl);
  const authStorageBackend = sanitizeString(input.authStorageBackend);
  const modelFilters = sanitizeStringArray(input.modelFilters);
  const exchangeClientId = sanitizeString(input.exchangeClientId);

  if (authentikHost) sanitized.authentikHost = authentikHost;
  if (providerSlug) sanitized.providerSlug = providerSlug;
  if (clientId) sanitized.clientId = clientId;
  if (scopes) sanitized.scopes = scopes;
  if (typeof input.enableOfflineAccess === "boolean") sanitized.enableOfflineAccess = input.enableOfflineAccess;
  if (discoveryUrl) sanitized.discoveryUrl = discoveryUrl;
  if (logoutUrl) sanitized.logoutUrl = logoutUrl;
  if (llmBaseUrl) sanitized.llmBaseUrl = llmBaseUrl;
  if (authStorageBackend) sanitized.authStorageBackend = authStorageBackend;
  if (modelFilters) sanitized.modelFilters = modelFilters;
  if (exchangeClientId) sanitized.exchangeClientId = exchangeClientId;

  return sanitized;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return {};
  }
}

/**
 * Returns the path to Pi's global settings file.
 * @returns Absolute path to the active global settings file.
 */
export async function getGlobalSettingsPath(): Promise<string> {
  try {
    const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
    return path.join(getAgentDir(), "settings.json");
  } catch (error) {
    // Only fall back to home directory if the module cannot be resolved
    const isModuleNotFound =
      (error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND" ||
      (error instanceof Error && error.message.includes("@earendil-works/pi-coding-agent"));

    if (isModuleNotFound) {
      return path.join(os.homedir(), ".pi", "agent", "settings.json");
    }

    // Re-throw genuine runtime or import errors
    throw error;
  }
}

/**
 * Loads persisted `pi-authentik` settings from the global settings file.
 * @param settingsFile - Optional explicit settings file path.
 * @returns Sanitized stored settings.
 */
export async function loadGlobalSettings(settingsFile?: string): Promise<AuthentikStoredSettings> {
  const resolvedPath = settingsFile ?? await getGlobalSettingsPath();
  return sanitizeStoredSettings(readJsonFile(resolvedPath)[SETTINGS_KEY]);
}

/**
 * Saves `pi-authentik` settings into the global settings file atomically.
 * @param settingsFile - Global settings file to update.
 * @param settings - Non-secret extension settings to persist.
 */
export function saveGlobalSettings(settingsFile: string, settings: AuthentikStoredSettings): void {
  const root = readJsonFile(settingsFile);
  const sanitized = sanitizeStoredSettings(settings);

  if (Object.keys(sanitized).length === 0) {
    delete root[SETTINGS_KEY];
  } else {
    root[SETTINGS_KEY] = sanitized;
  }

  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const tempFile = `${settingsFile}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, settingsFile);
}

/**
 * Saves `pi-authentik` settings into the active Pi global settings file.
 * @param settings - Non-secret extension settings to persist.
 */
export async function saveCurrentGlobalSettings(settings: AuthentikStoredSettings): Promise<void> {
  saveGlobalSettings(await getGlobalSettingsPath(), settings);
}
