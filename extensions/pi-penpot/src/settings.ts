/**
 * pi-penpot — Settings loader.
 *
 * Settings in settings.json under "pi-penpot":
 * {
 *   "pi-penpot": {
 *     "endpoint": "https://penpot.e9n.dev",
 *     "accessToken": "<token>"
 *   }
 * }
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface PenpotSettings {
	/** Penpot instance URL (e.g. https://penpot.e9n.dev). */
	endpoint: string | null;
	/** Personal access token for API authentication. */
	accessToken: string | null;
}

const DEFAULTS: PenpotSettings = {
	endpoint: null,
	accessToken: null,
};

export function resolveSettings(cwd: string): PenpotSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-penpot"] ?? {}), ...(project?.["pi-penpot"] ?? {}) };

		return {
			endpoint: cfg.endpoint ?? DEFAULTS.endpoint,
			accessToken: cfg.accessToken ?? DEFAULTS.accessToken,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
