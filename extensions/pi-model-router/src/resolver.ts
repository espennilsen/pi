/**
 * pi-model-router — Model resolver.
 *
 * Maps a tier target (model name/pattern) to an actual Model object
 * from pi's model registry. Uses fuzzy matching on model ID and name.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { TierTarget } from "./settings.ts";

/**
 * Resolve a tier target to a Model object from the registry.
 *
 * Matching strategy:
 * 1. Exact match on model ID
 * 2. Partial match on model ID (contains)
 * 3. Partial match on model name (contains)
 * 4. Returns undefined if no match found
 */
export function resolveModel(
	target: TierTarget,
	modelRegistry: ModelRegistry,
): Model<Api> | undefined {
	const allModels = modelRegistry.getAll();
	const pattern = target.model.toLowerCase();

	// 1. Exact ID match
	const exact = allModels.find((m) => m.id.toLowerCase() === pattern);
	if (exact) return exact;

	// 2. Partial ID match — prefer shorter IDs (alias over dated version)
	const idMatches = allModels
		.filter((m) => m.id.toLowerCase().includes(pattern))
		.sort((a, b) => a.id.length - b.id.length);
	if (idMatches.length > 0) return idMatches[0];

	// 3. Partial name match
	const nameMatches = allModels
		.filter((m) => m.name.toLowerCase().includes(pattern))
		.sort((a, b) => a.name.length - b.name.length);
	if (nameMatches.length > 0) return nameMatches[0];

	return undefined;
}
