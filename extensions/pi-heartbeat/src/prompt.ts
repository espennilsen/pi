/**
 * pi-heartbeat — Prompt builder.
 *
 * Reads HEARTBEAT.md from cwd if it exists and builds the heartbeat prompt.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const HEARTBEAT_OK = "HEARTBEAT_OK";

const DEFAULT_PROMPT = `You are running a periodic heartbeat check. Your job is to quickly assess whether anything needs attention.

{HEARTBEAT_MD}

Rules:
- If everything looks fine and there's nothing to report, respond with exactly: ${HEARTBEAT_OK}
- If there IS something worth reporting (an alert, a reminder, a status update), respond with a concise message about what needs attention
- Keep it brief — this runs periodically and should be lightweight
- Don't use tools unless the HEARTBEAT.md checklist specifically asks you to
- The current local time is {TIME}`;

export function buildPrompt(cwd: string, customPrompt: string | null): string {
	if (customPrompt) return customPrompt;

	const heartbeatMd = readHeartbeatMd(cwd);
	const heartbeatSection = heartbeatMd
		? `Here is your HEARTBEAT.md checklist:\n\n${heartbeatMd}`
		: "No HEARTBEAT.md found. Do a general check — anything to report?";

	const now = new Date();
	const timeStr = now.toLocaleString("en-GB", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

	return DEFAULT_PROMPT
		.replace("{HEARTBEAT_MD}", heartbeatSection)
		.replace("{TIME}", timeStr);
}

export function readHeartbeatMd(cwd: string): string | null {
	const filePath = path.resolve(cwd, "HEARTBEAT.md");
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}

/**
 * Check if HEARTBEAT.md is effectively empty (only headers/blank lines).
 */
export function isEffectivelyEmpty(content: string): boolean {
	const stripped = content
		.split("\n")
		.filter((line) => !line.match(/^\s*$/) && !line.match(/^\s*#+\s/))
		.join("")
		.trim();
	return stripped.length === 0;
}
