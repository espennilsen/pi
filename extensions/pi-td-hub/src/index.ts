/**
 * pi-td-hub — Cross-project task aggregator.
 *
 * Discovers all td databases (`.todos/issues.db`) across a configurable
 * root directory (default: ~/Dev) and provides a single `td_hub` tool
 * for cross-project task visibility.
 *
 * Read-only — never writes to any project's database.
 *
 * Configuration in settings.json under "pi-td-hub":
 * {
 *   "pi-td-hub": {
 *     "root": "~/Dev",
 *     "maxDepth": 3
 *   }
 * }
 */

import { readdirSync, existsSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import Database from "better-sqlite3";
import { Type } from "@sinclair/typebox";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── Types ────────────────────────────────────────────────────

interface ProjectInfo {
	name: string;
	path: string;
	dbPath: string;
}

interface Issue {
	id: string;
	title: string;
	description: string;
	status: string;
	type: string;
	priority: string;
	points: number;
	labels: string;
	parent_id: string;
	sprint: string;
	minor: number;
	created_branch: string;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	deleted_at: string | null;
	/** Injected by the aggregator — not in the DB schema. */
	project: string;
}

interface Config {
	root: string;
	maxDepth: number;
}

// ── Helpers ──────────────────────────────────────────────────

function expandHome(p: string): string {
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

function loadConfig(cwd: string): Config {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, unknown>;
	const project = sm.getProjectSettings() as Record<string, unknown>;
	const conf = {
		...(global["pi-td-hub"] as Record<string, unknown> ?? {}),
		...(project["pi-td-hub"] as Record<string, unknown> ?? {}),
	};

	return {
		root: typeof conf.root === "string" ? expandHome(conf.root) : join(homedir(), "Dev"),
		maxDepth: typeof conf.maxDepth === "number" ? conf.maxDepth : 3,
	};
}

/**
 * Discover all projects with .todos/issues.db under the root.
 */
function discoverProjects(root: string, maxDepth: number): ProjectInfo[] {
	const projects: ProjectInfo[] = [];

	function walk(dir: string, depth: number): void {
		if (depth > maxDepth) return;

		const dbPath = join(dir, ".todos", "issues.db");
		if (existsSync(dbPath)) {
			projects.push({
				name: basename(dir),
				path: dir,
				dbPath,
			});
			// Don't recurse deeper once we find a project
			return;
		}

		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				// Skip hidden dirs and node_modules
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				walk(join(dir, entry.name), depth + 1);
			}
		} catch {
			// Permission denied, etc. — skip silently
		}
	}

	walk(resolve(root), 0);
	return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Query issues from a single project database.
 * Opens the db read-only for each query — no persistent handles.
 */
function queryProject(project: ProjectInfo, where?: string, params?: unknown[]): Issue[] {
	let db: Database.Database | null = null;
	try {
		db = new Database(project.dbPath, { readonly: true });

		const baseWhere = "deleted_at IS NULL";
		const fullWhere = where ? `${baseWhere} AND (${where})` : baseWhere;

		const sql = `SELECT * FROM issues WHERE ${fullWhere} ORDER BY
			CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 ELSE 5 END,
			updated_at DESC`;

		const rows = db.prepare(sql).all(...(params ?? [])) as Issue[];
		return rows.map((r) => ({ ...r, project: project.name }));
	} catch {
		return [];
	} finally {
		db?.close();
	}
}

/**
 * Query all projects and aggregate results.
 */
function queryAll(projects: ProjectInfo[], where?: string, params?: unknown[]): Issue[] {
	const results: Issue[] = [];
	for (const p of projects) {
		results.push(...queryProject(p, where, params));
	}
	return results;
}

// ── Tool result formatting ───────────────────────────────────

function txt(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

function json(data: unknown) {
	return txt(JSON.stringify(data, null, 2));
}

// ── Actions ──────────────────────────────────────────────────

function actionProjects(projects: ProjectInfo[]): ReturnType<typeof txt> {
	const rows = projects.map((p) => {
		const issues = queryProject(p, "status != 'closed'");
		const byStatus: Record<string, number> = {};
		for (const i of issues) {
			byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
		}
		return {
			project: p.name,
			path: p.path,
			open: issues.length,
			breakdown: byStatus,
		};
	});

	const total = rows.reduce((sum, r) => sum + r.open, 0);
	const lines = [
		`# Projects (${rows.length} repos, ${total} open tasks)\n`,
		"| Project | Open | In Progress | In Review | Blocked |",
		"|---------|------|-------------|-----------|---------|",
	];
	for (const r of rows) {
		lines.push(
			`| ${r.project} | ${r.open} | ${r.breakdown["in_progress"] ?? 0} | ${r.breakdown["in_review"] ?? 0} | ${r.breakdown["blocked"] ?? 0} |`,
		);
	}
	return txt(lines.join("\n"));
}

function actionStatus(projects: ProjectInfo[]): ReturnType<typeof txt> {
	const all = queryAll(projects, "status != 'closed'");

	// By status
	const byStatus: Record<string, number> = {};
	// By priority
	const byPriority: Record<string, number> = {};
	// By type
	const byType: Record<string, number> = {};
	// By age bucket
	const ageBuckets = { "< 1d": 0, "1-7d": 0, "1-4w": 0, "> 4w": 0 };
	const now = Date.now();

	for (const i of all) {
		byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
		byPriority[i.priority] = (byPriority[i.priority] ?? 0) + 1;
		byType[i.type] = (byType[i.type] ?? 0) + 1;

		const ageMs = now - new Date(i.created_at).getTime();
		const ageDays = ageMs / (1000 * 60 * 60 * 24);
		if (ageDays < 1) ageBuckets["< 1d"]++;
		else if (ageDays < 7) ageBuckets["1-7d"]++;
		else if (ageDays < 28) ageBuckets["1-4w"]++;
		else ageBuckets["> 4w"]++;
	}

	const lines = [
		`# Cross-Project Status (${all.length} open tasks across ${projects.length} repos)\n`,
		"## By Status",
		...Object.entries(byStatus).sort().map(([k, v]) => `- **${k}:** ${v}`),
		"",
		"## By Priority",
		...["P0", "P1", "P2", "P3", "P4"].filter((p) => byPriority[p]).map((p) => `- **${p}:** ${byPriority[p]}`),
		"",
		"## By Type",
		...Object.entries(byType).sort().map(([k, v]) => `- **${k}:** ${v}`),
		"",
		"## By Age",
		...Object.entries(ageBuckets).filter(([, v]) => v > 0).map(([k, v]) => `- **${k}:** ${v}`),
	];

	// Top 10 highest priority
	const topP0P1 = all.filter((i) => i.priority === "P0" || i.priority === "P1").slice(0, 10);
	if (topP0P1.length > 0) {
		lines.push("", "## Top Priority (P0/P1)");
		for (const i of topP0P1) {
			lines.push(`- **[${i.project}]** ${i.id} — ${i.title} (${i.priority}, ${i.status})`);
		}
	}

	return txt(lines.join("\n"));
}

function actionPipeline(projects: ProjectInfo[]): ReturnType<typeof txt> {
	const all = queryAll(projects, "status != 'closed'");

	const stages = ["queued", "planning", "building", "reviewing", "pr-ready", "approved"];
	const pipeline: Record<string, Issue[]> = {};
	const unpipelined: Issue[] = [];

	for (const stage of stages) pipeline[stage] = [];

	for (const i of all) {
		const labels = i.labels ? i.labels.split(",").map((l) => l.trim()) : [];
		const pipelineLabel = labels.find((l) => l.startsWith("pipeline:"));
		if (pipelineLabel) {
			const stage = pipelineLabel.replace("pipeline:", "");
			if (pipeline[stage]) {
				pipeline[stage].push(i);
			} else {
				// Unknown stage — still track it so it's rendered
				pipeline[stage] = [i];
			}
		} else {
			unpipelined.push(i);
		}
	}

	const lines = ["# Pipeline View\n"];

	const emoji: Record<string, string> = {
		queued: "📋", planning: "📐", building: "🔨",
		reviewing: "👀", "pr-ready": "🚀", approved: "✅",
	};

	// Render known stages first, then any extra stages
	const extraStages = Object.keys(pipeline).filter((s) => !stages.includes(s)).sort();
	const allStages = [...stages, ...extraStages];

	for (const stage of allStages) {
		const items = pipeline[stage] ?? [];
		lines.push(`## ${emoji[stage] ?? "📌"} ${stage} (${items.length})`);
		if (items.length === 0) {
			lines.push("_none_\n");
		} else {
			for (const i of items) {
				lines.push(`- **[${i.project}]** ${i.id} — ${i.title} (${i.priority})`);
			}
			lines.push("");
		}
	}

	lines.push(`## 📌 Unpipelined (${unpipelined.length})`);
	if (unpipelined.length > 0) {
		// Show by project, just counts
		const byProject: Record<string, number> = {};
		for (const i of unpipelined) {
			byProject[i.project] = (byProject[i.project] ?? 0) + 1;
		}
		for (const [proj, count] of Object.entries(byProject).sort((a, b) => b[1] - a[1])) {
			lines.push(`- ${proj}: ${count} tasks`);
		}
	}

	return txt(lines.join("\n"));
}

function actionQuery(
	projects: ProjectInfo[],
	params: { status?: string; priority?: string; type?: string; labels?: string; project?: string },
): ReturnType<typeof txt> {
	let filteredProjects = projects;
	if (params.project) {
		const p = params.project.toLowerCase();
		filteredProjects = projects.filter((proj) => proj.name.toLowerCase().includes(p));
		if (filteredProjects.length === 0) {
			return txt(`No projects matching "${params.project}".`);
		}
	}

	const conditions: string[] = [];
	const sqlParams: unknown[] = [];

	if (params.status) {
		conditions.push("status = ?");
		sqlParams.push(params.status);
	} else {
		conditions.push("status != 'closed'");
	}

	if (params.priority) {
		conditions.push("priority = ?");
		sqlParams.push(params.priority);
	}

	if (params.type) {
		conditions.push("type = ?");
		sqlParams.push(params.type);
	}

	if (params.labels) {
		// Match any of the comma-separated labels
		const labelList = params.labels.split(",").map((l) => l.trim());
		const labelConditions = labelList.map(() => "labels LIKE ?");
		conditions.push(`(${labelConditions.join(" OR ")})`);
		for (const l of labelList) sqlParams.push(`%${l}%`);
	}

	const where = conditions.join(" AND ");
	const results = queryAll(filteredProjects, where, sqlParams);

	if (results.length === 0) {
		return txt("No tasks match the query.");
	}

	const lines = [`# Query Results (${results.length} tasks)\n`];
	for (const i of results) {
		const labels = i.labels ? ` [${i.labels}]` : "";
		const minor = i.minor ? " (minor)" : "";
		lines.push(`- **[${i.project}]** ${i.id} — ${i.title} (${i.priority}, ${i.status}, ${i.type})${labels}${minor}`);
	}

	return txt(lines.join("\n"));
}

function actionSearch(projects: ProjectInfo[], query: string): ReturnType<typeof txt> {
	if (!query.trim()) {
		return txt("Search query cannot be empty.");
	}

	// Escape LIKE wildcards so user input is treated as literal text
	const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
	const term = `%${escaped}%`;
	const results = queryAll(projects, "status != 'closed' AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')", [term, term, term]);

	if (results.length === 0) {
		return txt(`No tasks matching "${query}".`);
	}

	const lines = [`# Search: "${query}" (${results.length} results)\n`];
	for (const i of results) {
		const labels = i.labels ? ` [${i.labels}]` : "";
		lines.push(`- **[${i.project}]** ${i.id} — ${i.title} (${i.priority}, ${i.status})${labels}`);
	}

	return txt(lines.join("\n"));
}

// ── Extension Entry Point ────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let cwd = process.cwd();

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
	});

	pi.registerTool({
		name: "td_hub",
		label: "TD Hub",
		description:
			"Cross-project task aggregator. Reads td databases across all repos " +
			"for PM-level visibility. Actions: projects (list repos + task counts), " +
			"status (cross-project summary by status/priority/type/age), " +
			"pipeline (group by pipeline:* labels), " +
			"query (filter by status/priority/type/labels/project), " +
			"search (full-text search across all tasks).",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("projects"),
				Type.Literal("status"),
				Type.Literal("pipeline"),
				Type.Literal("query"),
				Type.Literal("search"),
			], { description: "Action to perform" }),
			// Query filters (for 'query' action)
			status: Type.Optional(Type.String({ description: "Filter by status: open, in_progress, in_review, blocked, closed" })),
			priority: Type.Optional(Type.String({ description: "Filter by priority: P0, P1, P2, P3, P4" })),
			type: Type.Optional(Type.String({ description: "Filter by type: task, bug, feature, epic, chore" })),
			labels: Type.Optional(Type.String({ description: "Filter by labels (comma-separated, matches any)" })),
			project: Type.Optional(Type.String({ description: "Filter to a specific project name (partial match)" })),
			// Search query (for 'search' action)
			query: Type.Optional(Type.String({ description: "Search term for full-text search across titles, descriptions, and IDs" })),
		}),
		async execute(_toolCallId, params) {
			const config = loadConfig(cwd);
			const projects = discoverProjects(config.root, config.maxDepth);

			if (projects.length === 0) {
				return txt(`No td projects found under ${config.root}. Check pi-td-hub.root in settings.json.`);
			}

			switch (params.action) {
				case "projects":
					return actionProjects(projects);
				case "status":
					return actionStatus(projects);
				case "pipeline":
					return actionPipeline(projects);
				case "query":
					return actionQuery(projects, {
						status: params.status,
						priority: params.priority,
						type: params.type,
						labels: params.labels,
						project: params.project,
					});
				case "search":
					if (!params.query) {
						return txt("The 'search' action requires a 'query' parameter.");
					}
					return actionSearch(projects, params.query);
				default:
					return txt("Unknown action. Use: projects, status, pipeline, query, search.");
			}
		},
	});
}
