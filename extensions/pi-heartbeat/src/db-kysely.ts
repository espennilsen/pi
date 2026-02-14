/**
 * pi-heartbeat — Database layer via pi-kysely event bus.
 *
 * Stores heartbeat run history in the shared database.
 * All DB access via events:
 *
 *   - kysely:info   — detect SQL dialect (sqlite/postgres/mysql)
 *   - kysely:schema:register — table creation (portable DDL)
 *   - kysely:query  — raw SQL for reads/writes
 *
 * Requires pi-kysely extension to be loaded.
 */

import type { EventBus } from "@mariozechner/pi-coding-agent";

const ACTOR = "pi-heartbeat";

type Driver = "sqlite" | "postgres" | "mysql";

let events: EventBus;
let driver: Driver = "sqlite";

// ── Schema ──────────────────────────────────────────────────────

const SCHEMA = {
	actor: ACTOR,
	tables: {
		heartbeat_runs: {
			columns: {
				id:          { type: "integer" as const, primaryKey: true, autoIncrement: true },
				ok:          { type: "integer" as const, notNull: true, default: 0 },
				response:    { type: "text" as const },
				duration_ms: { type: "integer" as const },
				created_at:  { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["created_at"], name: "idx_heartbeat_runs_created" },
				{ columns: ["ok"], name: "idx_heartbeat_runs_ok" },
			],
		},
	},
};

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

	// Register schema (additive, idempotent)
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

// ── Types ───────────────────────────────────────────────────────

export interface HeartbeatRunRow {
	id: number;
	ok: boolean;
	response: string | null;
	duration_ms: number | null;
	created_at: string;
}

// ── Helpers ─────────────────────────────────────────────────────

function now(): string {
	return new Date().toISOString();
}

function mapRow(r: any): HeartbeatRunRow {
	return {
		id: r.id,
		ok: !!r.ok,
		response: r.response,
		duration_ms: r.duration_ms,
		created_at: r.created_at,
	};
}

// ── CRUD ────────────────────────────────────────────────────────

export async function insertRun(ok: boolean, response: string, durationMs: number): Promise<HeartbeatRunRow> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO heartbeat_runs (ok, response, duration_ms, created_at)
		 VALUES (?, ?, ?, ?)`,
		[ok ? 1 : 0, response, durationMs, ts],
	);
	return { id: Number(insertId), ok, response, duration_ms: durationMs, created_at: ts };
}

export async function getHistory(limit: number = 100): Promise<HeartbeatRunRow[]> {
	const { rows } = await query(
		"SELECT * FROM heartbeat_runs ORDER BY created_at DESC LIMIT ?",
		[limit],
	);
	return rows.map(mapRow);
}

export async function getStats(): Promise<{
	runCount: number;
	okCount: number;
	alertCount: number;
	lastRun: string | null;
	lastOk: boolean | null;
}> {
	const { rows } = await query(
		`SELECT
		   COUNT(*) as run_count,
		   SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) as ok_count,
		   SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) as alert_count,
		   MAX(created_at) as last_run
		 FROM heartbeat_runs`,
	);
	const row = rows[0] as any;

	let lastOk: boolean | null = null;
	if (row.last_run) {
		const { rows: lastRows } = await query(
			"SELECT ok FROM heartbeat_runs ORDER BY created_at DESC LIMIT 1",
		);
		if (lastRows.length > 0) lastOk = !!(lastRows[0] as any).ok;
	}

	return {
		runCount: row.run_count ?? 0,
		okCount: row.ok_count ?? 0,
		alertCount: row.alert_count ?? 0,
		lastRun: row.last_run ?? null,
		lastOk,
	};
}

export async function cleanOldRuns(beforeDate: string): Promise<number> {
	const { numAffectedRows } = await query(
		"DELETE FROM heartbeat_runs WHERE created_at < ?",
		[beforeDate],
	);
	return numAffectedRows ?? 0;
}
