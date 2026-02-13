/**
 * Projects store — unified async interface over multiple backends.
 *
 * Two backends:
 *   1. "sqlite" (default) — local better-sqlite3 via db.ts
 *   2. "kysely" — shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Consumers import `getProjectsStore()` and get back the same async API
 * regardless of which backend is active.
 *
 * Backend selection is driven by `pi-projects.useKysely` in settings.json.
 */

import type {
	ProjectSourceRecord,
	ProjectHiddenRecord,
} from "./db.ts";

// ── Store interface ─────────────────────────────────────────────

export interface ProjectsStore {
	getProjectSources(): Promise<ProjectSourceRecord[]>;
	addProjectSource(sourcePath: string, label?: string): Promise<ProjectSourceRecord>;
	removeProjectSource(id: number): Promise<boolean>;
	getHiddenProjects(): Promise<ProjectHiddenRecord[]>;
	hideProject(projectPath: string): Promise<ProjectHiddenRecord>;
	unhideProject(projectPath: string): Promise<boolean>;
}

// ── Singleton ───────────────────────────────────────────────────

let activeStore: ProjectsStore | null = null;

export function setProjectsStore(store: ProjectsStore): void {
	activeStore = store;
}

export function getProjectsStore(): ProjectsStore {
	if (!activeStore) throw new Error("pi-projects: store not initialized");
	return activeStore;
}

export function isStoreReady(): boolean {
	return activeStore !== null;
}

// ── SQLite backend (better-sqlite3, synchronous) ────────────────

export async function createSqliteStore(dbPath: string): Promise<ProjectsStore> {
	const db = await import("./db.ts");
	db.initProjectsDb(dbPath);

	const api = db.getProjectsDbApi();
	return {
		getProjectSources: () => Promise.resolve(api.getProjectSources()),
		addProjectSource: (p, l) => Promise.resolve(api.addProjectSource(p, l)),
		removeProjectSource: (id) => Promise.resolve(api.removeProjectSource(id)),
		getHiddenProjects: () => Promise.resolve(api.getHiddenProjects()),
		hideProject: (p) => Promise.resolve(api.hideProject(p)),
		unhideProject: (p) => Promise.resolve(api.unhideProject(p)),
	};
}

// ── Kysely backend (pi-kysely event bus, async) ─────────────────

interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export async function createKyselyStore(eventBus: EventBus): Promise<ProjectsStore> {
	const db = await import("./db-kysely.ts");
	await db.initDb(eventBus);
	return db;
}
