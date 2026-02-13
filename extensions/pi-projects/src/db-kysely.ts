/**
 * pi-projects — Database layer via pi-kysely event bus.
 *
 * Drop-in replacement for db.ts. No direct imports from pi-kysely,
 * no better-sqlite3 dependency. All DB access via events:
 *
 *   - kysely:info   — detect SQL dialect
 *   - kysely:schema:register — table creation (portable DDL)
 *   - kysely:query  — raw SQL for reads/writes
 *   - kysely:migration:apply — tracked migrations
 *
 * Requires pi-kysely extension to be loaded.
 */

import { readdirSync, readFileSync } from "node:fs";
import type { EventBus } from "@mariozechner/pi-coding-agent";
import type { ProjectSourceRecord, ProjectHiddenRecord } from "./db.ts";

const ACTOR = "pi-projects";

type Driver = "sqlite" | "postgres" | "mysql";

let events: EventBus;
let driver: Driver = "sqlite";

// ── Schema (portable DDL via Kysely schema builder) ─────────────

const SCHEMA = {
	actor: ACTOR,
	tables: {
		project_sources: {
			columns: {
				id:         { type: "integer" as const, primaryKey: true, autoIncrement: true },
				path:       { type: "text" as const, notNull: true, unique: true },
				label:      { type: "text" as const },
				created_at: { type: "text" as const, notNull: true },
			},
		},
		project_hidden: {
			columns: {
				id:           { type: "integer" as const, primaryKey: true, autoIncrement: true },
				project_path: { type: "text" as const, notNull: true, unique: true },
				created_at:   { type: "text" as const, notNull: true },
			},
		},
	},
};

// ── Migrations ──────────────────────────────────────────────────

const migrationDir = new URL("../migrations", import.meta.url).pathname;

function loadMigrations(): Array<{ name: string; sql: string }> {
	try {
		return readdirSync(migrationDir)
			.filter((f) => f.endsWith(".sql"))
			.sort()
			.map((f) => ({
				name: f.replace(/\.sql$/, ""),
				sql: readFileSync(`${migrationDir}/${f}`, "utf-8"),
			}));
	} catch {
		return [];
	}
}

// ── Init ────────────────────────────────────────────────────────

export async function initDb(eventBus: EventBus): Promise<void> {
	events = eventBus;

	// Detect SQL dialect from pi-kysely
	events.emit("kysely:info", {
		reply: (info: { defaultDriver?: string }) => {
			if (info.defaultDriver === "postgres" || info.defaultDriver === "mysql") {
				driver = info.defaultDriver;
			}
		},
	});

	// Apply tracked migrations
	const migrations = loadMigrations();
	if (migrations.length > 0) {
		await new Promise<void>((resolve, reject) => {
			events.emit("kysely:migration:apply", {
				actor: ACTOR,
				migrations,
				reply: (result: { ok: boolean; applied: string[]; skipped: string[]; errors: string[] }) => {
					if (result.ok) resolve();
					else reject(new Error(`Migration failed: ${result.errors.join("; ")}`));
				},
			});
		});
	}

	// Schema:register as safety net
	await new Promise<void>((resolve, reject) => {
		events.emit("kysely:schema:register", {
			...SCHEMA,
			reply: (result: { ok: boolean; errors: string[] }) => {
				if (result.ok) resolve();
				else reject(new Error(`Schema register failed: ${result.errors.join("; ")}`));
			},
		});
	});
}

// ── Query helper ────────────────────────────────────────────────

interface QueryResult {
	rows: Record<string, unknown>[];
	numAffectedRows?: number;
	insertId?: number | bigint;
}

function query(sql: string, params: unknown[] = []): Promise<QueryResult> {
	return new Promise((resolve, reject) => {
		events.emit("kysely:query", {
			actor: ACTOR,
			input: { sql, params },
			reply: (result: QueryResult) => resolve(result),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});
}

// ── Helpers ─────────────────────────────────────────────────────

function now(): string {
	return new Date().toISOString();
}

// ── CRUD ────────────────────────────────────────────────────────

export async function getProjectSources(): Promise<ProjectSourceRecord[]> {
	const { rows } = await query("SELECT * FROM project_sources ORDER BY path");
	return rows as unknown as ProjectSourceRecord[];
}

export async function addProjectSource(sourcePath: string, label?: string): Promise<ProjectSourceRecord> {
	const ts = now();
	const insertSql =
		driver === "postgres"
			? "INSERT INTO project_sources (path, label, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING"
			: driver === "mysql"
				? "INSERT IGNORE INTO project_sources (path, label, created_at) VALUES (?, ?, ?)"
				: "INSERT OR IGNORE INTO project_sources (path, label, created_at) VALUES (?, ?, ?)";
	await query(insertSql, [sourcePath, label ?? null, ts]);
	const { rows } = await query("SELECT * FROM project_sources WHERE path = ?", [sourcePath]);
	return rows[0] as unknown as ProjectSourceRecord;
}

export async function removeProjectSource(id: number): Promise<boolean> {
	const { numAffectedRows } = await query("DELETE FROM project_sources WHERE id = ?", [id]);
	return (numAffectedRows ?? 0) > 0;
}

export async function getHiddenProjects(): Promise<ProjectHiddenRecord[]> {
	const { rows } = await query("SELECT * FROM project_hidden ORDER BY project_path");
	return rows as unknown as ProjectHiddenRecord[];
}

export async function hideProject(projectPath: string): Promise<ProjectHiddenRecord> {
	const ts = now();
	const insertSql =
		driver === "postgres"
			? "INSERT INTO project_hidden (project_path, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING"
			: driver === "mysql"
				? "INSERT IGNORE INTO project_hidden (project_path, created_at) VALUES (?, ?)"
				: "INSERT OR IGNORE INTO project_hidden (project_path, created_at) VALUES (?, ?)";
	await query(insertSql, [projectPath, ts]);
	const { rows } = await query("SELECT * FROM project_hidden WHERE project_path = ?", [projectPath]);
	return rows[0] as unknown as ProjectHiddenRecord;
}

export async function unhideProject(projectPath: string): Promise<boolean> {
	const { numAffectedRows } = await query("DELETE FROM project_hidden WHERE project_path = ?", [projectPath]);
	return (numAffectedRows ?? 0) > 0;
}
