/**
 * pi-untappd — Database layer via pi-kysely event bus.
 *
 * No direct imports from pi-kysely or better-sqlite3.
 * All DB access via events:
 *
 *   - kysely:info            — detect SQL dialect
 *   - kysely:schema:register — table creation (portable DDL)
 *   - kysely:query           — raw SQL for reads/writes
 *
 * Requires pi-kysely extension to be loaded.
 */

import type { EventBus } from "@mariozechner/pi-coding-agent";
import { SCHEMA } from "./schema.ts";

const ACTOR = "pi-untappd";

type Driver = "sqlite" | "postgres" | "mysql";

let events: EventBus;
let driver: Driver = "sqlite";

// ── Init ────────────────────────────────────────────────────────

export async function initDb(eventBus: EventBus): Promise<void> {
	events = eventBus;

	// Detect SQL dialect from pi-kysely (falls back to sqlite)
	events.emit("kysely:info", {
		reply: (info: { defaultDriver?: string }) => {
			if (info.defaultDriver === "postgres" || info.defaultDriver === "mysql") {
				driver = info.defaultDriver;
			}
		},
	});

	// Schema:register — creates tables and indexes if they don't exist.
	// Additive-only, idempotent, portable across dialects.
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

/**
 * Returns the detected SQL dialect.
 * NOTE: Only SQLite is supported in v1. Multi-dialect scaffold kept
 * for future use but no query in operations.ts adapts its SQL syntax.
 */
export function getDriver(): Driver {
	return driver;
}

// ── Query helper ────────────────────────────────────────────────

export interface QueryResult {
	rows: Record<string, unknown>[];
	numAffectedRows?: number;
	insertId?: number | bigint;
}

export function query(sql: string, params: unknown[] = []): Promise<QueryResult> {
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

export function now(): string {
	return new Date().toISOString();
}
