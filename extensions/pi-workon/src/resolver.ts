/**
 * pi-workon — Project name → path resolution.
 *
 * Resolves project references (name, alias, or path) to filesystem paths.
 * Supports exact match, settings-based aliases, case-insensitive, and fuzzy matching.
 * Scans multiple devDirs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { expandHome } from "./settings.ts";

// ── Types ───────────────────────────────────────────────────────

export interface ResolvedProject {
	path: string;
	name: string;
	exact: boolean;
}

export type ResolveResult =
	| { resolved: ResolvedProject }
	| { error: string; suggestions: string[] };

// ── Resolver ────────────────────────────────────────────────────

/**
 * Resolve a project reference (name, alias, or path) to a filesystem path.
 * Searches through all devDirs and aliases.
 */
export function resolveProject(
	input: string,
	devDirs: string[],
	aliases: Record<string, string> = {},
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

	// 2. Alias lookup
	const normalized = input.toLowerCase().replace(/[\s\-_]/g, "");
	const aliasValue = aliases[normalized] ?? aliases[input.toLowerCase()];
	if (aliasValue) {
		// Alias can be an absolute/home path or a project name
		if (aliasValue.startsWith("/") || aliasValue.startsWith("~")) {
			const resolved = expandHome(aliasValue);
			if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
				return {
					resolved: { path: resolved, name: path.basename(resolved), exact: true },
				};
			}
		} else {
			// Resolve alias against all devDirs
			for (const devDir of devDirs) {
				const aliasPath = path.join(devDir, aliasValue);
				if (fs.existsSync(aliasPath) && fs.statSync(aliasPath).isDirectory()) {
					return {
						resolved: { path: aliasPath, name: aliasValue, exact: true },
					};
				}
			}
		}
	}

	// 3. Exact match across all devDirs
	for (const devDir of devDirs) {
		const exactPath = path.join(devDir, input);
		if (fs.existsSync(exactPath) && fs.statSync(exactPath).isDirectory()) {
			return {
				resolved: { path: exactPath, name: input, exact: true },
			};
		}
	}

	// 4. Case-insensitive and fuzzy match across all devDirs
	const inputLower = input.toLowerCase();
	const allMatches: { name: string; path: string; exact: boolean }[] = [];

	for (const devDir of devDirs) {
		try {
			const entries = fs.readdirSync(devDir);

			// Exact case-insensitive
			const ciMatch = entries.find((e) => e.toLowerCase() === inputLower);
			if (ciMatch) {
				const ciPath = path.join(devDir, ciMatch);
				if (fs.statSync(ciPath).isDirectory()) {
					return {
						resolved: { path: ciPath, name: ciMatch, exact: true },
					};
				}
			}

			// Fuzzy: contains
			const fuzzy = entries.filter((e) => {
				const eLower = e.toLowerCase().replace(/[\s\-_]/g, "");
				return eLower.includes(normalized) || normalized.includes(eLower);
			});
			for (const f of fuzzy) {
				const fp = path.join(devDir, f);
				try {
					if (fs.statSync(fp).isDirectory()) {
						allMatches.push({ name: f, path: fp, exact: false });
					}
				} catch { /* skip */ }
			}
		} catch {
			// devDir doesn't exist
		}
	}

	if (allMatches.length === 1) {
		return {
			resolved: {
				path: allMatches[0].path,
				name: allMatches[0].name,
				exact: false,
			},
		};
	}

	if (allMatches.length > 1) {
		return {
			error: `Ambiguous project name "${input}". Did you mean one of these?`,
			suggestions: allMatches.map((m) => m.name),
		};
	}

	const searchedIn = devDirs.length === 1 ? devDirs[0] : `${devDirs.length} directories`;
	return {
		error: `Could not find project "${input}" in ${searchedIn}`,
		suggestions: [],
	};
}

// ── Directory Listing ───────────────────────────────────────────

/** List all project directories across all devDirs */
export function listProjectDirs(devDirs: string[]): { name: string; path: string; devDir: string }[] {
	const results: { name: string; path: string; devDir: string }[] = [];
	const seen = new Set<string>();

	for (const devDir of devDirs) {
		try {
			const entries = fs.readdirSync(devDir)
				.filter((e) => {
					if (e.startsWith(".") || e.startsWith("!") || e === "Archive") return false;
					try {
						return fs.statSync(path.join(devDir, e)).isDirectory();
					} catch {
						return false;
					}
				})
				.sort();

			for (const entry of entries) {
				const fullPath = path.join(devDir, entry);
				if (!seen.has(fullPath)) {
					seen.add(fullPath);
					results.push({ name: entry, path: fullPath, devDir });
				}
			}
		} catch {
			// devDir doesn't exist
		}
	}

	return results;
}
