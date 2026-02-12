/**
 * pi-logger — Settings loader.
 *
 * Reads "pi-logger" from global and project settings.json, merges them
 * (project overrides global).
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogScope = "global" | "project";

export interface LoggerSettings {
	/** Minimum level to write. Events below this are discarded. */
	level: LogLevel;
	/** Where to store logs: "global" → ~/.pi/agent/logs/, "project" → .pi/logs/ */
	scope: LogScope;
	/** IANA timezone for timestamps. Defaults to system tz. Example: "Europe/Oslo" */
	timezone: string;
	/** Bus event prefixes to subscribe to. Default: ["log"] (captures log, log:*). */
	events_whitelist: string[];
	/** Bus event prefixes to ignore (applied after whitelist). */
	events_ignore: string[];
	/** Channel whitelist for the "log" handler. Empty = accept all channels. */
	channels_whitelist: string[];
	/** Channels to ignore (applied after whitelist). */
	channels_ignore: string[];
}

/** Detect the system timezone via Intl. Falls back to UTC. */
function systemTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		return "UTC";
	}
}

const DEFAULTS: LoggerSettings = {
	level: "INFO",
	scope: "global",
	timezone: systemTimezone(),
	events_whitelist: ["log"],
	events_ignore: [],
	channels_whitelist: [],
	channels_ignore: [],
};

const VALID_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];

export function resolveSettings(cwd: string): LoggerSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-logger"] ?? {}), ...(project?.["pi-logger"] ?? {}) };

		const rawLevel = (cfg.level ?? "").toUpperCase();

		return {
			level: VALID_LEVELS.includes(rawLevel as LogLevel) ? (rawLevel as LogLevel) : DEFAULTS.level,
			scope: cfg.scope === "project" ? "project" : DEFAULTS.scope,
			timezone: typeof cfg.timezone === "string" && cfg.timezone ? cfg.timezone : DEFAULTS.timezone,
			events_whitelist: Array.isArray(cfg.events_whitelist) ? cfg.events_whitelist : DEFAULTS.events_whitelist,
			events_ignore: Array.isArray(cfg.events_ignore) ? cfg.events_ignore : DEFAULTS.events_ignore,
			channels_whitelist: Array.isArray(cfg.channels_whitelist) ? cfg.channels_whitelist : DEFAULTS.channels_whitelist,
			channels_ignore: Array.isArray(cfg.channels_ignore) ? cfg.channels_ignore : DEFAULTS.channels_ignore,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
