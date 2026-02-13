import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface BraveSearchSettings {
	/** Brave Search API subscription token (required) */
	apiKey?: string;
	/** Default number of results to return (1-20, default: 5) */
	defaultCount?: number;
	/** Safe search: off | moderate | strict (default: moderate) */
	safesearch?: "off" | "moderate" | "strict";
}

export function getSettings(cwd: string): BraveSearchSettings {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, any>;
	const project = sm.getProjectSettings() as Record<string, any>;
	return {
		...global?.["pi-brave-search"],
		...project?.["pi-brave-search"],
	};
}
