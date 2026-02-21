/**
 * pi-model-router — Static override matching.
 *
 * Matches prompt text against configured regex patterns.
 * Returns the first matching tier, or null if no match.
 */

import type { OverrideRule, Tier } from "./settings.ts";

/**
 * Match prompt against static override rules.
 * Rules are evaluated in order — first match wins.
 */
export function matchOverride(rules: OverrideRule[], prompt: string): Tier | null {
	const normalized = prompt.toLowerCase();

	for (const rule of rules) {
		try {
			const regex = new RegExp(rule.match, "i");
			if (regex.test(normalized)) {
				return rule.tier;
			}
		} catch {
			// Invalid regex — skip this rule
			continue;
		}
	}

	return null;
}
