/**
 * pi-kysely — Table API.
 *
 * CRUD operations that run through Kysely's query builder (no raw SQL).
 * Supports:
 *   - Rich where clauses (operators, AND/OR grouping, IS NULL, IN)
 *   - Named databases (or default)
 *   - Column selection, ordering, limit/offset
 *   - RBAC: extensions own their registered tables, others need grants
 */

import type { DeleteResult, InsertResult, UpdateResult, Kysely } from "kysely";
import { getDatabase, requireDatabase } from "./registry.ts";
import { getSchemaForActor } from "./schema.ts";

// ── Types ───────────────────────────────────────────────────────

export type TableOperation = "select" | "insert" | "update" | "delete";

export interface TableGrant {
	owner: string;
	grantee: string;
	table: string;
	operations: TableOperation[];
}

// ── Where clause DSL ────────────────────────────────────────────

/** Comparison operators for filter expressions. */
export type WhereOp =
	| "="
	| "!="
	| "<"
	| ">"
	| "<="
	| ">="
	| "like"
	| "not like"
	| "in"
	| "not in"
	| "is null"
	| "is not null";

/** A single column condition. */
export interface WhereCondition {
	col: string;
	op: WhereOp;
	val?: unknown;
}

/**
 * A group of conditions combined with AND or OR.
 * Exactly one of `and` or `or` should be set.
 */
export interface WhereGroup {
	and?: WhereFilter[];
	or?: WhereFilter[];
}

/**
 * A where filter is one of:
 *   - Record<string, unknown> — simple equality (all keys ANDed)
 *   - WhereCondition — single column + operator
 *   - WhereGroup — nested AND/OR group
 */
export type WhereFilter = Record<string, unknown> | WhereCondition | WhereGroup;

/** Order by clause. */
export interface OrderByClause {
	column: string;
	direction?: "asc" | "desc";
}

// ── Input types ─────────────────────────────────────────────────

export interface TableSelectInput {
	/** Named database (default: pi-kysely default). */
	database?: string;
	table: string;
	/** Specific columns to select (default: all). */
	columns?: string[];
	/** Where conditions. Simple object = equality AND. */
	where?: WhereFilter;
	orderBy?: OrderByClause | OrderByClause[];
	limit?: number;
	offset?: number;
}

export interface TableInsertInput {
	database?: string;
	table: string;
	values: Record<string, unknown> | Array<Record<string, unknown>>;
	/** Return inserted rows (default: false — returns InsertResult). */
	returning?: boolean;
}

export interface TableUpdateInput {
	database?: string;
	table: string;
	set: Record<string, unknown>;
	where?: WhereFilter;
}

export interface TableDeleteInput {
	database?: string;
	table: string;
	where?: WhereFilter;
}

export interface TableCountInput {
	database?: string;
	table: string;
	where?: WhereFilter;
}

// ── RBAC ────────────────────────────────────────────────────────

const grants: TableGrant[] = [];

function ownPrefix(extensionId: string): string {
	return `${extensionId}__`;
}

function isOwnedTable(extensionId: string, table: string): boolean {
	return table.startsWith(ownPrefix(extensionId));
}

/** Check if actor owns this table via schema registration. */
function isSchemaOwned(actor: string, table: string): boolean {
	const schema = getSchemaForActor(actor);
	if (!schema) return false;
	return table in schema.tables;
}

function tableMatches(pattern: string, table: string): boolean {
	if (pattern.endsWith("*")) return table.startsWith(pattern.slice(0, -1));
	return pattern === table;
}

function canAccess(actor: string, table: string, operation: TableOperation): boolean {
	if (isOwnedTable(actor, table)) return true;
	if (isSchemaOwned(actor, table)) return true;
	for (const grant of grants) {
		if (grant.grantee !== actor) continue;
		if (!tableMatches(grant.table, table)) continue;
		if (grant.operations.includes(operation)) return true;
	}
	return false;
}

function assertAccess(actor: string, table: string, operation: TableOperation): void {
	if (!canAccess(actor, table, operation)) {
		throw new Error(`RBAC denied: "${actor}" cannot ${operation} on table "${table}"`);
	}
}

