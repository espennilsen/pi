/**
 * pi-kysely — Migration engine.
 *
 * Two flows:
 *   1. Generate — diff desired schema vs live DB, produce SQL, apply it, return
 *      the migration content so the calling extension can store it in its repo.
 *   2. Apply — extension sends its stored migration files, pi-kysely executes
 *      unapplied ones and records them in the tracking table.
 *
 * Tracking table: `_kysely_migrations` (auto-created).
 *
 * All DDL uses Kysely's schema builder → compile() for dialect-portable SQL.
 */

import { createHash } from "node:crypto";
import { type ColumnDataType, type Kysely, sql } from "kysely";
import type { ColumnDef, TableDef } from "./schema.ts";

// ── Public types ────────────────────────────────────────────────

export interface MigrationRecord {
	id: number;
	actor: string;
	name: string;
	checksum: string;
	applied_at: string;
}

export interface GeneratedMigration {
	/** Migration name, e.g. "0001_initial" */
	name: string;
	/** Extension actor that owns this migration */
	actor: string;
	/** Complete SQL (semicolon-separated statements) */
	sql: string;
	/** Individual SQL statements */
	statements: string[];
	/** Generation timestamp (epoch ms) */
	timestamp: number;
	/** SHA-256 checksum (first 16 hex chars) */
	checksum: string;
}

export interface MigrationInput {
	/** Migration name — must be unique per actor, applied in sort order */
	name: string;
	/** SQL content to execute */
	sql: string;
}

export interface MigrationApplyResult {
	ok: boolean;
	applied: string[];
	skipped: string[];
	errors: string[];
}

/** Payload for kysely:migration:generate */
export interface MigrationGeneratePayload {
	actor: string;
	database?: string;
	/** Desired table definitions — pi-kysely diffs against live DB */
	tables: Record<string, TableDef>;
	/** Tables to drop */
	dropTables?: string[];
	/** Columns to drop: { tableName: ["col1", "col2"] } */
	dropColumns?: Record<string, string[]>;
	/** Custom name suffix (default: "schema"). Full name = "0001_<suffix>" */
	migrationName?: string;
	reply?: (result: GeneratedMigration) => void;
	requestId?: string;
	ack?: (ack: unknown) => void;
}

/** Payload for kysely:migration:apply */
export interface MigrationApplyPayload {
	actor: string;
	database?: string;
	migrations: MigrationInput[];
	reply?: (result: MigrationApplyResult) => void;
	requestId?: string;
	ack?: (ack: unknown) => void;
}

/** Payload for kysely:migration:status */
export interface MigrationStatusPayload {
	actor?: string;
	database?: string;
	reply?: (records: MigrationRecord[]) => void;
	requestId?: string;
	ack?: (ack: unknown) => void;
}

// ── Constants ───────────────────────────────────────────────────

const MIGRATION_TABLE = "_kysely_migrations";

// ── Checksum ────────────────────────────────────────────────────

