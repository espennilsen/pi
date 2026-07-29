/**
 * Cross-Project td — read issues from all projects' .todos/issues.db
 *
 * Opens each project's td database read-only, queries issues, and merges
 * them into a unified list with a project name column.
 *
 * Used by the /api/td/global endpoint and the "All Projects" view on the tasks page.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import type { CrossProjectConfig } from "./td-settings.ts";

export interface CrossProjectIssue {
	project: string;
	projectPath: string;
	id: string;
	title: string;
	description: string;
	status: string;
	type: string;
	priority: string;
	labels: string[];
	implementer_session: string;
	parent_id: string;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
}

/** Find all directories with .todos/issues.db */
function findTdProjects(
	rootDir: string,
	maxDepth: number,
): Array<{ name: string; path: string; dbPath: string }> {
	const projects: Array<{ name: string; path: string; dbPath: string }> = [];
	const seen = new Set<string>();
	const normalizedRoot = path.resolve(rootDir);

	const shouldSkip = (entry: string) =>
		entry.startsWith(".") || entry === "Archive" || entry === "node_modules" || entry === ".pi" || entry === ".git";

	const formatName = (dir: string) => {
		const relative = path.relative(normalizedRoot, dir);
		const name = relative && relative !== "" ? relative : path.basename(dir);
		return name.split(path.sep).join("/");
	};

	const scan = (dir: string, depth: number) => {
		const dbPath = path.join(dir, ".todos", "issues.db");
		if (!seen.has(dbPath) && fs.existsSync(dbPath)) {
			seen.add(dbPath);
			projects.push({ name: formatName(dir), path: dir, dbPath });
		}

		if (depth <= 0) return;
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (shouldSkip(entry.name)) continue;
			scan(path.join(dir, entry.name), depth - 1);
		}
	};

	try {
		if (!fs.statSync(normalizedRoot).isDirectory()) return [];
	} catch {
		return [];
	}

	scan(normalizedRoot, Math.max(0, Math.floor(maxDepth)));

	return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read issues from a single project's td database (read-only) */
function readProjectIssues(
	project: { name: string; path: string; dbPath: string },
	options: { includesClosed?: boolean; status?: string; priority?: string; type?: string } = {},
): CrossProjectIssue[] {
	let db: Database.Database | null = null;
	try {
		db = new Database(project.dbPath, { readonly: true, fileMustExist: true });

		let query = `
			SELECT id, title, description, status, type, priority, labels,
				implementer_session, parent_id, created_at, updated_at, closed_at
			FROM issues
			WHERE deleted_at IS NULL
		`;
		const params: any[] = [];

		if (!options.includesClosed) {
			query += " AND status != 'closed'";
		}
		if (options.status) {
			query += " AND status = ?";
			params.push(options.status);
		}
		if (options.priority) {
			query += " AND priority = ?";
			params.push(options.priority);
		}
		if (options.type) {
			query += " AND type = ?";
			params.push(options.type);
		}

		query += " ORDER BY updated_at DESC";

		const rows = db.prepare(query).all(...params) as any[];

		return rows.map((row) => ({
			project: project.name,
			projectPath: project.path,
			...row,
			// td stores labels as comma-separated string in SQLite,
			// but the local td CLI returns them as an array. Normalize to array.
			labels: row.labels
				? (row.labels as string).split(",").map((l: string) => l.trim()).filter(Boolean)
				: [],
		}));
	} catch {
		// Corrupt or locked DB — skip
		return [];
	} finally {
		db?.close();
	}
}

/** Get all issues across all projects */
export function getAllProjectIssues(
	options: {
		includeClosed?: boolean;
		status?: string;
		priority?: string;
		type?: string;
		project?: string;
	} = {},
	config: CrossProjectConfig,
): { projects: string[]; issues: CrossProjectIssue[] } {
	const tdProjects = findTdProjects(config.rootDir, config.maxDepth);
	const filteredProjects = options.project
		? tdProjects.filter((p) => p.name.toLowerCase() === options.project!.toLowerCase())
		: tdProjects;

	const allIssues: CrossProjectIssue[] = [];
	for (const proj of filteredProjects) {
		const issues = readProjectIssues(proj, {
			includesClosed: options.includeClosed,
			status: options.status,
			priority: options.priority,
			type: options.type,
		});
		allIssues.push(...issues);
	}

	// Sort by priority then updated_at
	const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
	allIssues.sort((a, b) => {
		const pa = priorityOrder[a.priority] ?? 5;
		const pb = priorityOrder[b.priority] ?? 5;
		if (pa !== pb) return pa - pb;
		return b.updated_at.localeCompare(a.updated_at);
	});

	return {
		projects: tdProjects.map((p) => p.name),
		issues: allIssues,
	};
}

