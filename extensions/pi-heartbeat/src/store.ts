/**
 * pi-heartbeat — Store abstraction.
 *
 * Two backends:
 *   1. "memory" (default) — in-memory ring buffer (no persistence)
 *   2. "kysely" — shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Consumers import `getStore()` and get back the same async API.
 */

// ── Store interface ─────────────────────────────────────────────

export interface HeartbeatEntry {
	id?: number;
	ok: boolean;
	response: string;
	durationMs: number;
	time: string;
}

export interface HeartbeatStats {
	runCount: number;
	okCount: number;
	alertCount: number;
	lastRun: string | null;
	lastOk: boolean | null;
}

export interface HeartbeatStore {
	insertRun(ok: boolean, response: string, durationMs: number): Promise<HeartbeatEntry>;
	getHistory(limit?: number): Promise<HeartbeatEntry[]>;
	getStats(): Promise<HeartbeatStats>;
}

// ── Singleton ───────────────────────────────────────────────────

let activeStore: HeartbeatStore | null = null;

export function setStore(store: HeartbeatStore | null): void {
	activeStore = store;
}

export function isStoreReady(): boolean {
	return activeStore !== null;
}

/** Reset all store state (call on session shutdown). */
export async function resetStore(): Promise<void> {
	activeStore = null;
	try {
		const db = await import("./db-kysely.ts");
		db.resetDb();
	} catch { /* db-kysely may not have been loaded */ }
}

export function getStore(): HeartbeatStore {
	if (!activeStore) throw new Error("Heartbeat store not initialized");
	return activeStore;
}

// ── Memory backend (in-memory ring buffer, no persistence) ──────

const MAX_HISTORY = 100;

export function createMemoryStore(): HeartbeatStore {
	const history: HeartbeatEntry[] = [];
	let runCount = 0;
	let okCount = 0;
	let alertCount = 0;

	return {
		insertRun: async (ok, response, durationMs) => {
			const entry: HeartbeatEntry = {
				ok,
				response,
				durationMs,
				time: new Date().toISOString(),
			};
			history.unshift(entry);
			if (history.length > MAX_HISTORY) history.pop();
			runCount++;
			if (ok) okCount++;
			else alertCount++;
			return entry;
		},
		getHistory: async (limit = MAX_HISTORY) => history.slice(0, limit),
		getStats: async () => ({
			runCount,
			okCount,
			alertCount,
			lastRun: history.length > 0 ? history[0].time : null,
			lastOk: history.length > 0 ? history[0].ok : null,
		}),
	};
}

// ── Kysely backend (pi-kysely event bus, async) ─────────────────

interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export async function createKyselyStore(eventBus: EventBus): Promise<HeartbeatStore> {
	const db = await import("./db-kysely.ts");
	await db.initDb(eventBus);

	return {
		insertRun: async (ok, response, durationMs) => {
			const row = await db.insertRun(ok, response, durationMs);
			return {
				id: row.id,
				ok: row.ok,
				response: row.response ?? "",
				durationMs: row.duration_ms ?? 0,
				time: row.created_at,
			};
		},
		getHistory: async (limit = 100) => {
			const rows = await db.getHistory(limit);
			return rows.map((r) => ({
				id: r.id,
				ok: r.ok,
				response: r.response ?? "",
				durationMs: r.duration_ms ?? 0,
				time: r.created_at,
			}));
		},
		getStats: async () => {
			return db.getStats();
		},
	};
}
