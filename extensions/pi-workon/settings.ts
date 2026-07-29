/**
 * pi-workon — Settings loader.
 *
 * Reads "pi-workon" key from:
 *   1. ~/.pi/agent/settings.json (global)
 *   2. .pi/settings.json (project, overrides global)
 *
 * Example settings.json:
 *   {
 *     "pi-workon": {
 *       "devDirs": ["~/Dev", "~/Work"],
 *       "aliases": {
 *         "bg": "battleground.no",
 *         "blog": "e9n.dev",
 *         "infra": "/opt/infrastructure",
 *         "dots": "~/.dotfiles"
 *       }
 *     }
 *   }
 *
 * Legacy "devDir" (string) is still supported and merged into devDirs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SETTINGS_KEY = "pi-workon";

export interface WorkonSettings {
	/** Directories to scan for projects. Default: ["~/Dev"] */
	devDirs: string[];
	/** Primary dev directory (first in list). */
	devDir: string;
	/** Project aliases: name → directory name or absolute path */
	aliases: Record<string, string>;
}

function readJsonSafe(filePath: string): Record<string, unknown> {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return {};
	}
}

export function expandHome(p: string): string {
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	if (p === "~") return os.homedir();
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

	// Resolve devDirs — support both "devDir" (string) and "devDirs" (array)
	const dirs: string[] = [];
	if (Array.isArray(merged.devDirs)) {
		for (const d of merged.devDirs) {
			if (typeof d === "string") dirs.push(expandHome(d));
		}
	}
	if (typeof merged.devDir === "string" && merged.devDir) {
		const expanded = expandHome(merged.devDir);
		if (!dirs.includes(expanded)) dirs.unshift(expanded);
	}
	if (dirs.length === 0) {
		dirs.push(path.join(os.homedir(), "Dev"));
	}

	// Resolve aliases — merge global + project (project overrides)
	const aliases: Record<string, string> = {};
	const globalAliases = (globalRaw as any)?.aliases;
	const projectAliases = (projectRaw as any)?.aliases;
	if (globalAliases && typeof globalAliases === "object") {
		for (const [k, v] of Object.entries(globalAliases)) {
			if (typeof v === "string") aliases[k.toLowerCase()] = v;
		}
	}
	if (projectAliases && typeof projectAliases === "object") {
		for (const [k, v] of Object.entries(projectAliases)) {
			if (typeof v === "string") aliases[k.toLowerCase()] = v;
		}
	}

	return {
		devDirs: dirs,
		devDir: dirs[0],
		aliases,
	};
}