// ── Dependency tree ─────────────────────────────────────────────

export interface TreeNode {
	id: string;
	title: string;
	status: string;
	type: string;
	priority: string;
	labels: string[];
	implementer_session: string;
	parent_id: string;
}

export interface TreeEdge {
	source: string; // depends_on_id (must be done first — parent in tree)
	target: string; // issue_id (depends on source — child in tree)
	type: "depends_on" | "parent_child";
}

export interface TreeData {
	nodes: TreeNode[];
	edges: TreeEdge[];
}

/** Read dependency tree for a single project (local or by path) */
export function getProjectTree(projectPath: string): TreeData {
	const dbPath = path.join(projectPath, ".todos", "issues.db");
	let db: Database.Database | null = null;
	try {
		db = new Database(dbPath, { readonly: true, fileMustExist: true });

		const nodes = db
			.prepare(
				`SELECT id, title, status, type, priority, labels, implementer_session, parent_id
			 FROM issues WHERE deleted_at IS NULL`,
			)
			.all() as any[];

		const deps = db
			.prepare(`SELECT issue_id, depends_on_id FROM issue_dependencies`)
			.all() as Array<{ issue_id: string; depends_on_id: string }>;

		const treeNodes: TreeNode[] = nodes.map((row) => ({
			...row,
			labels: row.labels
				? (row.labels as string)
						.split(",")
						.map((l: string) => l.trim())
						.filter(Boolean)
				: [],
		}));

		const edges: TreeEdge[] = [];

		// depends_on edges: source (dep) enables target (issue)
		for (const dep of deps) {
			edges.push({
				source: dep.depends_on_id,
				target: dep.issue_id,
				type: "depends_on",
			});
		}

		// parent_child edges from parent_id
		for (const node of treeNodes) {
			if (node.parent_id) {
				edges.push({
					source: node.parent_id,
					target: node.id,
					type: "parent_child",
				});
			}
		}

		return { nodes: treeNodes, edges };
	} catch {
		return { nodes: [], edges: [] };
	} finally {
		db?.close();
	}
}

/** Get summary stats across all projects */
export function getCrossProjectStats(config: CrossProjectConfig): {
	projects: Array<{ name: string; total: number; open: number; inProgress: number; inReview: number; blocked: number }>;
	total: { issues: number; open: number; inProgress: number; inReview: number; blocked: number };
} {
	const tdProjects = findTdProjects(config.rootDir, config.maxDepth);
	const projectStats: Array<{ name: string; total: number; open: number; inProgress: number; inReview: number; blocked: number }> = [];
	const total = { issues: 0, open: 0, inProgress: 0, inReview: 0, blocked: 0 };

	for (const proj of tdProjects) {
		let db: Database.Database | null = null;
		try {
			db = new Database(proj.dbPath, { readonly: true, fileMustExist: true });
			const rows = db.prepare(`
				SELECT status, COUNT(*) as count
				FROM issues
				WHERE deleted_at IS NULL
				GROUP BY status
			`).all() as Array<{ status: string; count: number }>;

			const stats = { name: proj.name, total: 0, open: 0, inProgress: 0, inReview: 0, blocked: 0 };
			for (const row of rows) {
				stats.total += row.count;
				total.issues += row.count;
				if (row.status === "open") { stats.open = row.count; total.open += row.count; }
				if (row.status === "in_progress") { stats.inProgress = row.count; total.inProgress += row.count; }
				if (row.status === "in_review") { stats.inReview = row.count; total.inReview += row.count; }
				if (row.status === "blocked") { stats.blocked = row.count; total.blocked += row.count; }
			}
			projectStats.push(stats);
		} catch { /* skip */ } finally {
			db?.close();
		}
	}

	return { projects: projectStats.filter((p) => p.total > 0), total };
}
