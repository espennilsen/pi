/**
 * pi-supabase — Store abstraction for local query cache/state.
 *
 * Two backends:
 *   1. "memory" (default) — in-memory, no persistence
 *   2. "kysely" — shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Currently stores query history for auditing.
 * Future: cached table snapshots, subscription state.
 */

// ── Store interface ─────────────────────────────────────────────

export interface QueryLogEntry {
	table: string;
	action: string;
	filter_summary: string;
	row_count: number;
	duration_ms: number;
	time: string;
}

export interface SupabaseStore {
	logQuery(entry: Omit<QueryLogEntry, "time">): Promise<void>;
	getQueryLog(limit?: number): Promise<QueryLogEntry[]>;
}

// ── Singleton ───────────────────────────────────────────────────

let activeStore: SupabaseStore | null = null;

export function setStore(store: SupabaseStore | null): void {
	activeStore = store;
}

export function isStoreReady(): boolean {
	return activeStore !== null;
}

export function getStore(): SupabaseStore {
	if (!activeStore) throw new Error("Supabase store not initialized");
	return activeStore;
}

// ── Memory backend ──────────────────────────────────────────────

const MAX_LOG = 200;

export function createMemoryStore(): SupabaseStore {
	const log: QueryLogEntry[] = [];

	return {
		logQuery: async (entry) => {
			log.unshift({ ...entry, time: new Date().toISOString() });
			if (log.length > MAX_LOG) log.pop();
		},
		getQueryLog: async (limit = 50) => log.slice(0, limit),
	};
}

// ── Kysely backend ──────────────────────────────────────────────

interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export async function createKyselyStore(eventBus: EventBus): Promise<SupabaseStore> {
	const db = await import("./db-kysely.ts");
	await db.initDb(eventBus);

	return {
		logQuery: async (entry) => {
			await db.insertQueryLog(entry.table, entry.action, entry.filter_summary, entry.row_count, entry.duration_ms);
		},
		getQueryLog: async (limit = 50) => {
			return db.getQueryLog(limit);
		},
	};
}

/** Reset all store state (call on session shutdown). */
export async function resetStore(): Promise<void> {
	activeStore = null;
	try {
		const db = await import("./db-kysely.ts");
		db.resetDb();
	} catch { /* db-kysely may not have been loaded */ }
}
