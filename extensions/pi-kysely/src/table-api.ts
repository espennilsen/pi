import type { DeleteResult, InsertResult, UpdateResult } from "kysely";
import { requireDatabase } from "./registry.ts";

export type TableOperation = "select" | "insert" | "update" | "delete";

export interface TableGrant {
	owner: string;
	grantee: string;
	table: string;
	operations: TableOperation[];
}

export interface TableSelectInput {
	table: string;
	where?: Record<string, unknown>;
	limit?: number;
	orderBy?: { column: string; direction?: "asc" | "desc" };
}

export interface TableInsertInput {
	table: string;
	values: Record<string, unknown> | Array<Record<string, unknown>>;
}

export interface TableUpdateInput {
	table: string;
	set: Record<string, unknown>;
	where?: Record<string, unknown>;
}

export interface TableDeleteInput {
	table: string;
	where?: Record<string, unknown>;
}

const grants: TableGrant[] = [];

function ownPrefix(extensionId: string): string {
	return `${extensionId}__`;
}

function isOwnedTable(extensionId: string, table: string): boolean {
	return table.startsWith(ownPrefix(extensionId));
}

function tableMatches(pattern: string, table: string): boolean {
	if (pattern.endsWith("*")) return table.startsWith(pattern.slice(0, -1));
	return pattern === table;
}

function isGrantOwnedBy(grantOwner: string, tablePattern: string): boolean {
	if (tablePattern.endsWith("*")) {
		return tablePattern.slice(0, -1).startsWith(ownPrefix(grantOwner));
	}
	return isOwnedTable(grantOwner, tablePattern);
}

function canAccess(actor: string, table: string, operation: TableOperation): boolean {
	if (isOwnedTable(actor, table)) return true;
	for (const grant of grants) {
		if (grant.grantee !== actor) continue;
		if (!tableMatches(grant.table, table)) continue;
		if (grant.operations.includes(operation)) return true;
	}
	return false;
}

function assertAccess(actor: string, table: string, operation: TableOperation): void {
	if (!canAccess(actor, table, operation)) {
		throw new Error(`RBAC denied: extension \"${actor}\" cannot ${operation} on table \"${table}\"`);
	}
}

function applyWhere<T>(query: T, where?: Record<string, unknown>): T {
	let q: any = query;
	if (!where) return q;
	for (const [column, value] of Object.entries(where)) {
		q = q.where(column as any, "=", value as any);
	}
	return q;
}

export function grantTableAccess(input: TableGrant): void {
	const owner = input.owner.trim();
	const grantee = input.grantee.trim();
	const table = input.table.trim();
	const operations = Array.from(new Set(input.operations));
	if (!owner || !grantee || !table || operations.length === 0) {
		throw new Error("owner, grantee, table, and operations are required");
	}
	if (!isGrantOwnedBy(owner, table)) {
		throw new Error(`RBAC denied: owner \"${owner}\" can only grant on its own tables (${ownPrefix(owner)}*)`);
	}

	const existing = grants.find((g) => g.owner === owner && g.grantee === grantee && g.table === table);
	if (existing) {
		existing.operations = operations;
		return;
	}
	grants.push({ owner, grantee, table, operations });
}

export function revokeTableAccess(input: { owner: string; grantee: string; table: string }): boolean {
	const owner = input.owner.trim();
	const grantee = input.grantee.trim();
	const table = input.table.trim();
	const idx = grants.findIndex((g) => g.owner === owner && g.grantee === grantee && g.table === table);
	if (idx === -1) return false;
	grants.splice(idx, 1);
	return true;
}

export function listTableGrants(forGrantee?: string): TableGrant[] {
	if (!forGrantee) return grants.map((g) => ({ ...g, operations: [...g.operations] }));
	return grants.filter((g) => g.grantee === forGrantee).map((g) => ({ ...g, operations: [...g.operations] }));
}

export function ownTableName(extensionId: string, table: string): string {
	if (!table.trim()) throw new Error("table is required");
	if (table.includes("__")) return table;
	return `${extensionId}__${table}`;
}

export async function selectRows(actor: string, input: TableSelectInput): Promise<unknown[]> {
	assertAccess(actor, input.table, "select");
	const db = requireDatabase();
	let query: any = db.selectFrom(input.table as any).selectAll();
	query = applyWhere(query, input.where);
	if (input.orderBy) query = query.orderBy(input.orderBy.column as any, input.orderBy.direction ?? "asc");
	if (typeof input.limit === "number") query = query.limit(input.limit);
	return await query.execute();
}

export async function insertRows(actor: string, input: TableInsertInput): Promise<InsertResult[]> {
	assertAccess(actor, input.table, "insert");
	const db = requireDatabase();
	const rows = Array.isArray(input.values) ? input.values : [input.values];
	const results: InsertResult[] = [];
	for (const row of rows) {
		const result = await db.insertInto(input.table as any).values(row as any).executeTakeFirst();
		if (result) results.push(result);
	}
	return results;
}

export async function updateRows(actor: string, input: TableUpdateInput): Promise<UpdateResult> {
	assertAccess(actor, input.table, "update");
	const db = requireDatabase();
	let query: any = db.updateTable(input.table as any).set(input.set as any);
	query = applyWhere(query, input.where);
	return await query.executeTakeFirst();
}

export async function deleteRows(actor: string, input: TableDeleteInput): Promise<DeleteResult> {
	assertAccess(actor, input.table, "delete");
	const db = requireDatabase();
	let query: any = db.deleteFrom(input.table as any);
	query = applyWhere(query, input.where);
	return await query.executeTakeFirst();
}

export interface ExtensionTableClient {
	extensionId: string;
	ownTable(table: string): string;
	grant(grantee: string, table: string, operations: TableOperation[]): void;
	revoke(grantee: string, table: string): boolean;
	grants(): TableGrant[];
	select(input: TableSelectInput): Promise<unknown[]>;
	insert(input: TableInsertInput): Promise<InsertResult[]>;
	update(input: TableUpdateInput): Promise<UpdateResult>;
	delete(input: TableDeleteInput): Promise<DeleteResult>;
}

export function createExtensionTableClient(extensionId: string): ExtensionTableClient {
	const actor = extensionId.trim();
	if (!actor) throw new Error("extensionId is required");
	return {
		extensionId: actor,
		ownTable: (table: string) => ownTableName(actor, table),
		grant: (grantee: string, table: string, operations: TableOperation[]) => {
			grantTableAccess({ owner: actor, grantee, table, operations });
		},
		revoke: (grantee: string, table: string) => revokeTableAccess({ owner: actor, grantee, table }),
		grants: () => listTableGrants().filter((g) => g.owner === actor),
		select: (input: TableSelectInput) => selectRows(actor, input),
		insert: (input: TableInsertInput) => insertRows(actor, input),
		update: (input: TableUpdateInput) => updateRows(actor, input),
		delete: (input: TableDeleteInput) => deleteRows(actor, input),
	};
}
