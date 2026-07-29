/**
 * pi-memory — Settings loader.
 *
 * Reads "pi-memory" key from:
 *   1. ~/.pi/agent/settings.json (global)
 *   2. .pi/settings.json (project, overrides global)
 *
 * Example settings.json:
 *   { "pi-memory": { "path": "~/notes/memory" } }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SETTINGS_KEY = "pi-memory";

export interface MemorySettings {
	/** Base directory for MEMORY.md and memory/ folder. Defaults to cwd. */
	path?: string;
}

function readJsonSafe(filePath: string): Record<string, unknown> {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return {};
	}
}

function expandHome(p: string): string {
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

export function resolveSettings(cwd: string): MemorySettings {
	const globalPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	const projectPath = path.join(cwd, ".pi", "settings.json");

	const globalRaw = readJsonSafe(globalPath)[SETTINGS_KEY] as Record<string, unknown> | undefined;
	const projectRaw = readJsonSafe(projectPath)[SETTINGS_KEY] as Record<string, unknown> | undefined;

	const merged = { ...(globalRaw ?? {}), ...(projectRaw ?? {}) };

	let memPath = (merged.path as string) ?? "";
	if (memPath) memPath = expandHome(memPath);

	return { path: memPath || undefined };
}
