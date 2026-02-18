import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface OpenRouterSettings {
	/** Glob patterns for model IDs to include. Default: curated frontier models. */
	models: string[];
}

export const DEFAULT_PATTERNS: string[] = [
	"openai/gpt-5.2*",
	"anthropic/claude-opus-4.6",
	"anthropic/claude-sonnet-4.6",
	"google/gemini-3*",
	"minimax/minimax-m2.5",
	"moonshotai/kimi-k2.5",
];

const SETTINGS_KEY = "pi-openrouter";

const DEFAULTS: OpenRouterSettings = {
	models: DEFAULT_PATTERNS,
};

export function resolveSettings(cwd: string): OpenRouterSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, unknown>;
		const project = sm.getProjectSettings() as Record<string, unknown>;

		const globalCfg = (global?.[SETTINGS_KEY] ?? {}) as Partial<OpenRouterSettings>;
		const projectCfg = (project?.[SETTINGS_KEY] ?? {}) as Partial<OpenRouterSettings>;

		return {
			...DEFAULTS,
			...globalCfg,
			...projectCfg,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
