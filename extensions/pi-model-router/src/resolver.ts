/**
 * pi-model-router — Model resolver.
 *
 * Maps a tier target (model name/pattern) to an actual Model object
 * from pi's model registry. Delegates to shared fuzzy matching.
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { TierTarget } from "./settings.ts";
import { findModel } from "./match.ts";

/**
 * Resolve a tier target to a Model object from the registry.
 */
export function resolveModel(
	target: TierTarget,
	modelRegistry: ModelRegistry,
): Model<Api> | undefined {
	return findModel(target.model, modelRegistry);
}