export function grantTableAccess(input: TableGrant): void {
	const owner = input.owner.trim();
	const grantee = input.grantee.trim();
	const table = input.table.trim();
	const operations = Array.from(new Set(input.operations));
	if (!owner || !grantee || !table || operations.length === 0) {
		throw new Error("owner, grantee, table, and operations are required");
	}

	const existing = grants.find(
		(g) => g.owner === owner && g.grantee === grantee && g.table === table,
	);
	if (existing) {
		existing.operations = operations;
		return;
	}
	grants.push({ owner, grantee, table, operations });
}

export function revokeTableAccess(input: {
	owner: string;
	grantee: string;
	table: string;
}): boolean {
	const idx = grants.findIndex(
		(g) =>
			g.owner === input.owner.trim() &&
			g.grantee === input.grantee.trim() &&
			g.table === input.table.trim(),
	);
	if (idx === -1) return false;
	grants.splice(idx, 1);
	return true;
}

export function listTableGrants(forGrantee?: string): TableGrant[] {
	if (!forGrantee)
		return grants.map((g) => ({ ...g, operations: [...g.operations] }));
	return grants
		.filter((g) => g.grantee === forGrantee)
		.map((g) => ({ ...g, operations: [...g.operations] }));
}

// ── Resolve database ────────────────────────────────────────────

function resolveDb(name?: string): Kysely<any> {
	if (name) {
		const db = getDatabase(name);
		if (!db) throw new Error(`Database "${name}" is not registered`);
		return db;
	}
	return requireDatabase();
}

// ── Where clause builder ────────────────────────────────────────

function isWhereCondition(f: WhereFilter): f is WhereCondition {
	return "col" in f && "op" in f;
}

function isWhereGroup(f: WhereFilter): f is WhereGroup {
	return "and" in f || "or" in f;
}

function applyWhereFilter<T>(query: T, filter: WhereFilter): T {
	let q: any = query;

	if (isWhereCondition(filter)) {
		return applyCondition(q, filter);
	}

	if (isWhereGroup(filter)) {
		if (filter.and) {
			for (const sub of filter.and) {
				q = applyWhereFilter(q, sub);
			}
			return q;
		}
		if (filter.or) {
			const orFilters = filter.or;
			q = q.where((eb: any) => {
				const exprs = orFilters.map((sub) => buildExpression(eb, sub));
				return eb.or(exprs);
			});
			return q;
		}
		return q;
	}

	// Simple object — equality AND
	for (const [column, value] of Object.entries(filter)) {
		if (value === null) {
			q = q.where(column as any, "is", null);
		} else {
			q = q.where(column as any, "=", value as any);
		}
	}
	return q;
}

function applyCondition<T>(query: T, cond: WhereCondition): T {
	let q: any = query;
	const { col, op, val } = cond;

	switch (op) {
		case "is null":
			q = q.where(col as any, "is", null);
			break;
		case "is not null":
			q = q.where(col as any, "is not", null);
			break;
		case "in":
			q = q.where(col as any, "in", val as any[]);
			break;
		case "not in":
			q = q.where(col as any, "not in", val as any[]);
			break;
		default:
			q = q.where(col as any, op, val as any);
			break;
	}
	return q;
}

function buildExpression(eb: any, filter: WhereFilter): any {
	if (isWhereCondition(filter)) {
		return buildConditionExpr(eb, filter);
	}

	if (isWhereGroup(filter)) {
		if (filter.and) {
			const exprs = filter.and.map((sub) => buildExpression(eb, sub));
			return eb.and(exprs);
		}
		if (filter.or) {
			const exprs = filter.or.map((sub) => buildExpression(eb, sub));
			return eb.or(exprs);
		}
	}

	// Simple object
	const entries = Object.entries(filter);
	if (entries.length === 0) return eb.val(true); // no-op
	const exprs = entries.map(([col, val]) => {
		if (val === null) return eb(col, "is", null);
		return eb(col, "=", val);
	});
	return exprs.length === 1 ? exprs[0] : eb.and(exprs);
}

function buildConditionExpr(eb: any, cond: WhereCondition): any {
	const { col, op, val } = cond;
	switch (op) {
		case "is null":
			return eb(col, "is", null);
		case "is not null":
			return eb(col, "is not", null);
		case "in":
			return eb(col, "in", val);
		case "not in":
			return eb(col, "not in", val);
		default:
			return eb(col, op, val);
	}
}

