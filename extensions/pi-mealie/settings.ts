/**
 * pi-mealie — Settings loader.
 *
 * Settings in settings.json under "pi-mealie":
 * {
 *   "pi-mealie": {
 *     "baseUrl": "https://mealie.e9n.dev/api",
 *     "apiToken": "<mealie-api-token>"
 *   }
 * }
 */

import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

export interface MealieSettings {
	/** Mealie API base URL (e.g. https://mealie.e9n.dev/api). */
	baseUrl: string | null;
	/** Mealie API token (long-lived JWT or API key). */
	apiToken: string | null;
}

const DEFAULTS: MealieSettings = {
	baseUrl: null,
	apiToken: null,
};

export function resolveSettings(cwd: string): MealieSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-mealie"] ?? {}), ...(project?.["pi-mealie"] ?? {}) };

		return {
			baseUrl: cfg.baseUrl ?? DEFAULTS.baseUrl,
			apiToken: cfg.apiToken ?? DEFAULTS.apiToken,
		};
	} catch {
		return { ...DEFAULTS };
	}
}