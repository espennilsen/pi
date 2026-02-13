/**
 * pi-kysely — Schema-as-data engine.
 *
 * Extensions declare their table schemas as plain objects via events.
 * This module handles:
 *   1. DDL generation — createTable / addColumn / createIndex (no raw SQL)
 *   2. Migration diffing — compares declared schema to live DB, applies changes
 *   3. Schema registry — tracks which extension owns which tables
 *
 * All DDL uses Kysely's schema builder, so it works across SQLite/PostgreSQL/MySQL.
 */

import type { ColumnDataType, Kysely } from "kysely";

// ── Public types (used in event payloads) ───────────────────────

export type ColumnType =
	| "integer"
	| "text"
	| "real"
	| "boolean"
	| "blob"
	| "json"
	| "timestamp";

export interface ColumnDef {
	type: ColumnType;
	primaryKey?: boolean;
	autoIncrement?: boolean;
	notNull?: boolean;
	unique?: boolean;
	default?: string | number | boolean | null;
	/** Foreign key: "table.column" */
	references?: string;
	onDelete?: "cascade" | "set null" | "restrict" | "no action";
}

export interface IndexDef {
	columns: string[];
	unique?: boolean;
	name?: string;
}

export interface TableDef {
	columns: Record<string, ColumnDef>;
	indexes?: IndexDef[];
	unique?: string[][];
}

export interface SchemaRegistration {
	/** Extension identity (e.g. "pi-calendar") */
	actor: string;
	/** Named database to use (default: the pi-kysely default) */
	database?: string;
	/** Table definitions keyed by table name */
	tables: Record<string, TableDef>;
}

export interface SchemaRegistrationResult {
	ok: boolean;
	tablesCreated: string[];
	columnsAdded: string[];
	indexesCreated: string[];
	errors: string[];
}

// ── Schema registry (in-memory) ─────────────────────────────────

interface RegisteredSchema {
	actor: string;
	database: string;
	tables: Record<string, TableDef>;
	registeredAt: number;
}

const schemas = new Map<string, RegisteredSchema>();

export function getRegisteredSchemas(): RegisteredSchema[] {
	return [...schemas.values()];
}

export function getSchemaForActor(actor: string): RegisteredSchema | undefined {
	return schemas.get(actor);
}

// ── Main entry: apply schema ────────────────────────────────────

/**
 * Register an extension's schema and apply DDL to the database.
 * Creates tables that don't exist, adds missing columns, creates missing indexes.
 * Does NOT drop columns or tables (safe, additive-only migrations).
 */
export async function applySchema(
	db: Kysely<any>,
	registration: SchemaRegistration,
	databaseName: string,
): Promise<SchemaRegistrationResult> {
	const result: SchemaRegistrationResult = {
		ok: true,
		tablesCreated: [],
		columnsAdded: [],
		indexesCreated: [],
		errors: [],
	};

	const existingTables = await getExistingTables(db);
	const existingIndexes = await getExistingIndexes(db);

	for (const [tableName, tableDef] of Object.entries(registration.tables)) {
		try {
			if (!existingTables.has(tableName)) {
				// Create table
				await createTable(db, tableName, tableDef);
				result.tablesCreated.push(tableName);
			} else {
				// Diff columns and add missing ones
				const existingCols = await getExistingColumns(db, tableName);
				for (const [colName, colDef] of Object.entries(tableDef.columns)) {
					if (colDef.primaryKey) continue; // Can't add PK after creation
					if (!existingCols.has(colName)) {
						await addColumn(db, tableName, colName, colDef);
						result.columnsAdded.push(`${tableName}.${colName}`);
					}
				}
			}

			// Create missing indexes
			const allIndexes = buildIndexList(tableName, tableDef);
			for (const idx of allIndexes) {
				if (!existingIndexes.has(idx.name)) {
					await createIndex(db, tableName, idx);
					result.indexesCreated.push(idx.name);
				}
			}
		} catch (err: any) {
			result.ok = false;
			result.errors.push(`${tableName}: ${err.message}`);
		}
	}

	// Store in registry
	schemas.set(registration.actor, {
		actor: registration.actor,
		database: databaseName,
		tables: registration.tables,
		registeredAt: Date.now(),
	});

	return result;
}

// ── DDL via Kysely schema builder ───────────────────────────────

