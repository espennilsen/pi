/**
 * pi-projects — SQLite database for project sources and hidden projects.
 *
 * Lightweight: stores scan directories and hidden paths.
 * The actual project data (git status etc.) is scanned live from disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

// ── Types ───────────────────────────────────────────────────────

export interface ProjectSourceRecord {
	id: number;
	path: string;
	label: string | null;
	created_at: string;
}

export interface ProjectHiddenRecord {
	id: number;
	project_path: string;
	created_at: string;
}

export interface ProjectsDbApi {
	getProjectSources(): ProjectSourceRecord[];
	addProjectSource(sourcePath: string, label?: string): ProjectSourceRecord;
	removeProjectSource(id: number): boolean;
	getHiddenProjects(): ProjectHiddenRecord[];
	hideProject(projectPath: string): ProjectHiddenRecord;
	unhideProject(projectPath: string): boolean;
}

// ── Singleton state ─────────────────────────────────────────────

let db: Database.Database | null = null;
let api: ProjectsDbApi | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_sources (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	path        TEXT NOT NULL UNIQUE,
	label       TEXT,
	created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS project_hidden (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	project_path TEXT NOT NULL UNIQUE,
	created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

export function initProjectsDb(dbPath: string): void {
	if (db) return;
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.exec(SCHEMA_SQL);
	buildApi(db);
}

export function closeProjectsDb(): void {
	if (db) {
		db.close();
		db = null;
		api = null;
	}
}

export function getProjectsDbApi(): ProjectsDbApi {
	if (!api) throw new Error("pi-projects: DB not initialized.");
	return api;
}

// ── Build API ───────────────────────────────────────────────────

function buildApi(db: Database.Database): void {
	const stmts = {
		getSources: db.prepare("SELECT * FROM project_sources ORDER BY path"),
		addSource: db.prepare("INSERT OR IGNORE INTO project_sources (path, label) VALUES (?, ?)"),
		removeSource: db.prepare("DELETE FROM project_sources WHERE id = ?"),
		getHidden: db.prepare("SELECT * FROM project_hidden ORDER BY project_path"),
		hide: db.prepare("INSERT OR IGNORE INTO project_hidden (project_path) VALUES (?)"),
		unhide: db.prepare("DELETE FROM project_hidden WHERE project_path = ?"),
	};

	api = {
		getProjectSources() {
			return stmts.getSources.all() as ProjectSourceRecord[];
		},

		addProjectSource(sourcePath: string, label?: string) {
			stmts.addSource.run(sourcePath, label ?? null);
			return (stmts.getSources.all() as ProjectSourceRecord[]).find(s => s.path === sourcePath)!;
		},

		removeProjectSource(id: number) {
			return stmts.removeSource.run(id).changes > 0;
		},

		getHiddenProjects() {
			return stmts.getHidden.all() as ProjectHiddenRecord[];
		},

		hideProject(projectPath: string) {
			stmts.hide.run(projectPath);
			return (stmts.getHidden.all() as ProjectHiddenRecord[]).find(h => h.project_path === projectPath)!;
		},

		unhideProject(projectPath: string) {
			return stmts.unhide.run(projectPath).changes > 0;
		},
	};
}
