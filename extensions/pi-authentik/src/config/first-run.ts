import { deriveDiscoveryUrl } from "../auth/auth-config.ts";
import type { OidcDiscoveryMetadata } from "../auth/discovery.ts";
import { fetchOidcDiscoveryMetadata } from "../auth/discovery.ts";
import { validateOpenAIBaseUrl } from "../llm/endpoint-validator.ts";
import { DEFAULT_SCOPES } from "./settings.ts";
import { saveCurrentGlobalSettings } from "./settings-store.ts";
import { saveClientSecret, clearClientSecret, saveExchangeClientId as saveExchangeClientIdSecret, clearExchangeClientId as clearExchangeClientIdSecret } from "../session/token-store.ts";
import type { AuthentikStoredSettings } from "../shared/types.ts";

/** UI contract for the interactive first-run setup flow. */
export interface FirstRunUi {
  input(prompt: string, placeholder?: string, defaultValue?: string): Promise<string | null | undefined>;
  confirm(title: string, message?: string): Promise<boolean>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
}

/** Result returned after testing the configured models endpoint. */
export type FirstRunConnectivityResult = ConnectivityTestResult;

/** Dependencies used by the first-run wizard. */
export interface RunFirstRunSetupOptions {
  ui: FirstRunUi;
  saveSettings?: (settings: AuthentikStoredSettings) => void | Promise<void>;
  saveClientSecret?: (value: string) => void | Promise<void>;
  clearClientSecret?: () => void | Promise<void>;
  saveExchangeClientId?: (value: string) => void | Promise<void>;
  clearExchangeClientId?: () => void | Promise<void>;
  fetchDiscoveryMetadata?: (discoveryUrl: string) => Promise<OidcDiscoveryMetadata>;
}

/** Outcome of the first-run setup flow. */
export interface FirstRunSetupResult {
  saved: boolean;
  settings: AuthentikStoredSettings | null;
}

const LLM_URL_EXAMPLES = ["https://llm.example/v1", "https://llm.example/openai/v1"];

const DISCOVERY_PLACEHOLDER = "https://id.example/application/o/my-provider/.well-known/openid-configuration";

const LOOPBACK_REDIRECT_CONFIRM_TITLE = "Loopback OAuth redirect URIs configured?";

const LOOPBACK_REDIRECT_CONFIRM_BODY = [
  "Pi signs in with OIDC Authorization Code + PKCE and uses a temporary loopback URL:",
  "  http://127.0.0.1:<random-port>/callback",
  "",
  'In Authentik, configure this OAuth2/OIDC provider to allow loopback redirects (exact rules depend on your Authentik version — see AUTHENTIK_SETUP.md in pi-authentik, section "Loopback redirect URI setup").',
  "",
  "This is not the reverse-proxy callback (for example URLs containing outpost.goauthentik.io on your API host). Use a dedicated public client here, not only the Embedded Outpost client used by your upstream proxy.",
].join("\n");

/**
 * Prompts for authentik and LLM endpoint settings, optionally tests connectivity,
 * and persists the resulting non-secret configuration.
 * @param options - UI and persistence dependencies for the setup flow.
 * @returns The saved settings and whether the connectivity test was run.
 */
export async function runFirstRunSetup(options: RunFirstRunSetupOptions): Promise<FirstRunSetupResult> {
  const { ui } = options;
  const saveSettings = options.saveSettings ?? saveCurrentGlobalSettings;
  const storeClientSecret = options.saveClientSecret ?? saveClientSecret;
  const removeClientSecret = options.clearClientSecret ?? clearClientSecret;
  const storeExchangeClientId = options.saveExchangeClientId ?? saveExchangeClientIdSecret;
  const removeExchangeClientId = options.clearExchangeClientId ?? clearExchangeClientIdSecret;
  const fetchDiscovery = options.fetchDiscoveryMetadata ?? ((discoveryUrl: string) => fetchOidcDiscoveryMetadata({ discoveryUrl }));

  const resolved = await resolveOidcConfiguration(ui, fetchDiscovery);

  const redirectOk = await ui.confirm(LOOPBACK_REDIRECT_CONFIRM_TITLE, LOOPBACK_REDIRECT_CONFIRM_BODY);
  if (!redirectOk) {
    ui.notify("Setup cancelled until loopback redirects are acknowledged.", "warning");
    return {
      saved: false,
      settings: null,
      connectivityTested: false,
      loginRequested: false,
    };
  }

  const clientId = await promptForRequiredText(ui, "OAuth2 Client ID", "pi-desktop-client");
  const clientSecret = await promptForOptionalClientSecret(ui);
  const enableOfflineAccess = true;
  const exchangeClientId = await promptForExchangeClientId(ui);
  const llmBaseUrl = await promptForLlmBaseUrl(ui);

  const settings = sanitizeSetupSettings({
    ...(resolved.discoveryUrl ? { discoveryUrl: resolved.discoveryUrl } : {}),
    ...(resolved.authentikHost ? { authentikHost: resolved.authentikHost } : {}),
    ...(resolved.providerSlug ? { providerSlug: resolved.providerSlug } : {}),
    clientId,
    scopes: DEFAULT_SCOPES,
    enableOfflineAccess,
    llmBaseUrl,
  });

  await saveSettings(settings);

  if (clientSecret) {
    await storeClientSecret(clientSecret);
  } else {
    await removeClientSecret();
  }

  if (exchangeClientId) {
    await storeExchangeClientId(exchangeClientId);
  } else {
    await removeExchangeClientId();
  }

  ui.notify("Saved pi-authentik setup.", "info");

  return {
    saved: true,
    settings,
  };
}

