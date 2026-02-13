/**
 * pi-kysely — Event bus wiring.
 *
 * Core events:
 *   kysely:schema:register    — DDL via Kysely schema builder (portable)
 *   kysely:query              — Raw SQL + params (simple, expressive)
 *   kysely:migration:generate — Diff schema vs DB, produce SQL, return to caller
 *   kysely:migration:apply    — Apply stored migration files from extensions
 *   kysely:migration:status   — Query applied migrations
 *
 * Plus RBAC grant/revoke events.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	executeQuery,
	grantTableAccess,
	listTableGrants,
	revokeTableAccess,
	type QueryInput,
	type QueryResult,
	type TableGrant,
} from "./table-api.ts";
import {
	applySchema,
	seedIndexCache,
	type SchemaRegistration,
	type SchemaRegistrationResult,
} from "./schema.ts";
import {
	generateMigration,
	applyMigrations,
	getMigrationStatus,
	type MigrationGeneratePayload,
	type MigrationApplyPayload,
	type MigrationStatusPayload,
} from "./migrations.ts";
import { getDatabase, registerSqlFunction, requireDatabase } from "./registry.ts";

export interface KyselyAck {
	ok: boolean;
	operation: string;
	timestamp: number;
	requestId?: string;
	actor?: string;
	table?: string;
	result?: unknown;
	error?: string;
}

type LogFn = (event: string, data: unknown, level?: string) => void;

function pushAck(
	pi: ExtensionAPI,
	ack: KyselyAck,
	log: LogFn,
	callback?: (ack: KyselyAck) => void,
): void {
	callback?.(ack);
	if (!ack.ok) {
		log("op-error", { operation: ack.operation, error: ack.error }, "ERROR");
	}
	if (ack.requestId) {
		pi.events.emit("kysely:ack", ack);
	}
}

export function wireKyselyEvents(pi: ExtensionAPI, log: LogFn = () => {}): void {
	// ── Schema registration (DDL) ─────────────────────────────

	pi.events.on("kysely:schema:register", async (payload: unknown) => {
		const data = payload as SchemaRegistration & {
			requestId?: string;
			reply?: (result: SchemaRegistrationResult) => void;
			ack?: (ack: KyselyAck) => void;
		};

		try {
			const dbName = data.database;
			const db = dbName ? getDatabase(dbName) : requireDatabase();
			if (!db) throw new Error(`Database "${dbName}" is not registered`);

			await seedIndexCache(db);
			const result = await applySchema(db, data, dbName ?? "default");
			data.reply?.(result);

			const summary = [];
			if (result.tablesCreated.length) summary.push(`tables: ${result.tablesCreated.join(", ")}`);
			if (result.columnsAdded.length) summary.push(`columns: ${result.columnsAdded.join(", ")}`);
			if (result.indexesCreated.length) summary.push(`indexes: ${result.indexesCreated.join(", ")}`);

			if (summary.length) {
				log("schema-applied", { actor: data.actor, changes: summary.join("; ") });
			}

			pushAck(pi, {
				ok: result.ok,
				operation: "schema:register",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				result,
				error: result.errors.length ? result.errors.join("; ") : undefined,
			}, log, data.ack);

			pi.events.emit(`kysely:schema:ready:${data.actor}`, result);
		} catch (err: any) {
			data.reply?.({
				ok: false, tablesCreated: [], columnsAdded: [], indexesCreated: [],
				errors: [err.message],
			});
			pushAck(pi, {
				ok: false, operation: "schema:register", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	// ── Raw SQL query ─────────────────────────────────────────

	pi.events.on("kysely:query", async (payload: unknown) => {
		const data = payload as {
			actor: string;
			input: QueryInput;
			reply?: (result: QueryResult) => void;
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
		};

		try {
			const result = await executeQuery(data.actor, data.input);
			data.reply?.(result);
			pushAck(pi, {
				ok: true, operation: "query", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor,
				result,
			}, log, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false, operation: "query", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	// ── RBAC grants ───────────────────────────────────────────

	pi.events.on("kysely:grant", (payload: unknown) => {
		const data = payload as TableGrant & {
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
		};
		try {
			grantTableAccess(data);
			pushAck(pi, {
				ok: true, operation: "grant", timestamp: Date.now(),
				requestId: data.requestId, actor: data.owner, table: data.table,
			}, log, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false, operation: "grant", timestamp: Date.now(),
				requestId: data.requestId, actor: data.owner, table: data.table,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	pi.events.on("kysely:revoke", (payload: unknown) => {
		const data = payload as {
			owner: string; grantee: string; table: string;
			requestId?: string; ack?: (ack: KyselyAck) => void;
		};
		try {
			const removed = revokeTableAccess(data);
			pushAck(pi, {
				ok: true, operation: "revoke", timestamp: Date.now(),
				requestId: data.requestId, actor: data.owner, table: data.table,
				result: { removed },
			}, log, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false, operation: "revoke", timestamp: Date.now(),
				requestId: data.requestId, actor: data.owner, table: data.table,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	pi.events.on("kysely:grants", (payload: unknown) => {
		const data = payload as {
			grantee?: string;
			reply?: (grants: ReturnType<typeof listTableGrants>) => void;
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
		};
		try {
			const result = listTableGrants(data.grantee);
			data.reply?.(result);
			pushAck(pi, {
				ok: true, operation: "grants", timestamp: Date.now(),
				requestId: data.requestId, result,
			}, log, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false, operation: "grants", timestamp: Date.now(),
				requestId: data.requestId, error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	// ── Migrations ────────────────────────────────────────────

	pi.events.on("kysely:migration:generate", async (payload: unknown) => {
		const data = payload as MigrationGeneratePayload;

		try {
			const dbName = data.database;
			const db = dbName ? getDatabase(dbName) : requireDatabase();
			if (!db) throw new Error(`Database "${dbName}" is not registered`);

			const result = await generateMigration(db, data.actor, data.tables, {
				dropTables: data.dropTables,
				dropColumns: data.dropColumns,
				migrationName: data.migrationName,
			});

			data.reply?.(result);

			if (result.statements.length) {
				log("migration-generated", {
					actor: data.actor,
					name: result.name,
					statements: result.statements.length,
				});
			}

			pushAck(pi, {
				ok: true,
				operation: "migration:generate",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				result,
			}, log, data.ack);
		} catch (err: any) {
			data.reply?.({
				name: "", actor: data.actor, sql: "", statements: [],
				timestamp: Date.now(), checksum: "",
			});
			pushAck(pi, {
				ok: false,
				operation: "migration:generate",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	pi.events.on("kysely:migration:apply", async (payload: unknown) => {
		const data = payload as MigrationApplyPayload;

		try {
			const dbName = data.database;
			const db = dbName ? getDatabase(dbName) : requireDatabase();
			if (!db) throw new Error(`Database "${dbName}" is not registered`);

			const result = await applyMigrations(db, data.actor, data.migrations);
			data.reply?.(result);

			if (result.applied.length) {
				log("migrations-applied", {
					actor: data.actor,
					applied: result.applied,
				});
			}

			pushAck(pi, {
				ok: result.ok,
				operation: "migration:apply",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				result,
				error: result.errors.length ? result.errors.join("; ") : undefined,
			}, log, data.ack);
		} catch (err: any) {
			data.reply?.({ ok: false, applied: [], skipped: [], errors: [err.message] });
			pushAck(pi, {
				ok: false,
				operation: "migration:apply",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	pi.events.on("kysely:migration:status", async (payload: unknown) => {
		const data = payload as MigrationStatusPayload;

		try {
			const dbName = data.database;
			const db = dbName ? getDatabase(dbName) : requireDatabase();
			if (!db) throw new Error(`Database "${dbName}" is not registered`);

			const records = await getMigrationStatus(db, data.actor);
			data.reply?.(records);

			pushAck(pi, {
				ok: true,
				operation: "migration:status",
				timestamp: Date.now(),
				requestId: data.requestId,
				result: records,
			}, log, data.ack);
		} catch (err: any) {
			data.reply?.([]);
			pushAck(pi, {
				ok: false,
				operation: "migration:status",
				timestamp: Date.now(),
				requestId: data.requestId,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	// ── Custom SQL functions (UDFs) ───────────────────────────

	pi.events.on("kysely:function:register", async (payload: unknown) => {
		const data = payload as {
			actor: string;
			database?: string;
			functions: Array<{
				name: string;
				implementation: (...args: any[]) => any;
				deterministic?: boolean;
				varargs?: boolean;
			}>;
			reply?: (result: { ok: boolean; registered: string[]; errors: string[] }) => void;
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
		};

		const result = { ok: true, registered: [] as string[], errors: [] as string[] };

		try {
			for (const fn of data.functions) {
				const ok = await registerSqlFunction(data.database, fn.name, fn.implementation, {
					deterministic: fn.deterministic,
					varargs: fn.varargs,
				});
				if (ok) {
					result.registered.push(fn.name);
				} else {
					result.errors.push(`${fn.name}: not supported on this driver or database not found`);
				}
			}

			if (result.errors.length > 0) result.ok = false;
			data.reply?.(result);

			if (result.registered.length) {
				log("functions-registered", { actor: data.actor, functions: result.registered });
			}

			pushAck(pi, {
				ok: result.ok,
				operation: "function:register",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				result,
				error: result.errors.length ? result.errors.join("; ") : undefined,
			}, log, data.ack);
		} catch (err: any) {
			data.reply?.({ ok: false, registered: [], errors: [err.message] });
			pushAck(pi, {
				ok: false,
				operation: "function:register",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});
}
