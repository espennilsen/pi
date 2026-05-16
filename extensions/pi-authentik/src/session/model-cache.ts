import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ProviderModelConfig } from "../llm/models.ts";

/** Configuration used to generate a cache key for model discovery. */
export interface ModelCacheConfig {
  llmBaseUrl: string;
  modelFilters: string[];
}

/**
 * Generates a stable cache filename based on the provided config.
 * @param config - LLM endpoint URL and model filters used to key the cache.
 * @returns A unique cache file path for this configuration.
 */
function getCachePath(config: ModelCacheConfig): string {
  const configKey = `${config.llmBaseUrl}|${JSON.stringify(config.modelFilters)}`;
  const hash = crypto.createHash("sha256").update(configKey).digest("hex").slice(0, 16);
  return path.join(getAgentDir(), "cache", `pi-authentik-models-${hash}.json`);
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isProviderModelConfig(value: unknown): value is ProviderModelConfig {
  if (!value || typeof value !== "object") return false;

  const model = value as ProviderModelConfig;
  return (
    typeof model.id === "string"
    && typeof model.name === "string"
    && typeof model.reasoning === "boolean"
    && Array.isArray(model.input)
    && model.input.every((item) => item === "text" || item === "image")
    && typeof model.cost === "object"
    && model.cost !== null
    && typeof model.cost.input === "number"
    && typeof model.cost.output === "number"
    && typeof model.cost.cacheRead === "number"
    && typeof model.cost.cacheWrite === "number"
    && typeof model.contextWindow === "number"
    && Number.isFinite(model.contextWindow)
    && typeof model.maxTokens === "number"
    && Number.isFinite(model.maxTokens)
  );
}

/**
 * Loads cached provider models from disk.
 * @param config - Configuration used to determine which cache file to read.
 * @returns Cached models, or empty array when no cache exists.
 */
export function loadModelCache(config: ModelCacheConfig): ProviderModelConfig[] {
  try {
    const data = fs.readFileSync(getCachePath(config), "utf-8");
    const parsed = JSON.parse(data) as { models?: unknown; timestamp?: unknown };
    if (typeof parsed.timestamp !== "number" || Date.now() - parsed.timestamp > CACHE_TTL_MS) {
      return [];
    }

    return Array.isArray(parsed.models) ? parsed.models.filter(isProviderModelConfig) : [];
  } catch {
    return [];
  }
}

/**
 * Persists discovered provider models to disk cache.
 * @param models - Provider models to cache.
 * @param config - Configuration used to determine which cache file to write.
 */
export function saveModelCache(models: ProviderModelConfig[], config: ModelCacheConfig): void {
  const cachePath = getCachePath(config);
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ models, timestamp: Date.now() }, null, 2));
}

/**
 * Clears the cached provider models.
 * @param config - Configuration used to determine which cache file to clear.
 */
export function clearModelCache(config: ModelCacheConfig): void {
  try {
    fs.unlinkSync(getCachePath(config));
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }
}
