/**
 * pi-logger — Event bus logger for pi.
 *
 * Listens for events on `pi.events` and writes structured JSONL log files.
 * All configuration lives under "pi-logger" in settings.json.
 *
 * Settings:
 *   level              — Minimum log level: DEBUG | INFO | WARN | ERROR (default: INFO)
 *   scope              — Where to write: "global" (~/.pi/agent/logs/) or "project" (.pi/logs/) (default: global)
 *   timezone           — IANA timezone for timestamps (default: system timezone, e.g. "Europe/Oslo")
 *   events_whitelist   — Bus event prefixes to subscribe to (default: ["log"] — captures log and log:*)
 *   events_ignore      — Bus event prefixes to skip (default: [])
 *   channels_whitelist — Channels to accept in the "log" handler (default: [] = all)
 *   channels_ignore    — Channels to drop in the "log" handler (default: [])
 *
 * Log entries split the bus event name into channel and event:
 *   "log:webserver"     → channel: "log",       event: "webserver"
 *   "heartbeat:result"  → channel: "heartbeat",  event: "result"
 *
 * Log events carry a level derived from the event name:
 *   ERROR-level events — names containing "error" or "fail"
 *   WARN-level events  — names containing "warn" or "alert"
 *   DEBUG-level events — names containing "debug"
 *   INFO-level events  — everything else
 *
 * Extensions emit structured logs via the "log" bus event:
 *   pi.events.emit("log", { channel: "webserver", level: "WARN", data: { ... } })
 *   pi.events.emit("log", { channel: "db", event: "slow-query", data: { ms: 500 } })
 *
 * Shorthand by level (level can still be overridden in payload):
 *   pi.events.emit("log:error", { event: "my-ext:crash", data: { ... } })
 *   pi.events.emit("log:warn", { event: "cache-miss", level: "ERROR", data: { ... } })
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveSettings, type LogLevel, type LoggerSettings } from "./settings.ts";
import { writeLogEntry } from "./writer.ts";

// ── Level helpers ───────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
	DEBUG: 0,
	INFO: 1,
	WARN: 2,
	ERROR: 3,
};

function shouldLog(minLevel: LogLevel, eventLevel: LogLevel): boolean {
	return LEVEL_ORDER[eventLevel] >= LEVEL_ORDER[minLevel];
}

/** Infer a log level from an event name. */
function inferLevel(eventName: string): LogLevel {
	const lower = eventName.toLowerCase();
	if (lower.includes("error") || lower.includes("fail")) return "ERROR";
	if (lower.includes("warn") || lower.includes("alert")) return "WARN";
	if (lower.includes("debug")) return "DEBUG";
	return "INFO";
}

// ── Filter helpers ──────────────────────────────────────────────

function matchesPrefix(name: string, prefixes: string[]): boolean {
	if (prefixes.length === 0) return true;
	return prefixes.some((p) => name === p || name.startsWith(p + ":") || name.startsWith(p + "."));
}

/** Check if a bus event should be subscribed to. */
function shouldCapture(name: string, settings: LoggerSettings): boolean {
	if (settings.events_ignore.length > 0 && matchesPrefix(name, settings.events_ignore)) return false;
	if (settings.events_whitelist.length > 0) return matchesPrefix(name, settings.events_whitelist);
	return true;
}

/** Check if a channel from the "log" handler should be written. */
function shouldCaptureChannel(channel: string, settings: LoggerSettings): boolean {
	if (settings.channels_ignore.length > 0 && settings.channels_ignore.includes(channel)) return false;
	if (settings.channels_whitelist.length > 0) return settings.channels_whitelist.includes(channel);
	return true;
}

