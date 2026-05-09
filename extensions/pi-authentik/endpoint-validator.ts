import { createOpenAICompatibleClient, type LlmAuthStrategy } from "./llm-client.ts";

/** Successful validation result for an OpenAI-compatible base URL. */
export interface BaseUrlValidationSuccess {
  ok: true;
  normalizedUrl: string;
}

/** Failed validation result for an OpenAI-compatible base URL. */
export interface BaseUrlValidationFailure {
  ok: false;
  error: string;
  suggestion?: string;
}

export type BaseUrlValidationResult = BaseUrlValidationSuccess | BaseUrlValidationFailure;

/** Options for validating models-endpoint connectivity. */
export interface ConnectivityTestOptions {
  baseUrl: string;
  authStrategy?: LlmAuthStrategy;
  fetchImpl?: typeof fetch;
}

/** Result returned after probing the configured `/models` endpoint. */
export interface ConnectivityTestResult {
  ok: true;
  normalizedUrl: string;
  modelCount: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const MAX_PROBE_REDIRECTS = 8;

/** User-facing explanation when probing /models reaches an SSO or OAuth login redirect. */
export const MODELS_ENDPOINT_AUTH_REDIRECT_MESSAGE =
  "GET /models redirected to a login or authorization page. Your LLM base URL appears to be behind authentication. Skip the connectivity test during setup (you can verify after running /authentik-login), or run the probe with credentials if your tooling supports Bearer tokens.";

/** User-facing explanation when probing /models returns HTML instead of JSON. */
export const MODELS_ENDPOINT_HTML_RESPONSE_MESSAGE =
  "GET /models returned HTML instead of JSON (often SSO or an error page). Skip the connectivity test until /models succeeds with your Authentik-issued Bearer token.";

function locationSuggestsAuthenticationRedirect(parsed: URL): boolean {
  const path = parsed.pathname;
  const lowerPath = path.toLowerCase();

  if (lowerPath.includes("/if/")) {
    return true;
  }

  if (lowerPath.includes("default-authentication-flow")) {
    return true;
  }

  if (lowerPath.includes("/application/o/authorize")) {
    return true;
  }

  if (/\/oauth\/authorize\b/i.test(lowerPath) || /\bauthorize\/$/i.test(lowerPath)) {
    return true;
  }

  return false;
}

function responseLooksLikeHtml(response: Response, bodyText: string): boolean {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/html")) {
    return true;
  }

  const start = bodyText.trimStart();
  return start.startsWith("<!DOCTYPE") || start.toLowerCase().startsWith("<html");
}

async function probeModelsPayload(
  normalizedBaseUrl: string,
  fetchImpl: typeof fetch,
  authStrategy?: LlmAuthStrategy,
): Promise<{ modelCount: number; finalUrl: string }> {
  const modelsUrl = `${normalizedBaseUrl.replace(/\/+$/, "")}/models`;

  let currentUrl = modelsUrl;

  for (let hop = 0; hop < MAX_PROBE_REDIRECTS; hop++) {
    const headers = new Headers();
    headers.set("accept", "application/json");
    if (authStrategy) {
      await authStrategy.apply(headers);
    }

    const response = await fetchImpl(currentUrl, { method: "GET", headers, redirect: "manual" });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location || !location.trim()) {
        throw new Error(`GET /models returned ${response.status} without a Location header.`);
      }

      const next = new URL(location.trim(), response.url || currentUrl);
      if (locationSuggestsAuthenticationRedirect(next)) {
        throw new Error(MODELS_ENDPOINT_AUTH_REDIRECT_MESSAGE);
      }

      currentUrl = next.toString();
      continue;
    }

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`GET /models failed: ${response.status} ${response.statusText}`);
    }

    if (responseLooksLikeHtml(response, text)) {
      throw new Error(MODELS_ENDPOINT_HTML_RESPONSE_MESSAGE);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        `GET /models did not return JSON (final URL: ${response.url || currentUrl}). If the endpoint is behind SSO, skip the connectivity test.`,
      );
    }

    if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
      throw new Error(
        `/models returned an unexpected shape: expected an object with a data array, got ${JSON.stringify(payload)}`,
      );
    }

    const data = (payload as { data: unknown[] }).data;
    return { modelCount: data.length, finalUrl: response.url || currentUrl };
  }

  throw new Error(`GET /models followed more than ${MAX_PROBE_REDIRECTS} redirects; aborting probe.`);
}

/**
 * Validates and canonicalizes an OpenAI-compatible base URL that must end in `/v1`.
 * @param value - Raw base URL entered by the user.
 * @returns Canonical base URL without a trailing slash.
 */
export function normalizeOpenAIBaseUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("LLM base URL must be an absolute http/https URL ending in /v1.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LLM base URL must be an absolute http/https URL ending in /v1.");
  }

  if (url.search || url.hash) {
    throw new Error("LLM base URL must not include a query string or hash fragment.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (url.pathname !== "/v1" && !url.pathname.endsWith("/v1")) {
    throw new Error(`LLM base URL must end with /v1. Try ${suggestOpenAIBaseUrl(url.toString())}`);
  }

  return url.toString().replace(/\/$/, "");
}

/**
 * Suggests a corrected OpenAI-compatible base URL by appending `/v1` when needed.
 * @param value - Raw base URL entered by the user.
 * @returns Suggested canonical base URL.
 */
export function suggestOpenAIBaseUrl(value: string): string {
  const url = new URL(value.trim());
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname || ""}/v1`;
  return url.toString().replace(/\/$/, "");
}

/**
 * Validates an OpenAI-compatible base URL and returns either a normalized value or a helpful error.
 * @param value - Raw base URL entered by the user.
 * @returns Structured success or failure information for UI handling.
 */
export function validateOpenAIBaseUrl(value: string): BaseUrlValidationResult {
  try {
    return {
      ok: true,
      normalizedUrl: normalizeOpenAIBaseUrl(value),
    };
  } catch (error) {
    let suggestion: string | undefined;
    try {
      suggestion = suggestOpenAIBaseUrl(value);
    } catch {
      suggestion = undefined;
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid LLM base URL",
      suggestion,
    };
  }
}

/**
 * Probes the configured models endpoint to confirm connectivity and endpoint shape,
 * detecting SSO redirects and HTML responses that would confuse a naive JSON probe.
 * @param options - Base URL, auth strategy, and optional fetch override.
 * @returns Connectivity details including the normalized base URL and model count.
 */
export async function testModelsEndpointConnectivity(options: ConnectivityTestOptions): Promise<ConnectivityTestResult> {
  const normalizedUrl = normalizeOpenAIBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  /** When Bearer auth already applies, reuse the structured client path (fewer probes). */
  if (options.authStrategy) {
    const client = createOpenAICompatibleClient({
      baseUrl: normalizedUrl,
      authStrategy: options.authStrategy,
      fetchImpl: options.fetchImpl,
    });
    const models = await client.listModels();

    return {
      ok: true,
      normalizedUrl,
      modelCount: models.length,
    };
  }

  const probe = await probeModelsPayload(normalizedUrl, fetchImpl);
  return {
    ok: true,
    normalizedUrl,
    modelCount: probe.modelCount,
  };
}
