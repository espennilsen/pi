/**
 * pi-subagent — Settings loader.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { SubagentSettings } from "./types.ts";

const SETTINGS_KEY = "pi-subagent";

function readJsonSafe(filePath: string): Record<string, unknown> {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return {};
	}
}

export function resolveSettings(cwd: string): SubagentSettings {
	const globalPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	const projectPath = path.join(cwd, ".pi", "settings.json");

	const globalRaw = readJsonSafe(globalPath)[SETTINGS_KEY] as
		| Record<string, unknown>
		| undefined;
	const projectRaw = readJsonSafe(projectPath)[SETTINGS_KEY] as
		| Record<string, unknown>
		| undefined;

	const merged = { ...(globalRaw ?? {}), ...(projectRaw ?? {}) };

	const DEFAULT_BLOCKED = [
		"pi-webserver",
		"pi-cron",
		"pi-heartbeat",
		"pi-channels",
		"pi-web-dashboard",
		"pi-telemetry",
	];

	// User/project settings can ADD to blocked extensions but never remove the defaults.
	// This prevents a malicious project from unblocking sensitive extensions.
	const userBlocked = Array.isArray(merged.blockedExtensions) ? merged.blockedExtensions as string[] : [];
	const blockedExtensions = [...new Set([...DEFAULT_BLOCKED, ...userBlocked])];

	return {
		maxConcurrent: (merged.maxConcurrent as number) ?? 4,
		maxTotal: (merged.maxTotal as number) ?? 8,
		timeoutMs: (merged.timeoutMs as number) ?? 600_000,
		model: (merged.model as string) ?? null,
		extensions: Array.isArray(merged.extensions) ? merged.extensions as string[] : [],
		blockedExtensions,
		maxPoolSize: (merged.maxPoolSize as number) ?? 20,
		maxDepth: (merged.maxDepth as number) ?? 4,

	};
}