interface ResolvedOidcConfiguration {
  /** Stored only when supplied explicitly; omit when deriving from host + slug. */
  discoveryUrl?: string;
  authentikHost?: string;
  providerSlug?: string;
  metadata?: OidcDiscoveryMetadata;
}

async function resolveOidcConfiguration(
  ui: FirstRunUi,
  fetchDiscovery: (discoveryUrl: string) => Promise<OidcDiscoveryMetadata>,
): Promise<ResolvedOidcConfiguration> {
  for (;;) {
    const pasted = await promptForOptionalDiscoveryUrl(ui);
    if (pasted !== null) {
      try {
        const metadata = await fetchDiscovery(pasted);
        ui.notify(`OIDC discovery OK. issuer: ${metadata.issuer}`, "info");
        return { discoveryUrl: pasted, metadata };
      } catch (error) {
        ui.notify(
          `Discovery failed (${error instanceof Error ? error.message : String(error)}). Check the URL and try again, or leave it empty to use Authentik host + provider slug.`,
          "error",
        );
      }
      continue;
    }

    const authentikHost = await promptForAbsoluteUrl(ui, "Authentik host", "https://auth.example", "Authentik host");
    const providerSlug = await promptForRequiredText(ui, "Provider slug", "default-provider");
    const discoveryUrlDerived = deriveDiscoveryUrl(authentikHost, providerSlug);

    try {
      const metadata = await fetchDiscovery(discoveryUrlDerived);
      ui.notify(`OIDC discovery OK. issuer: ${metadata.issuer}`, "info");
      return {
        authentikHost,
        providerSlug,
        metadata,
      };
    } catch (error) {
      ui.notify(
        `Could not load discovery from ${discoveryUrlDerived} (${error instanceof Error ? error.message : String(error)}). Verify host and provider slug.`,
        "error",
      );
    }
  }
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

  const out: AuthentikStoredSettings = {
    clientId: settings.clientId?.trim(),
    scopes: filteredScopes.length > 0 ? Array.from(new Set(filteredScopes)) : [...DEFAULT_SCOPES],
    enableOfflineAccess: settings.enableOfflineAccess === true,
    llmBaseUrl: settings.llmBaseUrl?.trim(),
  };

  const discoveryUrl = settings.discoveryUrl?.trim();
  if (discoveryUrl) {
    out.discoveryUrl = discoveryUrl;
  }

  const authentikHost = settings.authentikHost?.trim();
  if (authentikHost) {
    out.authentikHost = authentikHost;
  }

  const providerSlug = settings.providerSlug?.trim();
  if (providerSlug) {
    out.providerSlug = providerSlug;
  }

  return out;
}

async function promptForOptionalDiscoveryUrl(ui: FirstRunUi): Promise<string | null> {
  for (;;) {
    const raw = await ui.input(
      "OIDC discovery URL (OpenID configuration)",
      DISCOVERY_PLACEHOLDER,
      "",
    );
    const trimmed = raw?.trim() ?? "";
    if (trimmed.length === 0) {
      return null;
    }

    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Discovery URL must use http or https.");
      }
      if (url.search || url.hash) {
        throw new Error("Discovery URL must not include a query string or hash fragment.");
      }
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return url.toString().replace(/\/$/, "");
    } catch (error) {
      ui.notify(
        `${error instanceof Error ? error.message : "Discovery URL must be a valid absolute URL."}\nExample: ${DISCOVERY_PLACEHOLDER}`,
        "error",
      );
    }
  }
}

async function promptForRequiredText(ui: FirstRunUi, prompt: string, placeholder?: string): Promise<string> {
  for (;;) {
    const value = (await ui.input(prompt, placeholder))?.trim();
    if (value) return value;
    ui.notify(`${prompt} is required.`, "warning");
  }
}

async function promptForOptionalClientSecret(ui: FirstRunUi): Promise<string | null> {
  const raw = (await ui.input(
    "Client secret (leave empty for public client)",
    "",
  ))?.trim();
  return raw && raw.length > 0 ? raw : null;
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

async function promptForExchangeClientId(ui: FirstRunUi): Promise<string | null> {
  const raw = (await ui.input(
    "Outpost exchange client ID (provider used for JWT bearer token exchange, leave empty to skip)",
    "",
  ))?.trim();
  return raw && raw.length > 0 ? raw : null;
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

    // Auto-append /v1 if missing instead of asking for confirmation.
    if (result.suggestion) {
      ui.notify(`LLM base URL normalized to ${result.suggestion}`, "info");
      return result.suggestion;
    }

    ui.notify(
      `${result.error}\nExamples: ${LLM_URL_EXAMPLES.join(", ")}`,
      "error",
    );
  }
}
