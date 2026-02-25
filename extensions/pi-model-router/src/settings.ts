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

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface TierTarget {
	model: string;
	thinking: ThinkingLevel;
}

export interface OverrideRule {
	match: string;
	tier: Tier;
}

export interface CompiledOverrideRule {
	regex: RegExp;
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
	overrides: CompiledOverrideRule[];
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

// ── Validation ──────────────────────────────────────────────────

const VALID_THINKING: Set<string> = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const VALID_INTERACTIVE: Set<string> = new Set(["off", "suggest", "auto"]);
const VALID_TIERS: Set<string> = new Set(["simple", "medium", "complex"]);

function validateThinking(value: unknown, fallback: ThinkingLevel): ThinkingLevel {
	if (typeof value === "string" && VALID_THINKING.has(value)) return value as ThinkingLevel;
	return fallback;
}

function validateInteractive(value: unknown, fallback: InteractiveMode): InteractiveMode {
	if (typeof value === "string" && VALID_INTERACTIVE.has(value)) return value as InteractiveMode;
	return fallback;
}

function validateTier(value: unknown, fallback: Tier): Tier {
	if (typeof value === "string" && VALID_TIERS.has(value)) return value as Tier;
	return fallback;
}

function validatePositiveNumber(value: unknown, fallback: number): number {
	if (typeof value === "number" && value > 0 && Number.isFinite(value)) return value;
	return fallback;
}

function validateModelString(value: unknown, fallback: string): string {
	if (typeof value === "string" && value.length > 0) return value;
	return fallback;
}

function validateBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") return value;
	return fallback;
}

/** Compile user-defined override rules from project settings.
 *  Note: patterns are trusted input (same trust model as .eslintrc / tsconfig).
 *  No ReDoS guard — project config is authored by the repo owner. */
function compileOverrides(rules: unknown): { compiled: CompiledOverrideRule[]; skipped: string[] } {
	if (!Array.isArray(rules)) return { compiled: [], skipped: [] };
	const compiled: CompiledOverrideRule[] = [];
	const skipped: string[] = [];
	for (const rule of rules) {
		if (typeof rule?.match !== "string" || !VALID_TIERS.has(rule?.tier)) continue;
		try {
			compiled.push({ regex: new RegExp(rule.match, "i"), tier: rule.tier as Tier });
		} catch {
			skipped.push(rule.match);
		}
	}
	return { compiled, skipped };
}

// ── Loader ──────────────────────────────────────────────────────

export interface ResolveResult {
	settings: RouterSettings;
	configError?: string;
	skippedOverrides?: string[];
}

export function resolveSettings(cwd: string): ResolveResult {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const g = global?.["pi-model-router"] ?? {};
		const p = project?.["pi-model-router"] ?? {};
		const cfg = {
			...g,
			...p,
			// Deep-merge nested objects so project keys only override
			// the specific sub-keys they provide, not the entire object
			classifier: { ...g.classifier, ...p.classifier },
			tiers: {
				simple: { ...g.tiers?.simple, ...p.tiers?.simple },
				medium: { ...g.tiers?.medium, ...p.tiers?.medium },
				complex: { ...g.tiers?.complex, ...p.tiers?.complex },
			},
			cache: { ...g.cache, ...p.cache },
		};

		const overrideResult = compileOverrides(cfg.overrides);

		const result: ResolveResult = { settings: {
			classifier: {
				model: validateModelString(cfg.classifier?.model, DEFAULTS.classifier.model),
				timeoutMs: validatePositiveNumber(cfg.classifier?.timeoutMs, DEFAULTS.classifier.timeoutMs),
			},
			tiers: {
				simple: {
					model: validateModelString(cfg.tiers?.simple?.model, DEFAULTS.tiers.simple.model),
					thinking: validateThinking(cfg.tiers?.simple?.thinking, DEFAULTS.tiers.simple.thinking),
				},
				medium: {
					model: validateModelString(cfg.tiers?.medium?.model, DEFAULTS.tiers.medium.model),
					thinking: validateThinking(cfg.tiers?.medium?.thinking, DEFAULTS.tiers.medium.thinking),
				},
				complex: {
					model: validateModelString(cfg.tiers?.complex?.model, DEFAULTS.tiers.complex.model),
					thinking: validateThinking(cfg.tiers?.complex?.thinking, DEFAULTS.tiers.complex.thinking),
				},
			},
			overrides: overrideResult.compiled,
			cache: {
				enabled: validateBoolean(cfg.cache?.enabled, DEFAULTS.cache.enabled),
				ttlHours: validatePositiveNumber(cfg.cache?.ttlHours, DEFAULTS.cache.ttlHours),
				maxEntries: validatePositiveNumber(cfg.cache?.maxEntries, DEFAULTS.cache.maxEntries),
			},
			default: validateTier(cfg.default, DEFAULTS.default),
			interactive: validateInteractive(cfg.interactive, DEFAULTS.interactive),
		} };

		if (overrideResult.skipped.length > 0) {
			result.skippedOverrides = overrideResult.skipped;
		}

		return result;
	} catch (err) {
		return { settings: structuredClone(DEFAULTS), configError: String(err) };
	}
}
