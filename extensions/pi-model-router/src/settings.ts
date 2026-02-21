/**
 * pi-model-router — Settings loader.
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

// ── Types ───────────────────────────────────────────────────────

export type Tier = "simple" | "medium" | "complex";
export type InteractiveMode = "off" | "suggest" | "auto";

export interface ClassifierSettings {
	/** Model pattern to use for classification (resolved via pi's model registry). */
	model: string;
	/** Timeout for classifier calls in milliseconds. */
	timeoutMs: number;
}

export interface TierTarget {
	model: string;
	thinking: string;
}

export interface OverrideRule {
	match: string;
	tier: Tier;
}

export interface CacheSettings {
	enabled: boolean;
	ttlHours: number;
	maxEntries: number;
}

export interface RouterSettings {
	classifier: ClassifierSettings;
	tiers: Record<Tier, TierTarget>;
	overrides: OverrideRule[];
	cache: CacheSettings;
	default: Tier;
	interactive: InteractiveMode;
}

// ── Defaults ────────────────────────────────────────────────────

const DEFAULTS: RouterSettings = {
	classifier: {
		model: "claude-haiku-4-5",
		timeoutMs: 5000,
	},
	tiers: {
		simple: { model: "claude-haiku-4-5", thinking: "off" },
		medium: { model: "claude-sonnet-4-5", thinking: "low" },
		complex: { model: "claude-opus-4-6", thinking: "high" },
	},
	overrides: [],
	cache: {
		enabled: true,
		ttlHours: 168,
		maxEntries: 500,
	},
	default: "medium",
	interactive: "off",
};

// ── Loader ──────────────────────────────────────────────────────

export function resolveSettings(cwd: string): RouterSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = {
			...(global?.["pi-model-router"] ?? {}),
			...(project?.["pi-model-router"] ?? {}),
		};

		return {
			classifier: {
				model: cfg.classifier?.model ?? DEFAULTS.classifier.model,
				timeoutMs: cfg.classifier?.timeoutMs ?? DEFAULTS.classifier.timeoutMs,
			},
			tiers: {
				simple: { ...DEFAULTS.tiers.simple, ...(cfg.tiers?.simple ?? {}) },
				medium: { ...DEFAULTS.tiers.medium, ...(cfg.tiers?.medium ?? {}) },
				complex: { ...DEFAULTS.tiers.complex, ...(cfg.tiers?.complex ?? {}) },
			},
			overrides: Array.isArray(cfg.overrides) ? cfg.overrides : DEFAULTS.overrides,
			cache: {
				enabled: cfg.cache?.enabled ?? DEFAULTS.cache.enabled,
				ttlHours: cfg.cache?.ttlHours ?? DEFAULTS.cache.ttlHours,
				maxEntries: cfg.cache?.maxEntries ?? DEFAULTS.cache.maxEntries,
			},
			default: cfg.default ?? DEFAULTS.default,
			interactive: cfg.interactive ?? DEFAULTS.interactive,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
