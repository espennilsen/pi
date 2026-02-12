/**
 * pi-workon — Settings loader.
 *
 * Reads "pi-workon" key from:
 *   1. ~/.pi/agent/settings.json (global)
 *   2. .pi/settings.json (project, overrides global)
 *
 * Example settings.json:
 *   { "pi-workon": { "devDir": "~/Dev" } }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SETTINGS_KEY = "pi-workon";

export interface WorkonSettings {
	/** Base directory to scan for projects. Default: ~/Dev */
	devDir: string;
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

export function resolveSettings(cwd: string): WorkonSettings {
	const globalPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	const projectPath = path.join(cwd, ".pi", "settings.json");

	const globalRaw = readJsonSafe(globalPath)[SETTINGS_KEY] as
		| Record<string, unknown>
		| undefined;
	const projectRaw = readJsonSafe(projectPath)[SETTINGS_KEY] as
		| Record<string, unknown>
		| undefined;

	const merged = { ...(globalRaw ?? {}), ...(projectRaw ?? {}) };

	let devDir = (merged.devDir as string) ?? "";
	if (devDir) devDir = expandHome(devDir);

	return {
		devDir: devDir || path.join(os.homedir(), "Dev"),
	};
}
