import { testModelsEndpointConnectivity, validateOpenAIBaseUrl } from "./endpoint-validator.ts";
import { DEFAULT_SCOPES } from "./settings.ts";
import { saveCurrentGlobalSettings } from "./settings-store.ts";
import type { AuthentikStoredSettings } from "./types.ts";

/** UI contract for the interactive first-run setup flow. */
export interface FirstRunUi {
  input(prompt: string, placeholder?: string, defaultValue?: string): Promise<string | null | undefined>;
  confirm(title: string, message?: string): Promise<boolean>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
}

/** Result returned after testing the configured models endpoint. */
export interface FirstRunConnectivityResult {
  ok: true;
  normalizedUrl: string;
  modelCount: number;
}

/** Dependencies used by the first-run wizard. */
export interface RunFirstRunSetupOptions {
  ui: FirstRunUi;
  saveSettings?: (settings: AuthentikStoredSettings) => void | Promise<void>;
  testConnectivity?: (baseUrl: string) => Promise<FirstRunConnectivityResult>;
}

/** Outcome of the first-run setup flow. */
export interface FirstRunSetupResult {
  saved: boolean;
  settings: AuthentikStoredSettings | null;
  connectivityTested: boolean;
}

const LLM_URL_EXAMPLES = ["https://llm.example/v1", "https://llm.example/openai/v1"];

/**
 * Prompts for authentik and LLM endpoint settings, optionally tests connectivity,
 * and persists the resulting non-secret configuration.
 * @param options - UI and persistence dependencies for the setup flow.
 * @returns The saved settings and whether the connectivity test was run.
 */
export async function runFirstRunSetup(options: RunFirstRunSetupOptions): Promise<FirstRunSetupResult> {
  const { ui } = options;
  const saveSettings = options.saveSettings ?? saveCurrentGlobalSettings;
  const testConnectivity = options.testConnectivity ?? (async (baseUrl: string) => testModelsEndpointConnectivity({ baseUrl }));

  const authentikHost = await promptForAbsoluteUrl(ui, "Authentik host", "https://auth.example", "Authentik host");
  const providerSlug = await promptForRequiredText(ui, "Provider slug", "default-provider");
  const clientId = await promptForRequiredText(ui, "Client ID", "pi-client");
  const scopes = await promptForScopes(ui);
  const enableOfflineAccess = await ui.confirm(
    "Enable offline_access?",
    "Allow refresh tokens so Pi can restore the session without logging in every time.",
  );
  const llmBaseUrl = await promptForLlmBaseUrl(ui);

  let connectivityTested = false;
  if (await ui.confirm("Test LLM endpoint connectivity?", `Try GET ${llmBaseUrl}/models before saving.`)) {
    connectivityTested = true;
    const result = await testConnectivity(llmBaseUrl);
    ui.notify(`LLM endpoint responded successfully. Found ${result.modelCount} models.`, "info");
  } else {
    ui.notify("Skipping LLM endpoint connectivity test before save.", "warning");
  }

  const settings = sanitizeSetupSettings({
    authentikHost,
    providerSlug,
    clientId,
    scopes,
    enableOfflineAccess,
    llmBaseUrl,
  });

  await saveSettings(settings);
  ui.notify("Saved pi-authentik setup.", "info");

  return {
    saved: true,
    settings,
    connectivityTested,
  };
}

/**
 * Normalizes setup values before they are written to Pi settings storage.
 * @param settings - Raw settings gathered from the setup flow.
 * @returns Sanitized non-secret settings ready to persist.
 */
export function sanitizeSetupSettings(settings: AuthentikStoredSettings): AuthentikStoredSettings {
  const filteredScopes = (settings.scopes ?? DEFAULT_SCOPES)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .filter((scope) => scope !== "offline_access");

  return {
    authentikHost: settings.authentikHost?.trim(),
    providerSlug: settings.providerSlug?.trim(),
    clientId: settings.clientId?.trim(),
    scopes: filteredScopes.length > 0 ? Array.from(new Set(filteredScopes)) : [...DEFAULT_SCOPES],
    enableOfflineAccess: settings.enableOfflineAccess === true,
    llmBaseUrl: settings.llmBaseUrl?.trim(),
  };
}

async function promptForRequiredText(ui: FirstRunUi, prompt: string, placeholder?: string): Promise<string> {
  for (;;) {
    const value = (await ui.input(prompt, placeholder))?.trim();
    if (value) return value;
    ui.notify(`${prompt} is required.`, "warning");
  }
}

async function promptForAbsoluteUrl(
  ui: FirstRunUi,
  prompt: string,
  placeholder: string,
  label: string,
): Promise<string> {
  for (;;) {
    const raw = (await ui.input(prompt, placeholder))?.trim();
    if (!raw) {
      ui.notify(`${label} is required.`, "warning");
      continue;
    }

    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`${label} must use http or https.`);
      }
      if (url.search || url.hash) {
        throw new Error(`${label} must not include a query string or hash fragment.`);
      }
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return url.toString().replace(/\/$/, "");
    } catch (error) {
      ui.notify(
        `${error instanceof Error ? error.message : `${label} must be a valid URL.`}\nExample: ${placeholder}`,
        "error",
      );
    }
  }
}

async function promptForScopes(ui: FirstRunUi): Promise<string[]> {
  for (;;) {
    const raw = (await ui.input("Scopes", "openid profile email", DEFAULT_SCOPES.join(" ")))?.trim();
    const scopes = (raw || DEFAULT_SCOPES.join(" "))
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);

    if (scopes.length > 0) {
      return Array.from(new Set(scopes));
    }

    ui.notify("Enter at least one scope.", "warning");
  }
}

async function promptForLlmBaseUrl(ui: FirstRunUi): Promise<string> {
  for (;;) {
    const raw = (await ui.input("LLM base URL", "https://llm.example/v1"))?.trim();
    if (!raw) {
      ui.notify(`LLM base URL is required. Examples: ${LLM_URL_EXAMPLES.join(", ")}`, "warning");
      continue;
    }

    const result = validateOpenAIBaseUrl(raw);
    if (result.ok) {
      return result.normalizedUrl;
    }

    if (result.suggestion && /must end with \/v1/i.test(result.error)) {
      const useSuggestion = await ui.confirm(
        "Append /v1 automatically?",
        `Use ${result.suggestion} instead of ${raw}?`,
      );
      if (useSuggestion) {
        return result.suggestion;
      }
    }

    ui.notify(
      `${result.error}\nExamples: ${LLM_URL_EXAMPLES.join(", ")}`,
      "error",
    );
  }
}
