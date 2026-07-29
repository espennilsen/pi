/**
 * pi-todoist — Settings loader.
 *
 * Settings in settings.json under "pi-todoist":
 * {
 *   "pi-todoist": {
 *     "apiToken": "<todoist-api-token>"
 *   }
 * }
 */

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

export interface TodoistSettings {
	/** Todoist API token. */
	apiToken: string | null;
}

const DEFAULTS: TodoistSettings = {
	apiToken: null,
};

export function resolveSettings(cwd: string): TodoistSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-todoist"] ?? {}), ...(project?.["pi-todoist"] ?? {}) };

		return {
			apiToken: cfg.apiToken ?? DEFAULTS.apiToken,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
