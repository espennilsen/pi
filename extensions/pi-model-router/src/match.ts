/**
 * pi-model-router — Shared fuzzy model matching.
 *
 * Resolves a model pattern string against pi's model registry.
 * Used by both the classifier (to find the classifier model) and
 * the resolver (to find tier target models).
 *
 * Matching strategy (first match wins):
 * 1. "provider/model" format — exact registry lookup
 * 2. Exact match on model ID (case-insensitive)
 * 3. Partial match on model ID — prefer shorter IDs (alias over dated)
 * 4. Partial match on model name — prefer shorter names
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

export function findModel(
	pattern: string,
	modelRegistry: ModelRegistry,
): Model<Api> | undefined {
	const allModels = modelRegistry.getAll();
	const p = pattern.toLowerCase();

	// Handle "provider/model" format — split on first slash only
	// to support multi-segment model IDs (e.g. "openrouter/anthropic/claude-3-haiku")
	const slashIdx = p.indexOf("/");
	if (slashIdx !== -1) {
		const provider = p.slice(0, slashIdx);
		const modelId = p.slice(slashIdx + 1);
		return modelRegistry.find(provider, modelId);
	}

	// 1. Exact ID match
	const exact = allModels.find((m) => m.id.toLowerCase() === p);
	if (exact) return exact;

	// 2. Partial ID match — prefer shorter IDs (alias over dated version)
	const idMatches = allModels
		.filter((m) => m.id.toLowerCase().includes(p))
		.sort((a, b) => a.id.length - b.id.length);
	if (idMatches.length > 0) return idMatches[0];

	// 3. Partial name match
	const nameMatches = allModels
		.filter((m) => m.name.toLowerCase().includes(p))
		.sort((a, b) => a.name.length - b.name.length);
	if (nameMatches.length > 0) return nameMatches[0];

	return undefined;
}
