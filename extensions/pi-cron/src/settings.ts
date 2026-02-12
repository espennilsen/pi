/**
 * pi-cron — Settings loader.
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface CronSettings {
	autostart: boolean;
	activeHours: { start: string; end: string } | null;
	route: string;
	showOk: boolean;
	/** Extensions to load in cron subprocesses. Empty array = --no-extensions. */
	extensions: string[];
}

const DEFAULTS: CronSettings = {
	autostart: false,
	activeHours: { start: "08:00", end: "22:00" },
	route: "cron",
	showOk: false,
	extensions: [],
};

export function resolveSettings(cwd: string): CronSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-cron"] ?? {}), ...(project?.["pi-cron"] ?? {}) };

		return {
			autostart: cfg.autostart ?? DEFAULTS.autostart,
			activeHours: cfg.activeHours !== undefined ? cfg.activeHours : DEFAULTS.activeHours,
			route: cfg.route ?? DEFAULTS.route,
			showOk: cfg.showOk ?? DEFAULTS.showOk,
			extensions: Array.isArray(cfg.extensions) ? cfg.extensions : DEFAULTS.extensions,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
