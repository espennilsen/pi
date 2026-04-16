/**
 * Settings loader for pi-prism.
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface PrismSettings {
	/** Widget IDs to show (order matters). */
	widgets: string[];
	/** Auto-open sidebar on session start (default: true). */
	autoOpen: boolean;
	/** Hub JSON-RPC URL (read from pi-a2a.hub.url). */
	hubUrl: string | null;
	/** Hub API key (read from pi-a2a.hub.apiKey). */
	hubApiKey: string | null;
	/** Optional project filter for hub task widgets. */
	project: string | null;
}

const DEFAULTS: PrismSettings = {
	widgets: [],
	autoOpen: true,
	hubUrl: null,
	hubApiKey: null,
	project: null,
};

export function resolveSettings(cwd: string): PrismSettings {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const globalRaw = sm.getGlobalSettings() as Record<string, any>;
	const global = globalRaw?.["pi-prism"] ?? {};
	const project = (sm.getProjectSettings() as Record<string, any>)?.["pi-prism"] ?? {};
	const merged = { ...global, ...project };

	// Read Hub config from pi-a2a settings (global + project, project wins)
	const a2aGlobal = globalRaw?.["pi-a2a"] ?? {};
	const a2aProject = (sm.getProjectSettings() as Record<string, any>)?.["pi-a2a"] ?? {};
	const a2aMerged = { ...a2aGlobal, ...a2aProject };
	const hubCfg = a2aMerged?.hub ?? {};
	const rawHubUrl: string | null = typeof hubCfg.url === "string" ? hubCfg.url : null;
	// Normalise: RPC endpoint is at <baseUrl>/rpc
	const hubUrl = rawHubUrl ? `${rawHubUrl.replace(/\/$/, "")}/rpc` : null;
	const hubApiKey: string | null = typeof hubCfg.apiKey === "string" ? hubCfg.apiKey : null;

	return {
		widgets: Array.isArray(merged.widgets) ? merged.widgets : DEFAULTS.widgets,
		autoOpen: typeof merged.autoOpen === "boolean" ? merged.autoOpen : DEFAULTS.autoOpen,
		hubUrl,
		hubApiKey,
		project: typeof merged.project === "string" ? merged.project : null,
	};
}
