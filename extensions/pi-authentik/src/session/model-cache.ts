import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ProviderModelConfig } from "../llm/models.ts";

/** Cache file path for discovered provider models. */
function getCachePath(): string {
  return path.join(getAgentDir(), "cache", "pi-authentik-models.json");
}

/**
 * Loads cached provider models from disk.
 * @returns Cached models, or empty array when no cache exists.
 */
export function loadModelCache(): ProviderModelConfig[] {
  try {
    const data = fs.readFileSync(getCachePath(), "utf-8");
    const parsed = JSON.parse(data) as { models: ProviderModelConfig[]; timestamp: number };
    return Array.isArray(parsed.models) ? parsed.models : [];
  } catch {
    return [];
  }
}

/**
 * Persists discovered provider models to disk cache.
 * @param models - Provider models to cache.
 */
export function saveModelCache(models: ProviderModelConfig[]): void {
  const cachePath = getCachePath();
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cachePath, JSON.stringify({ models, timestamp: Date.now() }, null, 2));
}

/**
 * Clears the cached provider models.
 */
export function clearModelCache(): void {
  const cachePath = getCachePath();
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
  }
}
