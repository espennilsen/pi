import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	deleteRows,
	grantTableAccess,
	insertRows,
	listTableGrants,
	revokeTableAccess,
	selectRows,
	updateRows,
	type TableDeleteInput,
	type TableGrant,
	type TableInsertInput,
	type TableSelectInput,
	type TableUpdateInput,
} from "./table-api.ts";

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

function pushAck(pi: ExtensionAPI, ack: KyselyAck, callback?: (ack: KyselyAck) => void): void {
	callback?.(ack);
	if (ack.requestId) {
		pi.events.emit("kysely:ack", ack);
	}
}

export function wireKyselyEvents(pi: ExtensionAPI): void {
	pi.events.on("kysely:grant", (payload: unknown) => {
		const data = payload as TableGrant & { requestId?: string; ack?: (ack: KyselyAck) => void };
		try {
			grantTableAccess(data);
			pushAck(pi, {
				ok: true,
				operation: "grant",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.owner,
				table: data.table,
			}, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false,
				operation: "grant",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.owner,
				table: data.table,
				error: err?.message ?? String(err),
			}, data.ack);
		}
	});

	pi.events.on("kysely:revoke", (payload: unknown) => {
		const data = payload as { owner: string; grantee: string; table: string; requestId?: string; ack?: (ack: KyselyAck) => void };
		try {
			const removed = revokeTableAccess(data);
			pushAck(pi, {
				ok: true,
				operation: "revoke",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.owner,
				table: data.table,
				result: { removed },
			}, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false,
				operation: "revoke",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.owner,
				table: data.table,
				error: err?.message ?? String(err),
			}, data.ack);
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
				ok: true,
				operation: "grants",
				timestamp: Date.now(),
				requestId: data.requestId,
				result,
			}, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false,
				operation: "grants",
				timestamp: Date.now(),
				requestId: data.requestId,
				error: err?.message ?? String(err),
			}, data.ack);
		}
	});

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
				ok: true,
				operation: "table:select",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				table: data.input.table,
				result: rows,
			}, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false,
				operation: "table:select",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				table: data.input?.table,
				error: err?.message ?? String(err),
			}, data.ack);
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
				ok: true,
				operation: "table:insert",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				table: data.input.table,
				result,
			}, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false,
				operation: "table:insert",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				table: data.input?.table,
				error: err?.message ?? String(err),
			}, data.ack);
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
				ok: true,
				operation: "table:update",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				table: data.input.table,
				result,
			}, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false,
				operation: "table:update",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				table: data.input?.table,
				error: err?.message ?? String(err),
			}, data.ack);
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
				ok: true,
				operation: "table:delete",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				table: data.input.table,
				result,
			}, data.ack);
		} catch (err: any) {
			pushAck(pi, {
				ok: false,
				operation: "table:delete",
				timestamp: Date.now(),
				requestId: data.requestId,
				actor: data.actor,
				table: data.input?.table,
				error: err?.message ?? String(err),
			}, data.ack);
		}
	});
}
