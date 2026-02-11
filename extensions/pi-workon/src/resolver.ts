/**
 * pi-workon — Project name → path resolution.
 *
 * Resolves project references (name, alias, or path) to filesystem paths.
 * Supports exact match, alias lookup, case-insensitive, and fuzzy matching.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Types ───────────────────────────────────────────────────────

export interface ResolvedProject {
	path: string;
	name: string;
	exact: boolean;
}

export type ResolveResult =
	| { resolved: ResolvedProject }
	| { error: string; suggestions: string[] };

// ── Alias Registry ──────────────────────────────────────────────

/**
 * Known project name → subdirectory mappings for fuzzy matching.
 * Users can extend this via settings in the future.
 */
const PROJECT_ALIASES: Record<string, string> = {
	hannah: "pi",
	pi: "pi",
	blog: "e9n.dev",
	e9n: "e9n.dev",
	hovdan: "Hovdan Seil AS",
	hovdanseil: "Hovdan Seil AS",
	sailmaker: "Hovdan Seil AS",
	salesgpt: "SalesGPT",
	localbooks: "LocalBooks",
	comfyui: "comfyui-cheatsheet",
	journal: "Journal App",
	pidesktop: "Pi Desktop",
	"pi-desktop": "Pi Desktop",
	meddpicc: "MEDDPICC",
	stoictracker: "stoic-tracker",
	stoic: "stoic-tracker",
	crewmap: "CrewMap",
	obsidianagent: "obsidian-agent",
	mcpbridge: "MCP-Bridge",
	x10s: "x10s",
	x10spi: "x10s-pi",
	claudecode: "ClaudeCode",
	starheim: "Starheim",
	hjernedal: "hjernedal.no",
	vibebox: "VibeBox",
	"sail la vie": "Sail La Vie",
};

// ── Resolver ────────────────────────────────────────────────────

/**
 * Resolve a project reference (name, alias, or path) to a filesystem path.
 */
export function resolveProject(
	input: string,
	devDir: string,
): ResolveResult {
	// 1. Absolute or relative path
	if (
		input.startsWith("/") ||
		input.startsWith("~") ||
		input.startsWith("./")
	) {
		const resolved = input.startsWith("~")
			? path.join(os.homedir(), input.slice(1))
			: path.resolve(input);
		if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
			return {
				resolved: {
					path: resolved,
					name: path.basename(resolved),
					exact: true,
				},
			};
		}
		return { error: `Path does not exist: ${resolved}`, suggestions: [] };
	}

	// 2. Exact match in devDir
	const exactPath = path.join(devDir, input);
	if (fs.existsSync(exactPath) && fs.statSync(exactPath).isDirectory()) {
		return {
			resolved: { path: exactPath, name: input, exact: true },
		};
	}

	// 3. Alias lookup
	const normalized = input.toLowerCase().replace(/[\s\-_]/g, "");
	const alias = PROJECT_ALIASES[normalized];
	if (alias) {
		const aliasPath = path.join(devDir, alias);
		if (
			fs.existsSync(aliasPath) &&
			fs.statSync(aliasPath).isDirectory()
		) {
			return {
				resolved: { path: aliasPath, name: alias, exact: true },
			};
		}
	}

	// 4. Case-insensitive and fuzzy match
	try {
		const entries = fs.readdirSync(devDir);
		const inputLower = input.toLowerCase();

		// Exact case-insensitive
		const ciMatch = entries.find(
			(e) => e.toLowerCase() === inputLower,
		);
		if (ciMatch) {
			const ciPath = path.join(devDir, ciMatch);
			if (fs.statSync(ciPath).isDirectory()) {
				return {
					resolved: {
						path: ciPath,
						name: ciMatch,
						exact: true,
					},
				};
			}
		}

		// Fuzzy: contains
		const fuzzy = entries.filter((e) => {
			const eLower = e.toLowerCase().replace(/[\s\-_]/g, "");
			return (
				eLower.includes(normalized) || normalized.includes(eLower)
			);
		});
		if (fuzzy.length === 1) {
			const fp = path.join(devDir, fuzzy[0]);
			if (fs.statSync(fp).isDirectory()) {
				return {
					resolved: {
						path: fp,
						name: fuzzy[0],
						exact: false,
					},
				};
			}
		}

		if (fuzzy.length > 1) {
			return {
				error: `Ambiguous project name "${input}". Did you mean one of these?`,
				suggestions: fuzzy,
			};
		}
	} catch {
		// devDir doesn't exist
	}

	return {
		error: `Could not find project "${input}" in ${devDir}`,
		suggestions: [],
	};
}

// ── Directory Listing ───────────────────────────────────────────

/** List all project directories in devDir */
export function listProjectDirs(devDir: string): string[] {
	try {
		return fs
			.readdirSync(devDir)
			.filter((e) => {
				if (e.startsWith(".") || e.startsWith("!") || e === "Archive") return false;
				try {
					return fs
						.statSync(path.join(devDir, e))
						.isDirectory();
				} catch {
					return false;
				}
			})
			.sort();
	} catch {
		return [];
	}
}
