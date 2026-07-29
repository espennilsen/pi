/**
 * pi-model-router — Static override matching.
 *
 * Matches prompt text against pre-compiled regex patterns.
 * Returns the first matching tier, or null if no match.
 */

import type { CompiledOverrideRule, Tier } from "./settings.ts";

/**
 * Match prompt against pre-compiled override rules.
 * Rules are evaluated in order — first match wins.
 */
export function matchOverride(rules: CompiledOverrideRule[], prompt: string): Tier | null {
	for (const rule of rules) {
		if (rule.regex.test(prompt)) {
			return rule.tier;
		}
	}

	return null;
}