// ── CRUD Operations ─────────────────────────────────────────────

export async function selectRows(
	actor: string,
	input: TableSelectInput,
): Promise<unknown[]> {
	assertAccess(actor, input.table, "select");
	const db = resolveDb(input.database);

	let query: any = db.selectFrom(input.table as any);

	// Column selection
	if (input.columns?.length) {
		query = query.select(input.columns.map((c) => c as any));
	} else {
		query = query.selectAll();
	}

	// Where
	if (input.where) {
		query = applyWhereFilter(query, input.where);
	}

	// Order by
	if (input.orderBy) {
		const orders = Array.isArray(input.orderBy)
			? input.orderBy
			: [input.orderBy];
		for (const o of orders) {
			query = query.orderBy(o.column as any, o.direction ?? "asc");
		}
	}

	// Limit / offset
	if (typeof input.limit === "number") query = query.limit(input.limit);
	if (typeof input.offset === "number") query = query.offset(input.offset);

	return await query.execute();
}

export async function insertRows(
	actor: string,
	input: TableInsertInput,
): Promise<InsertResult[]> {
	assertAccess(actor, input.table, "insert");
	const db = resolveDb(input.database);
	const rows = Array.isArray(input.values) ? input.values : [input.values];
	const results: InsertResult[] = [];

	for (const row of rows) {
		const result = await db
			.insertInto(input.table as any)
			.values(row as any)
			.executeTakeFirst();
		if (result) results.push(result);
	}
	return results;
}

export async function updateRows(
	actor: string,
	input: TableUpdateInput,
): Promise<UpdateResult> {
	assertAccess(actor, input.table, "update");
	const db = resolveDb(input.database);
	let query: any = db.updateTable(input.table as any).set(input.set as any);
	if (input.where) query = applyWhereFilter(query, input.where);
	return await query.executeTakeFirst();
}

export async function deleteRows(
	actor: string,
	input: TableDeleteInput,
): Promise<DeleteResult> {
	assertAccess(actor, input.table, "delete");
	const db = resolveDb(input.database);
	let query: any = db.deleteFrom(input.table as any);
	if (input.where) query = applyWhereFilter(query, input.where);
	return await query.executeTakeFirst();
}

export async function countRows(
	actor: string,
	input: TableCountInput,
): Promise<number> {
	assertAccess(actor, input.table, "select");
	const db = resolveDb(input.database);
	let query: any = db
		.selectFrom(input.table as any)
		.select(db.fn.countAll().as("count"));
	if (input.where) query = applyWhereFilter(query, input.where);
	const result = await query.executeTakeFirst();
	return Number(result?.count ?? 0);
}

// ── Extension client (convenience, not used over event bus) ─────

export interface ExtensionTableClient {
	extensionId: string;
	ownTable(table: string): string;
	grant(
		grantee: string,
		table: string,
		operations: TableOperation[],
	): void;
	revoke(grantee: string, table: string): boolean;
	grants(): TableGrant[];
	select(input: TableSelectInput): Promise<unknown[]>;
	insert(input: TableInsertInput): Promise<InsertResult[]>;
	update(input: TableUpdateInput): Promise<UpdateResult>;
	delete(input: TableDeleteInput): Promise<DeleteResult>;
	count(input: TableCountInput): Promise<number>;
}

export function createExtensionTableClient(
	extensionId: string,
): ExtensionTableClient {
	const actor = extensionId.trim();
	if (!actor) throw new Error("extensionId is required");
	return {
		extensionId: actor,
		ownTable: (table: string) => {
			if (!table.trim()) throw new Error("table is required");
			if (table.includes("__")) return table;
			return `${actor}__${table}`;
		},
		grant: (grantee, table, operations) =>
			grantTableAccess({ owner: actor, grantee, table, operations }),
		revoke: (grantee, table) =>
			revokeTableAccess({ owner: actor, grantee, table }),
		grants: () => listTableGrants().filter((g) => g.owner === actor),
		select: (input) => selectRows(actor, input),
		insert: (input) => insertRows(actor, input),
		update: (input) => updateRows(actor, input),
		delete: (input) => deleteRows(actor, input),
		count: (input) => countRows(actor, input),
	};
}
