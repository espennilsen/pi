import assert from "node:assert/strict";
import test from "node:test";

import { filterProviderModels, mapOpenAIModelsToProviderModels } from "../llm/models.ts";

test("mapOpenAIModelsToProviderModels maps OpenAI-compatible payload with defaults", () => {
  const mapped = mapOpenAIModelsToProviderModels([
    {
      id: "vision-model",
      name: "Vision Model",
      input_modalities: ["text", "image"],
      context_window: 200000,
      max_completion_tokens: 32000,
      supports_reasoning: true,
    },
    {
      id: "plain-model",
      object: "model",
    },
  ]);

  assert.deepEqual(mapped, [
    {
      id: "vision-model",
      name: "Vision Model",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 32000,
    },
    {
      id: "plain-model",
      name: "plain-model",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    },
  ]);
});

test("filterProviderModels applies glob patterns", () => {
  const models = mapOpenAIModelsToProviderModels([
    { id: "gpt-4.1", object: "model" },
    { id: "gpt-4.1-mini", object: "model" },
    { id: "o3-mini", object: "model" },
  ]);

  assert.deepEqual(
    filterProviderModels(models, ["gpt-*"]).map((model) => model.id),
    ["gpt-4.1", "gpt-4.1-mini"],
  );
});

test("filterProviderModels falls back to all models when filters match nothing", () => {
  const models = mapOpenAIModelsToProviderModels([
    { id: "gpt-4.1", object: "model" },
    { id: "o3-mini", object: "model" },
  ]);

  assert.deepEqual(
    filterProviderModels(models, ["claude-*"]).map((model) => model.id),
    ["gpt-4.1", "o3-mini"],
  );
});
