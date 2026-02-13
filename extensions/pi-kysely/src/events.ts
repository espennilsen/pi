/**
 * pi-kysely — Event bus wiring.
 *
 * Listens for kysely:* events and delegates to the table API and schema engine.
 * All operations return results via `reply` callbacks and/or `kysely:ack` events.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	countRows,
	deleteRows,
	grantTableAccess,
	insertRows,
	listTableGrants,
	revokeTableAccess,
	selectRows,
	updateRows,
	type TableCountInput,
	type TableDeleteInput,
	type TableGrant,
	type TableInsertInput,
	type TableSelectInput,
	type TableUpdateInput,
} from "./table-api.ts";
import {
	applySchema,
	seedIndexCache,
	type SchemaRegistration,
	type SchemaRegistrationResult,
} from "./schema.ts";
import { getDatabase, requireDatabase } from "./registry.ts";

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
		log("op-error", { operation: ack.operation, table: ack.table, error: ack.error }, "ERROR");
	}
	if (ack.requestId) {
		pi.events.emit("kysely:ack", ack);
	}
}

export function wireKyselyEvents(pi: ExtensionAPI, log: LogFn = () => {}): void {
	// ── Schema registration ───────────────────────────────────

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

			// Seed index cache on first schema registration
			await seedIndexCache(db);

			const result = await applySchema(db, data, dbName ?? "default");
			data.reply?.(result);

			const summary = [];
			if (result.tablesCreated.length) summary.push(`tables: ${result.tablesCreated.join(", ")}`);
			if (result.columnsAdded.length) summary.push(`columns: ${result.columnsAdded.join(", ")}`);
			if (result.indexesCreated.length) summary.push(`indexes: ${result.indexesCreated.join(", ")}`);

			if (summary.length) {
				log("schema-applied", { actor: data.actor, changes: summary.join("; ") });
			} else {
				log("schema-ok", { actor: data.actor, message: "schema up to date" });
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

			// Emit per-actor ready event
			pi.events.emit(`kysely:schema:ready:${data.actor}`, result);
		} catch (err: any) {
			data.reply?.({
				ok: false,
				tablesCreated: [],
				columnsAdded: [],
				indexesCreated: [],
				errors: [err.message],
			});
			pushAck(pi, {
				ok: false,
				operation: "schema:register",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
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
			owner: string;
			grantee: string;
			table: string;
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
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

	// ── CRUD operations ───────────────────────────────────────

	pi.events.on("kysely:table:select", async (payload: unknown) => {
		const data = payload as {
			actor: string;
			input: TableSelectInput;
			reply?: (rows: unknown[]) => void;
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
		};
		try {
			const rows = await selectRows(data.actor, data.input);
			data.reply?.(rows);
			pushAck(pi, {
				ok: true, operation: "table:select", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input.table,
				result: rows,
			}, log, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false, operation: "table:select", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input?.table,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	pi.events.on("kysely:table:insert", async (payload: unknown) => {
		const data = payload as {
			actor: string;
			input: TableInsertInput;
			reply?: (result: unknown) => void;
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
		};
		try {
			const result = await insertRows(data.actor, data.input);
			data.reply?.(result);
			pushAck(pi, {
				ok: true, operation: "table:insert", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input.table,
				result,
			}, log, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false, operation: "table:insert", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input?.table,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	pi.events.on("kysely:table:update", async (payload: unknown) => {
		const data = payload as {
			actor: string;
			input: TableUpdateInput;
			reply?: (result: unknown) => void;
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
		};
		try {
			const result = await updateRows(data.actor, data.input);
			data.reply?.(result);
			pushAck(pi, {
				ok: true, operation: "table:update", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input.table,
				result,
			}, log, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false, operation: "table:update", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input?.table,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	pi.events.on("kysely:table:delete", async (payload: unknown) => {
		const data = payload as {
			actor: string;
			input: TableDeleteInput;
			reply?: (result: unknown) => void;
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
		};
		try {
			const result = await deleteRows(data.actor, data.input);
			data.reply?.(result);
			pushAck(pi, {
				ok: true, operation: "table:delete", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input.table,
				result,
			}, log, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false, operation: "table:delete", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input?.table,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});

	pi.events.on("kysely:table:count", async (payload: unknown) => {
		const data = payload as {
			actor: string;
			input: TableCountInput;
			reply?: (count: number) => void;
			requestId?: string;
			ack?: (ack: KyselyAck) => void;
		};
		try {
			const count = await countRows(data.actor, data.input);
			data.reply?.(count);
			pushAck(pi, {
				ok: true, operation: "table:count", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input.table,
				result: count,
			}, log, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false, operation: "table:count", timestamp: Date.now(),
				requestId: data.requestId, actor: data.actor, table: data.input?.table,
				error: err?.message ?? String(err),
			}, log, data.ack);
		}
	});
}