// ── Extension entry point ───────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let settings: LoggerSettings;
	let cwd = process.cwd();
	const subscriptions: Array<() => void> = [];

	// ── Setup / teardown ────────────────────────────────────────

	function setup(): void {
		settings = resolveSettings(cwd);
		teardown();

		// Main log handler: pi.events.emit("log", { level?, channel?, event?, data })
		//
		// All custom logging goes through "log". Extensions set their own level
		// and channel in the payload. If level is omitted it defaults to INFO.
		// The channel field controls the channel/event split in the log file:
		//   emit("log", { channel: "webserver", level: "WARN", data: { ... } })
		//   → { channel: "webserver", event: "", level: "WARN", ... }
		//   emit("log", { channel: "webserver", event: "request", data: { ... } })
		//   → { channel: "webserver", event: "request", level: "INFO", ... }
		//
		// channels_whitelist / channels_ignore filter which channels are written.
		subscriptions.push(pi.events.on("log", (payload: unknown) => {
			const p = payload as Record<string, any> | undefined;
			if (!p || typeof p !== "object") return;
			const channel = typeof p.channel === "string" ? p.channel : "log";
			if (!shouldCaptureChannel(channel, settings)) return;
			const level = (typeof p.level === "string" && LEVEL_ORDER[p.level.toUpperCase() as LogLevel] !== undefined
				? p.level.toUpperCase()
				: "INFO") as LogLevel;
			if (!shouldLog(settings.level, level)) return;
			const event = typeof p.event === "string" ? p.event : "";
			const busEvent = event ? `${channel}:${event}` : channel;
			writeLogEntry(busEvent, level, p.data ?? null, settings.scope, cwd, settings.timezone);
		}));

		// Shorthand: log:debug, log:info, log:warn, log:error
		// Level is inferred from the event name but can be overridden in payload.
		for (const lvl of ["debug", "info", "warn", "error"] as const) {
			const defaultLevel = lvl.toUpperCase() as LogLevel;
			subscriptions.push(pi.events.on(`log:${lvl}`, (payload: unknown) => {
				const p = payload as Record<string, any> | undefined;
				const level = (typeof p?.level === "string" && LEVEL_ORDER[p.level.toUpperCase() as LogLevel] !== undefined
					? p.level.toUpperCase()
					: defaultLevel) as LogLevel;
				if (!shouldLog(settings.level, level)) return;
				const event = typeof p?.event === "string" ? p.event : `log:${lvl}`;
				writeLogEntry(event, level, p?.data ?? p ?? null, settings.scope, cwd, settings.timezone);
			}));
		}

		// Subscribe to well-known bus events.
		// For events not in this list, extensions should use the log/log:* protocol.
		const knownEvents = [
			"channel:send", "channel:receive", "channel:register",
			"cron:job_start", "cron:job_complete", "cron:add", "cron:remove",
			"cron:enable", "cron:disable", "cron:run", "cron:status", "cron:reload",
			"heartbeat:check", "heartbeat:result",
			"jobs:recorded",
			"web:mount", "web:unmount", "web:mount-api", "web:unmount-api", "web:ready",
			"kysely:ready", "kysely:ack",
		];

		for (const eventName of knownEvents) {
			if (!shouldCapture(eventName, settings)) continue;
			subscriptions.push(pi.events.on(eventName, (data: unknown) => {
				const level = inferLevel(eventName);
				if (!shouldLog(settings.level, level)) return;
				writeLogEntry(eventName, level, data ?? null, settings.scope, cwd, settings.timezone);
			}));
		}
	}

	function teardown(): void {
		for (const unsub of subscriptions) unsub();
		subscriptions.length = 0;
	}

	// ── Lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		setup();
		writeLogEntry("logger:start", "INFO", {
			scope: settings.scope,
			level: settings.level,
			timezone: settings.timezone,
			events_whitelist: settings.events_whitelist,
			events_ignore: settings.events_ignore,
			channels_whitelist: settings.channels_whitelist,
			channels_ignore: settings.channels_ignore,
		}, settings.scope, cwd, settings.timezone);
	});

	pi.on("session_shutdown", async () => {
		writeLogEntry("logger:stop", "INFO", null, settings.scope, cwd, settings.timezone);
		teardown();
	});

	// ── Command: /logger ────────────────────────────────────────

	pi.registerCommand("logger", {
		description: "Show logger status or change settings: /logger [status|level <LVL>|scope <global|project>|reload]",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "status", label: "status — Show current logger settings" },
				{ value: "level", label: "level <DEBUG|INFO|WARN|ERROR> — Change log level" },
				{ value: "scope", label: "scope <global|project> — Change log scope" },
				{ value: "reload", label: "reload — Reload settings from disk" },
			];
			return items.filter((i) => i.value.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			const parts = (args ?? "").trim().split(/\s+/);
			const cmd = parts[0]?.toLowerCase();

			if (cmd === "level" && parts[1]) {
				const lvl = parts[1].toUpperCase() as LogLevel;
				if (LEVEL_ORDER[lvl] === undefined) {
					ctx.ui.notify("Invalid level. Use: DEBUG, INFO, WARN, ERROR", "error");
					return;
				}
				settings.level = lvl;
				ctx.ui.notify(`Log level set to ${lvl}`, "info");
				writeLogEntry("logger:level_change", "INFO", { level: lvl }, settings.scope, cwd, settings.timezone);
				return;
			}

			if (cmd === "scope" && parts[1]) {
				const s = parts[1].toLowerCase();
				if (s !== "global" && s !== "project") {
					ctx.ui.notify("Invalid scope. Use: global, project", "error");
					return;
				}
				settings.scope = s;
				ctx.ui.notify(`Log scope set to ${s}`, "info");
				writeLogEntry("logger:scope_change", "INFO", { scope: s }, settings.scope, cwd, settings.timezone);
				return;
			}

			if (cmd === "reload") {
				setup();
				ctx.ui.notify(`Logger reloaded: level=${settings.level}, scope=${settings.scope}, tz=${settings.timezone}`, "info");
				return;
			}

			// Default: status
			const fmt = (arr: string[], label: string) =>
				arr.length > 0 ? `${label}: ${arr.join(", ")}` : `${label}: all`;
			const lines = [
				`Logger: level=${settings.level}, scope=${settings.scope}`,
				`Timezone: ${settings.timezone}`,
				fmt(settings.events_whitelist, "Events whitelist"),
				settings.events_ignore.length > 0 ? `Events ignore: ${settings.events_ignore.join(", ")}` : "Events ignore: none",
				fmt(settings.channels_whitelist, "Channels whitelist"),
				settings.channels_ignore.length > 0 ? `Channels ignore: ${settings.channels_ignore.join(", ")}` : "Channels ignore: none",
				`Subscriptions: ${subscriptions.length}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