export function computeChecksum(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ── Migration tracking table ────────────────────────────────────

export async function ensureMigrationTable(db: Kysely<any>): Promise<void> {
	const tables = await db.introspection.getTables();
	if (tables.some((t) => t.name === MIGRATION_TABLE)) return;

	await db.schema
		.createTable(MIGRATION_TABLE)
		.addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
		.addColumn("actor", "text", (col) => col.notNull())
		.addColumn("name", "text", (col) => col.notNull())
		.addColumn("checksum", "text", (col) => col.notNull())
		.addColumn("applied_at", "text", (col) => col.notNull())
		.addUniqueConstraint("uq_kysely_mig_actor_name", ["actor", "name"])
		.execute();
}

// ── Generate migration ──────────────────────────────────────────

export async function generateMigration(
	db: Kysely<any>,
	actor: string,
	tables: Record<string, TableDef>,
	options?: {
		dropTables?: string[];
		dropColumns?: Record<string, string[]>;
		migrationName?: string;
	},
): Promise<GeneratedMigration> {
	await ensureMigrationTable(db);
	await seedIndexCacheIfNeeded(db);

	const existingTables = await getExistingTableSet(db);
	const statements: string[] = [];

	// ── Drops ──────────────────────────────────────────────────

	if (options?.dropTables) {
		for (const table of options.dropTables) {
			if (existingTables.has(table)) {
				const { sql: s } = db.schema.dropTable(table).compile();
				statements.push(s);
			}
		}
	}

	if (options?.dropColumns) {
		for (const [table, columns] of Object.entries(options.dropColumns)) {
			if (!existingTables.has(table)) continue;
			const existingCols = await getExistingColumnSet(db, table);
			for (const col of columns) {
				if (existingCols.has(col)) {
					const { sql: s } = db.schema.alterTable(table).dropColumn(col).compile();
					statements.push(s);
				}
			}
		}
	}

	// ── Creates / Alters ───────────────────────────────────────

	const existingIndexes = indexCache;

	for (const [tableName, tableDef] of Object.entries(tables)) {
		if (!existingTables.has(tableName)) {
			// CREATE TABLE
			let builder = db.schema.createTable(tableName);
			for (const [colName, colDef] of Object.entries(tableDef.columns)) {
				builder = builder.addColumn(colName, mapColType(colDef), (col) =>
					applyColumnConstraints(col, colDef),
				);
			}
			if (tableDef.unique) {
				for (const cols of tableDef.unique) {
					builder = builder.addUniqueConstraint(
						`uq_${tableName}_${cols.join("_")}`,
						cols as any,
					);
				}
			}
			const { sql: s } = builder.compile();
			statements.push(s);
		} else {
			// ALTER TABLE — add missing columns
			const existingCols = await getExistingColumnSet(db, tableName);
			for (const [colName, colDef] of Object.entries(tableDef.columns)) {
				if (colDef.primaryKey) continue;
				if (existingCols.has(colName)) continue;
				const { sql: s } = db.schema
					.alterTable(tableName)
					.addColumn(colName, mapColType(colDef), (col) =>
						applyAlterConstraints(col, colDef),
					)
					.compile();
				statements.push(s);
			}
		}

		// CREATE INDEX — missing only
		for (const idx of getIndexList(tableName, tableDef)) {
			if (existingIndexes.has(idx.name)) continue;
			let ib = db.schema.createIndex(idx.name).on(tableName).columns(idx.columns);
			if (idx.unique) ib = ib.unique();
			const { sql: s } = ib.compile();
			statements.push(s);
		}
	}

	// ── No changes ─────────────────────────────────────────────

	if (statements.length === 0) {
		return {
			name: "",
			actor,
			sql: "",
			statements: [],
			timestamp: Date.now(),
			checksum: "",
		};
	}

	// ── Build migration record ─────────────────────────────────

	const seq = await nextSequenceNumber(db, actor);
	const suffix = options?.migrationName ?? "schema";
	const name = `${String(seq).padStart(4, "0")}_${suffix}`;
	const sqlContent = statements.join(";\n") + ";";
	const checksum = computeChecksum(sqlContent);

	// Apply each statement
	for (const stmt of statements) {
		await sql.raw(stmt).execute(db);
	}

	// Record in tracking table
	await db
		.insertInto(MIGRATION_TABLE as any)
		.values({
			actor,
			name,
			checksum,
			applied_at: new Date().toISOString(),
		} as any)
		.execute();

	return {
		name,
		actor,
		sql: sqlContent,
		statements,
		timestamp: Date.now(),
		checksum,
	};
}

// ── Apply migrations ────────────────────────────────────────────

export async function applyMigrations(
	db: Kysely<any>,
	actor: string,
	migrations: MigrationInput[],
): Promise<MigrationApplyResult> {
	await ensureMigrationTable(db);

	const result: MigrationApplyResult = {
		ok: true,
		applied: [],
		skipped: [],
		errors: [],
	};

	// Already-applied
	const rows = (await db
		.selectFrom(MIGRATION_TABLE as any)
		.select(["name", "checksum"])
		.where("actor" as any, "=", actor)
		.execute()) as Array<{ name: string; checksum: string }>;

	const appliedMap = new Map(rows.map((r) => [r.name, r.checksum]));

	// Apply in sorted order
	const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name));

	for (const mig of sorted) {
		const existingChecksum = appliedMap.get(mig.name);
		if (existingChecksum) {
			const cs = computeChecksum(mig.sql);
			if (existingChecksum !== cs) {
				result.errors.push(
					`${mig.name}: checksum mismatch — migration was modified after being applied`,
				);
				result.ok = false;
			}
			result.skipped.push(mig.name);
			continue;
		}

		try {
			// Split on semicolons followed by newline or end-of-string
			const stmts = mig.sql
				.split(/;\s*\n|;\s*$/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0);

			for (const stmt of stmts) {
				await sql.raw(stmt).execute(db);
			}

			await db
				.insertInto(MIGRATION_TABLE as any)
				.values({
					actor,
					name: mig.name,
					checksum: computeChecksum(mig.sql),
					applied_at: new Date().toISOString(),
				} as any)
				.execute();

			result.applied.push(mig.name);
		} catch (err: any) {
			result.ok = false;
			result.errors.push(`${mig.name}: ${err.message}`);
			break; // stop on first error — don't apply out-of-order
		}
	}

	return result;
}

