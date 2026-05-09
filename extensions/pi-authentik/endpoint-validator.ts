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
 * Probes the configured models endpoint to confirm connectivity and endpoint shape.
 * @param options - Base URL, auth strategy, and optional fetch override.
 * @returns Connectivity details including the normalized base URL and model count.
 */
export async function testModelsEndpointConnectivity(options: ConnectivityTestOptions): Promise<ConnectivityTestResult> {
  const normalizedUrl = normalizeOpenAIBaseUrl(options.baseUrl);
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
