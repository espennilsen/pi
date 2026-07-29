/**
 * pi-projects — Git repo discovery and metadata extraction.
 *
 * Scans configured directories for git repos and extracts:
 * branch, last commit, dirty status, ahead/behind, remote URL.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getProjectsStore } from "./store.ts";

const execFileAsync = promisify(execFile);

export interface ProjectInfo {
	name: string;
	path: string;
	is_git: boolean;
	branch?: string;
	last_commit_hash?: string;
	last_commit_msg?: string;
	last_commit_date?: string;
	remote_url?: string | null;
	dirty_count?: number;
	staged?: number;
	modified?: number;
	untracked?: number;
	deleted?: number;
	ahead?: number;
	behind?: number;
}

export async function scanProjects(devDir: string): Promise<ProjectInfo[]> {
	const store = getProjectsStore();

	// Collect all scan directories
	const sources: string[] = [devDir];
	for (const src of await store.getProjectSources()) {
		if (!sources.includes(src.path)) sources.push(src.path);
	}

	// Collect hidden paths
	const hiddenSet = new Set((await store.getHiddenProjects()).map(h => h.project_path));

	// Scan all source dirs, dedup by resolved path
	const seen = new Set<string>();
	const allEntries: Array<{ name: string; dir: string }> = [];

	for (const sourceDir of sources) {
		if (!fs.existsSync(sourceDir)) continue;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(sourceDir, { withFileTypes: true })
				.filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules");
		} catch { continue; }

		for (const e of entries) {
			const fullPath = path.join(sourceDir, e.name);
			if (!seen.has(fullPath) && !hiddenSet.has(fullPath)) {
				seen.add(fullPath);
				allEntries.push({ name: e.name, dir: fullPath });
			}
		}
	}

	return Promise.all(allEntries.map(async (entry) => {
		const dir = entry.dir;
		const isGit = fs.existsSync(path.join(dir, ".git"));

		if (!isGit) {
			return { name: entry.name, path: dir, is_git: false };
		}

		try {
			const opts = { cwd: dir, timeout: 5000 };
			const [logResult, statusResult, branchResult, remoteResult, revParseResult] = await Promise.all([
				execFileAsync("git", ["log", "--oneline", "--format=%h|%s|%aI", "-1"], opts).catch(() => ({ stdout: "" })),
				execFileAsync("git", ["status", "--porcelain"], opts).catch(() => ({ stdout: "" })),
				execFileAsync("git", ["branch", "--show-current"], opts).catch(() => ({ stdout: "" })),
				execFileAsync("git", ["remote", "get-url", "origin"], opts).catch(() => ({ stdout: "" })),
				execFileAsync("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], opts).catch(() => ({ stdout: "" })),
			]);

			// Parse last commit
			const logParts = (logResult.stdout as string).trim().split("|");
			const lastCommitHash = logParts[0] || "";
			const lastCommitMsg = logParts[1] || "";
			const lastCommitDate = logParts[2] || "";

			// Parse status
			const statusLines = (statusResult.stdout as string).trim().split("\n").filter(Boolean);
			let staged = 0, modified = 0, untracked = 0, deleted = 0;
			for (const line of statusLines) {
				const x = line[0], y = line[1];
				if (x === "?" && y === "?") { untracked++; continue; }
				if (x !== " " && x !== "?") {
					if (x === "D") deleted++;
					else staged++;
				}
				if (y !== " " && y !== "?") {
					if (y === "D") deleted++;
					else modified++;
				}
			}

			// Ahead/behind
			let ahead = 0, behind = 0;
			const upstream = (revParseResult.stdout as string).trim();
			if (upstream) {
				try {
					const abResult = await execFileAsync("git", ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], opts);
					const parts = (abResult.stdout as string).trim().split(/\s+/);
					ahead = parseInt(parts[0]) || 0;
					behind = parseInt(parts[1]) || 0;
				} catch { /* no upstream tracking */ }
			}

			return {
				name: entry.name,
				path: dir,
				is_git: true,
				branch: (branchResult.stdout as string).trim() || "HEAD",
				last_commit_hash: lastCommitHash,
				last_commit_msg: lastCommitMsg,
				last_commit_date: lastCommitDate,
				remote_url: (remoteResult.stdout as string).trim() || null,
				dirty_count: statusLines.length,
				staged, modified, untracked, deleted,
				ahead, behind,
			};
		} catch {
			return { name: entry.name, path: dir, is_git: true, branch: "?", dirty_count: 0 };
		}
	}));
}
