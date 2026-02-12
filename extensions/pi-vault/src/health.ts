/**
 * Vault health data computation.
 *
 * Computes vault metrics (streak, projects, tasks, tags, recent activity)
 * using the Obsidian REST API with filesystem fallback for daily notes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { VaultConfig } from "./api-client.ts";
import { apiRequest } from "./api-client.ts";

// ── Types ───────────────────────────────────────────────────────

export interface VaultHealthData {
	vaultName: string;
	totalNotes: number;
	activeProjects: number;
	openTasks: number;
	currentStreak: number;
	longestStreak: number;
	notesThisWeek: number;
	dailyNotes: string[];
	staleProjects: Array<{ name: string; path: string; lastModified: string; daysSince: number }>;
	taskBreakdown: Record<string, number>;
	topTags: Array<{ tag: string; count: number }>;
	recentNotes: Array<{ path: string; type: string; modified: string }>;
	errors: string[];
}

// ── Health data computation ─────────────────────────────────────

/**
 * Compute vault health data using the Obsidian Local REST API.
 *
 * DQL queries are hardcoded (no user input interpolation). If adding
 * parameterized queries in the future, sanitize inputs — DQL has no
 * prepared statement mechanism.
 */
export async function getVaultHealthData(config: VaultConfig): Promise<VaultHealthData> {
	const hasApi = !!(config.apiKey && config.apiUrl);
	const errors: string[] = [];

	// ── Daily notes (filesystem — always available) ──────────
	let dailyNotes: string[] = [];
	try {
		const dailyDir = path.join(config.vaultPath, "Notes", "Daily");
		if (fs.existsSync(dailyDir)) {
			dailyNotes = fs.readdirSync(dailyDir)
				.filter(f => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
				.map(f => f.replace(".md", ""))
				.sort();
		}
	} catch {}

	// Streak calculation
	const noteSet = new Set(dailyNotes);
	const today = new Date();
	let currentStreak = 0;
	let longestStreak = 0;
	let currentStreakDone = false;
	let run = 0;

	for (let i = 0; i < 365; i++) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const key = d.toISOString().slice(0, 10);
		if (noteSet.has(key)) {
			run++;
		} else {
			if (!currentStreakDone) {
				currentStreak = run;
				currentStreakDone = true;
			}
			longestStreak = Math.max(longestStreak, run);
			run = 0;
		}
	}
	if (!currentStreakDone) currentStreak = run;
	longestStreak = Math.max(longestStreak, run);

	const weekAgo = new Date(today);
	weekAgo.setDate(weekAgo.getDate() - 7);
	const weekAgoStr = weekAgo.toISOString().slice(0, 10);
	const notesThisWeek = dailyNotes.filter(d => d >= weekAgoStr).length;

	// ── Projects (API) ───────────────────────────────────────
	let activeProjects = 0;
	let staleProjects: VaultHealthData["staleProjects"] = [];

	if (hasApi) {
		try {
			const dql = `TABLE file.tags AS "Tags", file.mtime AS "Modified" FROM "1. Projects" WHERE file.name != "_Index" AND contains(file.tags, "project") SORT file.mtime DESC`;
			const res = await apiRequest(config, "POST", "/search/", {
				body: dql, contentType: "application/vnd.olrapi.dataview.dql+txt", timeoutMs: 30_000,
			});
			if (!res.ok) { if (res.error) errors.push(res.error); }
			else if (Array.isArray(res.data)) {
				for (const r of res.data) {
					const tags: string[] = Array.isArray(r.result?.Tags) ? r.result.Tags : [];
					const isActive = tags.some((t: string) => t === "#project/active" || t === "project/active");
					const mtime = r.result?.Modified ?? r.result?.["Modified"];
					if (isActive) activeProjects++;
					if (isActive && mtime) {
						const modDate = new Date(typeof mtime === "object" && mtime.ts ? mtime.ts : mtime);
						const daysSince = Math.floor((today.getTime() - modDate.getTime()) / 86400000);
						if (daysSince > 30) {
							const name = r.filename.replace(/\.md$/, "").split("/").pop() ?? r.filename;
							staleProjects.push({ name, path: r.filename, lastModified: modDate.toISOString().slice(0, 10), daysSince });
						}
					}
				}
				staleProjects.sort((a, b) => b.daysSince - a.daysSince);
			}
		} catch {}
	}

	// ── Tasks (API) ──────────────────────────────────────────
	let taskBreakdown: Record<string, number> = {};
	let openTasks = 0;

	if (hasApi) {
		try {
			const dql = `TABLE status FROM "Tasks" WHERE file.name != "_Index" AND file.name != "_TaskNotes Workflow Guide"`;
			const res = await apiRequest(config, "POST", "/search/", {
				body: dql, contentType: "application/vnd.olrapi.dataview.dql+txt", timeoutMs: 30_000,
			});
			if (!res.ok) { if (res.error) errors.push(res.error); }
			else if (Array.isArray(res.data)) {
				for (const r of res.data) {
					const status = String(r.result?.Status ?? r.result?.status ?? "unknown").toLowerCase();
					taskBreakdown[status] = (taskBreakdown[status] ?? 0) + 1;
					if (status === "open" || status === "in-progress") openTasks++;
				}
			}
		} catch {}
	}

	// ── Tags (API) ───────────────────────────────────────────
	let topTags: VaultHealthData["topTags"] = [];

	if (hasApi) {
		try {
			const query = JSON.stringify({ "var": "tags" });
			const res = await apiRequest(config, "POST", "/search/", {
				body: query, contentType: "application/vnd.olrapi.jsonlogic+json", timeoutMs: 30_000,
			});
			if (!res.ok) { if (res.error) errors.push(res.error); }
			else if (Array.isArray(res.data)) {
				const tagCounts = new Map<string, number>();
				for (const r of res.data) {
					const tags: string[] = Array.isArray(r.result) ? r.result : [];
					for (const t of tags) {
						tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
					}
				}
				topTags = [...tagCounts.entries()]
					.map(([tag, count]) => ({ tag, count }))
					.sort((a, b) => b.count - a.count)
					.slice(0, 30);
			}
		} catch {}
	}

	// ── Recent activity (API) ────────────────────────────────
	let recentNotes: VaultHealthData["recentNotes"] = [];
	let totalNotes = 0;

	if (hasApi) {
		try {
			const dql = `TABLE type, file.mtime AS "Modified" FROM "" WHERE file.name != "_Index" SORT file.mtime DESC LIMIT 30`;
			const res = await apiRequest(config, "POST", "/search/", {
				body: dql, contentType: "application/vnd.olrapi.dataview.dql+txt", timeoutMs: 30_000,
			});
			if (!res.ok) { if (res.error) errors.push(res.error); }
			else if (Array.isArray(res.data)) {
				for (const r of res.data) {
					const mtime = r.result?.Modified ?? r.result?.["Modified"];
					const modStr = mtime ? new Date(typeof mtime === "object" && mtime.ts ? mtime.ts : mtime).toISOString() : "";
					recentNotes.push({
						path: r.filename,
						type: String(r.result?.Type ?? r.result?.type ?? "note"),
						modified: modStr,
					});
				}
			}
		} catch {}

		try {
			const dql = `TABLE file.name FROM "" LIMIT 9999`;
			const res = await apiRequest(config, "POST", "/search/", {
				body: dql, contentType: "application/vnd.olrapi.dataview.dql+txt", timeoutMs: 30_000,
			});
			if (!res.ok) { if (res.error) errors.push(res.error); }
			else if (Array.isArray(res.data)) totalNotes = res.data.length;
		} catch {}
	}

	return {
		vaultName: config.vaultName,
		totalNotes,
		activeProjects,
		openTasks,
		currentStreak,
		longestStreak,
		notesThisWeek,
		dailyNotes,
		staleProjects,
		taskBreakdown,
		topTags,
		recentNotes,
		errors,
	};
}
