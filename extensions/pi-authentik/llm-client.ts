/** Applies request authentication to outbound OpenAI-compatible API calls. */
export interface LlmAuthStrategy {
  apply(headers: Headers): void | Promise<void>;
}

/** Minimal model shape returned by a compatible `/models` endpoint. */
export interface OpenAICompatibleModel {
  id: string;
  object?: string;
  name?: string;
  created?: number;
  owned_by?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  context_window?: number;
  max_completion_tokens?: number;
  supports_reasoning?: boolean;
}

/** OpenAI-compatible response payload for model listing. */
export interface ListModelsResponse {
  object?: string;
  data: OpenAICompatibleModel[];
}

/** Request payload for `/chat/completions`. */
export interface ChatCompletionRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** Request payload for `/responses`. */
export interface ResponsesRequest {
  model: string;
  input: unknown;
  [key: string]: unknown;
}

/** Configuration for the OpenAI-compatible client wrapper. */
export interface OpenAICompatibleClientOptions {
  baseUrl: string;
  authStrategy?: LlmAuthStrategy;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  enableResponses?: boolean;
}

/** Small client surface used by the authentik extension. */
export interface OpenAICompatibleClient {
  listModels(): Promise<OpenAICompatibleModel[]>;
  chatCompletion(request: ChatCompletionRequest): Promise<unknown>;
  responses?: (request: ResponsesRequest) => Promise<unknown>;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Expected JSON response from ${response.url || "endpoint"}`);
  }
}

async function requestJson(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  init: RequestInit,
  authStrategy?: LlmAuthStrategy,
  userAgent?: string,
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (userAgent) headers.set("user-agent", userAgent);
  if (authStrategy) await authStrategy.apply(headers);

  const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
  const payload = await parseJson(response);

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? JSON.stringify((payload as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new Error(`Request to ${path} failed: ${message}`);
  }

  return payload;
}

/**
 * Creates a reusable client for OpenAI-compatible model and completion APIs.
 * @param options - Base URL, auth strategy, and request behavior for the client.
 * @returns A client exposing the supported OpenAI-compatible operations.
 */
export function createOpenAICompatibleClient(options: OpenAICompatibleClientOptions): OpenAICompatibleClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  const client: OpenAICompatibleClient = {
    async listModels() {
      const payload = await requestJson(fetchImpl, baseUrl, "/models", { method: "GET" }, options.authStrategy, options.userAgent);
      const data = typeof payload === "object" && payload !== null && Array.isArray((payload as ListModelsResponse).data)
        ? (payload as ListModelsResponse).data
        : [];
      return data;
    },
    async chatCompletion(request) {
      return requestJson(
        fetchImpl,
        baseUrl,
        "/chat/completions",
        { method: "POST", body: JSON.stringify(request) },
        options.authStrategy,
        options.userAgent,
      );
    },
  };

  if (options.enableResponses) {
    client.responses = async (request) =>
      requestJson(
        fetchImpl,
        baseUrl,
        "/responses",
        { method: "POST", body: JSON.stringify(request) },
        options.authStrategy,
        options.userAgent,
      );
  }

  return client;
}
