/**
 * pi-logger — JSONL file writer.
 *
 * Writes one JSON line per log entry to per-day files.
 * Directory depends on scope setting:
 *   global:  ~/.pi/agent/logs/YYYY-MM-DD.jsonl
 *   project: .pi/logs/YYYY-MM-DD.jsonl
 *
 * Timestamps are formatted in the configured timezone.
 * Errors are silently swallowed — logging must never break the agent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { LogScope } from "./settings.ts";

export interface LogEntry {
	ts: string;
	level: string;
	channel: string;
	event: string;
	data: unknown;
}

/** Resolve the logs directory based on scope. */
function getLogsDir(scope: LogScope, cwd: string): string {
	if (scope === "project") {
		return path.join(cwd, ".pi", "logs");
	}
	return path.join(getAgentDir(), "logs");
}

/** Format a Date in the given IANA timezone as YYYY-MM-DD. */
function dateTag(timezone: string): string {
	try {
		// Use sv-SE locale for ISO-ish date part (YYYY-MM-DD)
		const parts = new Intl.DateTimeFormat("sv-SE", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(new Date());

		const y = parts.find((p) => p.type === "year")!.value;
		const m = parts.find((p) => p.type === "month")!.value;
		const d = parts.find((p) => p.type === "day")!.value;
		return `${y}-${m}-${d}`;
	} catch {
		return new Date().toISOString().slice(0, 10);
	}
}

/** Format a Date as an ISO-ish timestamp in the given timezone. */
function formatTimestamp(timezone: string): string {
	try {
		const now = new Date();
		const fmt = new Intl.DateTimeFormat("en-GB", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			fractionalSecondDigits: 3,
			hour12: false,
		});
		const parts = fmt.formatToParts(now);
		const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
		return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.${get("fractionalSecond")}`;
	} catch {
		return new Date().toISOString();
	}
}

/** Singleton-ish state to avoid re-creating dirs on every write. */
let ensuredDir: string | null = null;

/**
 * Split a bus event name into channel and event.
 * "log:webserver" → { channel: "log", event: "webserver" }
 * "heartbeat:result" → { channel: "heartbeat", event: "result" }
 * "log" → { channel: "log", event: "" }
 */
function splitEvent(busEvent: string): { channel: string; event: string } {
	const idx = busEvent.indexOf(":");
	if (idx === -1) return { channel: busEvent, event: "" };
	return { channel: busEvent.slice(0, idx), event: busEvent.slice(idx + 1) };
}

/**
 * Append a log entry to the daily JSONL file.
 * Safe to call at any frequency — writes are synchronous appends.
 */
export function writeLogEntry(
	busEvent: string,
	level: string,
	data: unknown,
	scope: LogScope,
	cwd: string,
	timezone: string,
): void {
	try {
		const dir = getLogsDir(scope, cwd);
		if (ensuredDir !== dir) {
			fs.mkdirSync(dir, { recursive: true });
			ensuredDir = dir;
		}

		const { channel, event } = splitEvent(busEvent);

		const entry: LogEntry = {
			ts: formatTimestamp(timezone),
			level,
			channel,
			event,
			data,
		};

		const file = path.join(dir, `${dateTag(timezone)}.jsonl`);
		fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf-8");
	} catch {
		// Swallow — logging must never disrupt the agent.
	}
}
