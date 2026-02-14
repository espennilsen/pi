/**
 * pi-heartbeat — Settings loader.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface HeartbeatSettings {
	autostart: boolean;
	intervalMinutes: number;
	activeHours: { start: string; end: string } | null;
	route: string;
	showOk: boolean;
	prompt: string | null;
	webui: boolean;
	/** Use pi-kysely shared DB for persistent heartbeat history. */
	useKysely: boolean;
	/** Extensions to load in the subprocess. If set, uses -ne + -e for each. If null, uses -ne (no extensions). */
	extensions: string[] | null;
}

const DEFAULTS: HeartbeatSettings = {
	autostart: false,
	intervalMinutes: 15,
	activeHours: { start: "08:00", end: "22:00" },
	route: "ops",
	showOk: false,
	prompt: null,
	webui: false,
	useKysely: false,
	extensions: null,
};

export function resolveSettings(cwd: string): HeartbeatSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-heartbeat"] ?? {}), ...(project?.["pi-heartbeat"] ?? {}) };

		return {
			autostart: cfg.autostart ?? DEFAULTS.autostart,
			intervalMinutes: cfg.intervalMinutes ?? DEFAULTS.intervalMinutes,
			activeHours: cfg.activeHours !== undefined ? cfg.activeHours : DEFAULTS.activeHours,
			route: cfg.route ?? DEFAULTS.route,
			showOk: cfg.showOk ?? DEFAULTS.showOk,
			prompt: cfg.prompt ?? DEFAULTS.prompt,
			webui: cfg.webui ?? DEFAULTS.webui,
			useKysely: cfg.useKysely ?? DEFAULTS.useKysely,
			extensions: Array.isArray(cfg.extensions) ? cfg.extensions : DEFAULTS.extensions,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
