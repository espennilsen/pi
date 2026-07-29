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

import type { EventBus } from "@earendil-works/pi-coding-agent";
import { SCHEMA } from "./schema.ts";

const ACTOR = "pi-untappd";

type LogFn = (event: string, data: unknown, level?: string) => void;

type Driver = "sqlite" | "postgres" | "mysql";

let events: EventBus | undefined;
let driver: Driver = "sqlite";

// ── Init ────────────────────────────────────────────────────────

export async function initDb(eventBus: EventBus, log?: LogFn): Promise<void> {
	events = eventBus;

	// Detect SQL dialect from pi-kysely (falls back to sqlite).
	// Wrapped in a Promise so driver is resolved before schema registration.
	await new Promise<void>((resolve) => {
		let replied = false;
		events!.emit("kysely:info", {
			reply: (info: { defaultDriver?: string }) => {
				replied = true;
				if (info.defaultDriver === "postgres" || info.defaultDriver === "mysql") {
					driver = info.defaultDriver;
				}
				resolve();
			},
		});
		// If pi-kysely isn't loaded, no listener fires — resolve immediately.
		// EventEmitter.emit is synchronous, so if a listener called reply
		// during emit, `replied` is already true and we skip the fallback.
		if (!replied) resolve();
	});

	// Schema:register — creates tables and indexes if they don't exist.
	// If pi-kysely isn't loaded, we warn — all query() calls will time out.
	// Additive-only, idempotent, portable across dialects.
	await new Promise<void>((resolve, reject) => {
		let replied = false;
		events!.emit("kysely:schema:register", {
			...SCHEMA,
			reply: (result: { ok: boolean; errors: string[] }) => {
				replied = true;
				if (result.ok) resolve();
				else reject(new Error(`Schema register failed: ${result.errors.join("; ")}`));
			},
		});
		// If pi-kysely isn't loaded, no listener fires — resolve immediately.
		// EventEmitter.emit is synchronous, so if a listener called reply
		// during emit, `replied` is already true and we skip the fallback.
		if (!replied) {
			log?.("init_warning", { message: "pi-kysely not loaded — schema not registered. All query() calls will time out." }, "warn");
			resolve();
		}
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
	if (!events) {
		throw new Error("pi-untappd: query() called before initDb()");
	}
	const bus = events;
	return new Promise<QueryResult>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`query() timed out after ${QUERY_TIMEOUT_MS}ms — is pi-kysely loaded? SQL: ${sql.slice(0, 80)}`)),
			QUERY_TIMEOUT_MS,
		);

		bus.emit("kysely:query", {
			actor: ACTOR,
			input: { sql, params },
			reply: (result: QueryResult) => {
				clearTimeout(timer);
				resolve(result);
			},
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) {
					clearTimeout(timer);
					reject(new Error(ack.error));
				}
			},
		});
	});
}

// ── Helpers ─────────────────────────────────────────────────────

export function now(): string {
	return new Date().toISOString();
}