async function createTable(
	db: Kysely<any>,
	tableName: string,
	def: TableDef,
): Promise<void> {
	let builder = db.schema.createTable(tableName);

	for (const [colName, colDef] of Object.entries(def.columns)) {
		builder = builder.addColumn(colName, mapColumnType(colDef), (col) => {
			let c = col;
			if (colDef.primaryKey) c = c.primaryKey();
			if (colDef.autoIncrement) c = c.autoIncrement();
			if (colDef.notNull && !colDef.primaryKey) c = c.notNull();
			if (colDef.unique) c = c.unique();
			if (colDef.default !== undefined && colDef.default !== null) {
				c = c.defaultTo(colDef.default as any);
			}
			if (colDef.references) {
				const [refTable, refCol] = colDef.references.split(".");
				c = c.references(`${refTable}.${refCol}`);
				if (colDef.onDelete) c = c.onDelete(colDef.onDelete);
			}
			return c;
		});
	}

	// Composite unique constraints
	if (def.unique) {
		for (const cols of def.unique) {
			builder = builder.addUniqueConstraint(
				`uq_${tableName}_${cols.join("_")}`,
				cols as any,
			);
		}
	}

	await builder.execute();
}

async function addColumn(
	db: Kysely<any>,
	tableName: string,
	colName: string,
	colDef: ColumnDef,
): Promise<void> {
	await db.schema
		.alterTable(tableName)
		.addColumn(colName, mapColumnType(colDef), (col) => {
			let c = col;
			// Note: most DBs don't allow NOT NULL without default on ALTER
			if (colDef.default !== undefined && colDef.default !== null) {
				c = c.defaultTo(colDef.default as any);
				if (colDef.notNull) c = c.notNull();
			}
			if (colDef.references) {
				const [refTable, refCol] = colDef.references.split(".");
				c = c.references(`${refTable}.${refCol}`);
				if (colDef.onDelete) c = c.onDelete(colDef.onDelete);
			}
			return c;
		})
		.execute();
}

async function createIndex(
	db: Kysely<any>,
	tableName: string,
	idx: { name: string; columns: string[]; unique?: boolean },
): Promise<void> {
	let builder = db.schema.createIndex(idx.name).on(tableName);
	builder = builder.columns(idx.columns);
	if (idx.unique) builder = builder.unique();
	await builder.execute();
}

// ── Introspection (cross-dialect) ───────────────────────────────

async function getExistingTables(db: Kysely<any>): Promise<Set<string>> {
	const tables = await db.introspection.getTables();
	return new Set(tables.map((t) => t.name));
}

async function getExistingColumns(
	db: Kysely<any>,
	tableName: string,
): Promise<Set<string>> {
	const tables = await db.introspection.getTables();
	const table = tables.find((t) => t.name === tableName);
	if (!table) return new Set();
	return new Set(table.columns.map((c) => c.name));
}

async function getExistingIndexes(db: Kysely<any>): Promise<Set<string>> {
	// Kysely doesn't expose index introspection directly, so we use a
	// cross-dialect workaround: try to create and catch "already exists".
	// For now, we track created indexes in-memory per session.
	// TODO: Use dialect-specific introspection if needed.
	return existingIndexCache;
}

const existingIndexCache = new Set<string>();

/** Call once at startup to seed the index cache from the DB. */
export async function seedIndexCache(db: Kysely<any>): Promise<void> {
	try {
		// SQLite
		const rows: any[] = await db
			.selectFrom("sqlite_master" as any)
			.select(["name"])
			.where("type" as any, "=", "index")
			.execute()
			.catch(() => []);
		for (const r of rows) existingIndexCache.add(r.name);
	} catch {
		// Not SQLite — try pg
		try {
			const rows: any[] = await db
				.selectFrom("pg_indexes" as any)
				.select(["indexname"])
				.execute()
				.catch(() => []);
			for (const r of rows) existingIndexCache.add(r.indexname);
		} catch {
			// MySQL or unknown — indexes will be created and errors caught
		}
	}
}

// ── Helpers ─────────────────────────────────────────────────────

function mapColumnType(colDef: ColumnDef): ColumnDataType {
	switch (colDef.type) {
		case "integer":
		case "boolean":
			return "integer";
		case "text":
		case "json":
		case "timestamp":
			return "text";
		case "real":
			return "real";
		case "blob":
			return "blob";
		default:
			return "text";
	}
}

function buildIndexList(
	tableName: string,
	def: TableDef,
): Array<{ name: string; columns: string[]; unique?: boolean }> {
	const list: Array<{ name: string; columns: string[]; unique?: boolean }> = [];

	if (def.indexes) {
		for (const idx of def.indexes) {
			list.push({
				name: idx.name ?? `idx_${tableName}_${idx.columns.join("_")}`,
				columns: idx.columns,
				unique: idx.unique,
			});
		}
	}

	return list;
}
