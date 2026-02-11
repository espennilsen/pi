/**
 * pi-heartbeat — Settings loader.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface HeartbeatSettings {
	enabled: boolean;
	intervalMinutes: number;
	activeHours: { start: string; end: string } | null;
	route: string;
	showOk: boolean;
	prompt: string | null;
}

const DEFAULTS: HeartbeatSettings = {
	enabled: false,
	intervalMinutes: 15,
	activeHours: { start: "08:00", end: "22:00" },
	route: "ops",
	showOk: false,
	prompt: null,
};

export function resolveSettings(cwd: string): HeartbeatSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-heartbeat"] ?? {}), ...(project?.["pi-heartbeat"] ?? {}) };

		return {
			enabled: cfg.enabled ?? DEFAULTS.enabled,
			intervalMinutes: cfg.intervalMinutes ?? DEFAULTS.intervalMinutes,
			activeHours: cfg.activeHours !== undefined ? cfg.activeHours : DEFAULTS.activeHours,
			route: cfg.route ?? DEFAULTS.route,
			showOk: cfg.showOk ?? DEFAULTS.showOk,
			prompt: cfg.prompt ?? DEFAULTS.prompt,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
