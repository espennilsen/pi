/**
 * Settings loader for pi-prism.
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface PrismSettings {
	/** Widget IDs to show (order matters). */
	widgets: string[];
	/** Auto-open sidebar on session start (default: true). */
	autoOpen: boolean;
}

const DEFAULTS: PrismSettings = {
	widgets: [],
	autoOpen: true,
};

export function resolveSettings(cwd: string): PrismSettings {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = (sm.getGlobalSettings() as Record<string, any>)?.["pi-prism"] ?? {};
	const project = (sm.getProjectSettings() as Record<string, any>)?.["pi-prism"] ?? {};
	const merged = { ...global, ...project };

	return {
		widgets: Array.isArray(merged.widgets) ? merged.widgets : DEFAULTS.widgets,
		autoOpen: typeof merged.autoOpen === "boolean" ? merged.autoOpen : DEFAULTS.autoOpen,
	};
}
