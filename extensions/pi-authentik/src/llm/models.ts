import type { OpenAICompatibleModel } from "./llm-client.ts";

/** Provider model configuration shape passed to Pi during provider registration. */
export interface ProviderModelConfig {
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

function normalizeModalities(model: OpenAICompatibleModel): Array<"text" | "image"> {
  const inputModalities = Array.isArray(model.input_modalities) ? model.input_modalities : [];
  return inputModalities.includes("image") ? ["text", "image"] : ["text"];
}

function hasReasoning(model: OpenAICompatibleModel): boolean {
  return model.supports_reasoning === true || /(^|[-_/])o[134]($|[-_/])|reason/i.test(model.id);
}

/**
 * Maps a model from an OpenAI-compatible `/models` response into Pi's provider format.
 * @param model - Raw model metadata returned by the remote endpoint.
 * @returns Provider model metadata suitable for `registerProvider()`.
 */
export function mapOpenAIModelToProviderModel(model: OpenAICompatibleModel): ProviderModelConfig {
  return {
    id: model.id,
    name: model.name?.trim() || model.id,
    reasoning: hasReasoning(model),
    input: normalizeModalities(model),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.context_window && model.context_window > 0 ? model.context_window : DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.max_completion_tokens && model.max_completion_tokens > 0 ? model.max_completion_tokens : DEFAULT_MAX_TOKENS,
  };
}

/**
 * Maps all valid OpenAI-compatible models into Pi provider model metadata.
 * @param models - Raw models returned by the remote endpoint.
 * @returns Provider model metadata for each valid model.
 */
export function mapOpenAIModelsToProviderModels(models: OpenAICompatibleModel[]): ProviderModelConfig[] {
  return models.filter((model) => typeof model.id === "string" && model.id.length > 0).map(mapOpenAIModelToProviderModel);
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/**
 * Filters provider models with simple glob patterns, falling back to all models when nothing matches.
 * @param models - Provider models discovered from the remote endpoint.
 * @param filters - Glob-style model filters from settings.
 * @returns Matching models, or all models when the filters produce an empty result.
 */
export function filterProviderModels(models: ProviderModelConfig[], filters: string[]): ProviderModelConfig[] {
  const patterns = filters.map((filter) => filter.trim()).filter(Boolean);
  if (patterns.length === 0) return models;

  const regexes = patterns.map(globToRegex);
  const filtered = models.filter((model) => regexes.some((regex) => regex.test(model.id)));
  return filtered.length > 0 ? filtered : models;
}
