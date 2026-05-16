import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { clearModelCache, loadModelCache, saveModelCache, type ModelCacheConfig } from "../session/model-cache.ts";
import type { ProviderModelConfig } from "../llm/models.ts";

function withTempAgentDir<T>(fn: (agentDir: string) => T): T {
  const original = process.env.PI_CODING_AGENT_DIR;
  const agentDir = mkdtempSync(join(tmpdir(), "pi-authentik-model-cache-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    return fn(agentDir);
  } finally {
    if (original === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = original;
    }
    rmSync(agentDir, { recursive: true, force: true });
  }
}

function makeModel(id: string): ProviderModelConfig {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  };
}

function getCacheFiles(agentDir: string): string[] {
  return readdirSync(join(agentDir, "cache")).filter((name) => name.startsWith("pi-authentik-models-"));
}

test("model cache keeps distinct keys for comma-containing filters", () => {
  withTempAgentDir((agentDir) => {
    const baseConfig = {
      llmBaseUrl: "https://llm.example",
    } satisfies Pick<ModelCacheConfig, "llmBaseUrl">;

    saveModelCache([makeModel("one")], { ...baseConfig, modelFilters: ["a,b"] });
    saveModelCache([makeModel("two")], { ...baseConfig, modelFilters: ["a", "b"] });

    assert.equal(getCacheFiles(agentDir).length, 2);
    assert.deepEqual(loadModelCache({ ...baseConfig, modelFilters: ["a,b"] }).map((model) => model.id), ["one"]);
    assert.deepEqual(loadModelCache({ ...baseConfig, modelFilters: ["a", "b"] }).map((model) => model.id), ["two"]);
  });
});

test("model cache filters invalid models and expires stale entries", () => {
  withTempAgentDir((agentDir) => {
    const config: ModelCacheConfig = {
      llmBaseUrl: "https://llm.example",
      modelFilters: ["*"],
    };

    saveModelCache([makeModel("fresh")], config);
    const cachePath = join(agentDir, "cache", getCacheFiles(agentDir)[0]);

    writeFileSync(cachePath, JSON.stringify({
      models: [
        makeModel("valid"),
        { id: "bad" },
      ],
      timestamp: Date.now(),
    }, null, 2));

    assert.deepEqual(loadModelCache(config).map((model) => model.id), ["valid"]);

    writeFileSync(cachePath, JSON.stringify({
      models: [makeModel("expired")],
      timestamp: Date.now() - (24 * 60 * 60 * 1000) - 1,
    }, null, 2));

    assert.deepEqual(loadModelCache(config), []);
  });
});

test("clearModelCache removes the cache file and ignores missing files", () => {
  withTempAgentDir(() => {
    const config: ModelCacheConfig = {
      llmBaseUrl: "https://llm.example",
      modelFilters: ["*"],
    };

    saveModelCache([makeModel("clear-me")], config);
    assert.equal(loadModelCache(config).length, 1);

    clearModelCache(config);
    assert.deepEqual(loadModelCache(config), []);

    assert.doesNotThrow(() => clearModelCache(config));
  });
});
