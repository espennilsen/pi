/**
 * pi-kysely — Table API.
 *
 * Two layers:
 *   1. Schema registration (DDL) — via Kysely schema builder, fully portable
 *   2. Raw SQL queries (DML) — via kysely:query event, simple and expressive
 *
 * Plus RBAC: extensions own their schema-registered tables.
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import { getDatabase, requireDatabase } from "./registry.ts";
import { getSchemaForActor } from "./schema.ts";

// ── RBAC Types ──────────────────────────────────────────────────

export type TableOperation = "select" | "insert" | "update" | "delete";

export interface TableGrant {
	owner: string;
	grantee: string;
	table: string;
	operations: TableOperation[];
}

// ── Raw query types ─────────────────────────────────────────────

export interface QueryInput {
	/** Named database (default: pi-kysely default). */
	database?: string;
	/** SQL query string with ? placeholders. */
	sql: string;
	/** Positional parameters for ? placeholders. */
	params?: unknown[];
}

export interface QueryResult {
	/** Rows returned (for SELECT). */
	rows: Record<string, unknown>[];
	/** Number of affected rows (for INSERT/UPDATE/DELETE). */
	numAffectedRows?: number;
	/** Last inserted row ID (for INSERT, when supported). */
	insertId?: number | bigint;
}

// ── RBAC ────────────────────────────────────────────────────────

const grants: TableGrant[] = [];

function ownPrefix(extensionId: string): string {
	return `${extensionId}__`;
}

function isOwnedTable(extensionId: string, table: string): boolean {
	return table.startsWith(ownPrefix(extensionId));
}

function isSchemaOwned(actor: string, table: string): boolean {
	const schema = getSchemaForActor(actor);
	if (!schema) return false;
	return table in schema.tables;
}

function tableMatches(pattern: string, table: string): boolean {
	if (pattern.endsWith("*")) return table.startsWith(pattern.slice(0, -1));
	return pattern === table;
}

function canAccess(actor: string, table: string, _operation: TableOperation): boolean {
	if (isOwnedTable(actor, table)) return true;
	if (isSchemaOwned(actor, table)) return true;
	for (const grant of grants) {
		if (grant.grantee !== actor) continue;
		if (!tableMatches(grant.table, table)) continue;
		if (grant.operations.includes(_operation)) return true;
	}
	return false;
}

// ── RBAC management ─────────────────────────────────────────────

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

// ── RBAC check for raw SQL ──────────────────────────────────────

/**
 * Extract table names from a SQL query (best-effort).
 * Catches FROM, INTO, UPDATE, JOIN patterns.
 */
function extractTables(sqlStr: string): string[] {
	const tables = new Set<string>();
	const patterns = [
		/\bFROM\s+(\w+)/gi,
		/\bINTO\s+(\w+)/gi,
		/\bUPDATE\s+(\w+)/gi,
		/\bJOIN\s+(\w+)/gi,
		/\bTABLE\s+(\w+)/gi,
	];
	for (const re of patterns) {
		let m;
		while ((m = re.exec(sqlStr))) tables.add(m[1]);
	}
	return [...tables];
}

function classifyQuery(sqlStr: string): TableOperation {
	const first = sqlStr.trim().toUpperCase();
	if (first.startsWith("SELECT") || first.startsWith("WITH")) return "select";
	if (first.startsWith("INSERT")) return "insert";
	if (first.startsWith("UPDATE")) return "update";
	if (first.startsWith("DELETE")) return "delete";
	return "select"; // default for PRAGMA, EXPLAIN, etc.
}

export function assertQueryAccess(actor: string, sqlStr: string): void {
	const tables = extractTables(sqlStr);
	const op = classifyQuery(sqlStr);
	for (const table of tables) {
		if (!canAccess(actor, table, op)) {
			throw new Error(`RBAC denied: "${actor}" cannot ${op} on table "${table}"`);
		}
	}
}

// ── Raw SQL execution ───────────────────────────────────────────

export async function executeQuery(
	actor: string,
	input: QueryInput,
): Promise<QueryResult> {
	assertQueryAccess(actor, input.sql);
	const db = resolveDb(input.database);

	const params = input.params ?? [];

	// Build a sql template with ? placeholders replaced by parameter refs.
	// sql`...` uses tagged template literals; we construct the equivalent
	// by splitting on ? and interleaving parameter values.
	const parts = input.sql.split("?");
	const strings = parts as unknown as TemplateStringsArray;
	const query = sql(strings, ...params);

	const result = await query.execute(db);

	return {
		rows: (result.rows ?? []) as Record<string, unknown>[],
		numAffectedRows:
			result.numAffectedRows != null
				? Number(result.numAffectedRows)
				: undefined,
		insertId:
			result.insertId != null ? result.insertId : undefined,
	};
}
