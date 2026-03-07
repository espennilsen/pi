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

	// Detect SQL dialect from pi-kysely (falls back to sqlite).
	// Wrapped in a Promise so driver is resolved before schema registration.
	await new Promise<void>((resolve) => {
		events.emit("kysely:info", {
			reply: (info: { defaultDriver?: string }) => {
				if (info.defaultDriver === "postgres" || info.defaultDriver === "mysql") {
					driver = info.defaultDriver;
				}
				resolve();
			},
		});
		// If pi-kysely isn't loaded, no listener fires — resolve immediately.
		// EventEmitter.emit is synchronous, so if no listener called reply
		// by the time emit returns, we can resolve.
		resolve();
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

// ── Query helper ────────────────────────────────────────────────

export interface QueryResult {
	rows: Record<string, unknown>[];
	numAffectedRows?: number;
	insertId?: number | bigint;
}

const QUERY_TIMEOUT_MS = 10_000;

export function query(sql: string, params: unknown[] = []): Promise<QueryResult> {
	const queryPromise = new Promise<QueryResult>((resolve, reject) => {
		events.emit("kysely:query", {
			actor: ACTOR,
			input: { sql, params },
			reply: (result: QueryResult) => resolve(result),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});

	const timeout = new Promise<never>((_, reject) => {
		setTimeout(
			() => reject(new Error(`query() timed out after ${QUERY_TIMEOUT_MS}ms — is pi-kysely loaded? SQL: ${sql.slice(0, 80)}`)),
			QUERY_TIMEOUT_MS,
		);
	});

	return Promise.race([queryPromise, timeout]);
}

// ── Helpers ─────────────────────────────────────────────────────

export function now(): string {
	return new Date().toISOString();
}