// ── Migration status ────────────────────────────────────────────

export async function getMigrationStatus(
	db: Kysely<any>,
	actor?: string,
): Promise<MigrationRecord[]> {
	await ensureMigrationTable(db);

	let query = db
		.selectFrom(MIGRATION_TABLE as any)
		.select(["id", "actor", "name", "checksum", "applied_at"])
		.orderBy("actor" as any)
		.orderBy("name" as any);

	if (actor) {
		query = query.where("actor" as any, "=", actor);
	}

	return query.execute() as Promise<MigrationRecord[]>;
}

// ── Introspection helpers ───────────────────────────────────────

async function getExistingTableSet(db: Kysely<any>): Promise<Set<string>> {
	const tables = await db.introspection.getTables();
	return new Set(tables.map((t) => t.name));
}

async function getExistingColumnSet(db: Kysely<any>, table: string): Promise<Set<string>> {
	const tables = await db.introspection.getTables();
	const t = tables.find((tbl) => tbl.name === table);
	return new Set(t?.columns.map((c) => c.name) ?? []);
}

// ── Index cache ─────────────────────────────────────────────────

let indexCacheSeeded = false;
const indexCache = new Set<string>();

async function seedIndexCacheIfNeeded(db: Kysely<any>): Promise<void> {
	if (indexCacheSeeded) return;
	try {
		// SQLite
		const rows: any[] = await db
			.selectFrom("sqlite_master" as any)
			.select(["name"])
			.where("type" as any, "=", "index")
			.execute()
			.catch(() => []);
		for (const r of rows) indexCache.add(r.name);
	} catch {
		try {
			// Postgres
			const rows: any[] = await db
				.selectFrom("pg_indexes" as any)
				.select(["indexname"])
				.execute()
				.catch(() => []);
			for (const r of rows) indexCache.add(r.indexname);
		} catch {
			// MySQL or unknown — index creation errors will be caught individually
		}
	}
	indexCacheSeeded = true;
}

// ── DDL helpers ─────────────────────────────────────────────────

function mapColType(colDef: ColumnDef): ColumnDataType {
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

function applyColumnConstraints(col: any, def: ColumnDef): any {
	let c = col;
	if (def.primaryKey) c = c.primaryKey();
	if (def.autoIncrement) c = c.autoIncrement();
	if (def.notNull && !def.primaryKey) c = c.notNull();
	if (def.unique) c = c.unique();
	if (def.default !== undefined && def.default !== null) {
		c = c.defaultTo(def.default);
	}
	if (def.references) {
		const [refTable, refCol] = def.references.split(".");
		c = c.references(`${refTable}.${refCol}`);
		if (def.onDelete) c = c.onDelete(def.onDelete);
	}
	return c;
}

function applyAlterConstraints(col: any, def: ColumnDef): any {
	let c = col;
	if (def.default !== undefined && def.default !== null) {
		c = c.defaultTo(def.default);
		if (def.notNull) c = c.notNull();
	}
	if (def.references) {
		const [refTable, refCol] = def.references.split(".");
		c = c.references(`${refTable}.${refCol}`);
		if (def.onDelete) c = c.onDelete(def.onDelete);
	}
	return c;
}

function getIndexList(
	tableName: string,
	def: TableDef,
): Array<{ name: string; columns: string[]; unique?: boolean }> {
	if (!def.indexes) return [];
	return def.indexes.map((idx) => ({
		name: idx.name ?? `idx_${tableName}_${idx.columns.join("_")}`,
		columns: idx.columns,
		unique: idx.unique,
	}));
}

async function nextSequenceNumber(db: Kysely<any>, actor: string): Promise<number> {
	const rows = (await db
		.selectFrom(MIGRATION_TABLE as any)
		.select(["name"])
		.where("actor" as any, "=", actor)
		.orderBy("name" as any, "desc")
		.limit(1)
		.execute()) as Array<{ name: string }>;

	if (rows.length === 0) return 1;
	const match = rows[0].name.match(/^(\d+)_/);
	return match ? parseInt(match[1], 10) + 1 : 1;
}
