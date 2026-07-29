/**
 * pi-supabase — Database layer via pi-kysely event bus.
 *
 * Stores query log for auditing.
 * All DB access via events (same pattern as other pi extensions).
 */

const ACTOR = "pi-supabase";
const EVENT_TIMEOUT_MS = 15_000;

let events: EventBus | null = null;

interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		promise.then(
			(val) => { clearTimeout(timer); resolve(val); },
			(err) => { clearTimeout(timer); reject(err); },
		);
	});
}

// ── Schema ──────────────────────────────────────────────────────

const SCHEMA = {
	actor: ACTOR,
	tables: {
		supabase_query_log: {
			columns: {
				id:             { type: "integer" as const, primaryKey: true, autoIncrement: true },
				table_name:     { type: "text" as const, notNull: true },
				action:         { type: "text" as const, notNull: true },
				filter_summary: { type: "text" as const },
				row_count:      { type: "integer" as const, default: 0 },
				duration_ms:    { type: "integer" as const },
				created_at:     { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["created_at"], name: "idx_supabase_query_log_created" },
				{ columns: ["table_name"], name: "idx_supabase_query_log_table" },
			],
		},
	},
};

// ── Init ────────────────────────────────────────────────────────

export async function initDb(eventBus: EventBus): Promise<void> {
	events = eventBus;
	const bus = events;

	await withTimeout(
		new Promise<void>((resolve, reject) => {
			bus.emit("kysely:schema:register", {
				...SCHEMA,
				reply: (result: { ok: boolean; errors: string[] }) => {
					if (result.ok) resolve();
					else reject(new Error(`Schema register failed: ${result.errors.join("; ")}`));
				},
			});
		}),
		EVENT_TIMEOUT_MS,
		"kysely:schema:register",
	);
}

export function resetDb(): void {
	events = null;
}

// ── Query helper ────────────────────────────────────────────────

interface QueryResult {
	rows: Record<string, unknown>[];
	numAffectedRows?: number;
	insertId?: number | bigint;
}

function query(sql: string, params: unknown[] = []): Promise<QueryResult> {
	if (!events) throw new Error("Supabase DB not initialized — call initDb() first");
	const bus = events;
	return withTimeout(
		new Promise((resolve, reject) => {
			let settled = false;
			bus.emit("kysely:query", {
				actor: ACTOR,
				input: { sql, params },
				reply: (result: QueryResult) => {
					if (!settled) { settled = true; resolve(result); }
				},
				ack: (ack: { ok: boolean; error?: string }) => {
					if (!ack.ok && !settled) { settled = true; reject(new Error(ack.error)); }
				},
			});
		}),
		EVENT_TIMEOUT_MS,
		"kysely:query",
	);
}

// ── CRUD ────────────────────────────────────────────────────────

export async function insertQueryLog(
	tableName: string,
	action: string,
	filterSummary: string,
	rowCount: number,
	durationMs: number,
): Promise<void> {
	await query(
		`INSERT INTO supabase_query_log (table_name, action, filter_summary, row_count, duration_ms, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[tableName, action, filterSummary, rowCount, durationMs, new Date().toISOString()],
	);
}

export async function getQueryLog(limit: number = 50): Promise<{
	table: string;
	action: string;
	filter_summary: string;
	row_count: number;
	duration_ms: number;
	time: string;
}[]> {
	const { rows } = await query(
		"SELECT * FROM supabase_query_log ORDER BY created_at DESC LIMIT ?",
		[limit],
	);
	return rows.map((r: any) => ({
		table: r.table_name,
		action: r.action,
		filter_summary: r.filter_summary ?? "",
		row_count: r.row_count ?? 0,
		duration_ms: r.duration_ms ?? 0,
		time: r.created_at,
	}));
}
