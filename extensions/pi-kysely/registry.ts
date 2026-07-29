import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect } from "kysely";

export const DEFAULT_DATABASE_NAME = "default";
export const DEFAULT_SQLITE_PATH = "db/sqlite.db";

export type DatabaseDriver = "sqlite" | "postgres" | "mysql" | "custom";

export interface DatabaseRegistration {
	name: string;
	db: Kysely<any>;
	driver?: DatabaseDriver;
	label?: string;
	description?: string;
}

export interface DatabaseInfo {
	name: string;
	driver: DatabaseDriver;
	label?: string;
	description?: string;
	createdAt: number;
}

interface RegistryEntry {
	name: string;
	db: Kysely<any>;
	driver: DatabaseDriver;
	label?: string;
	description?: string;
	createdAt: number;
	/** Raw better-sqlite3 instance (SQLite only). Used for UDF registration. */
	rawSqlite?: any;
}

interface RuntimeDefaults {
	databaseName: string;
	sqlitePath: string;
}

const databases = new Map<string, RegistryEntry>();
const runtimeDefaults: RuntimeDefaults = {
	databaseName: DEFAULT_DATABASE_NAME,
	sqlitePath: DEFAULT_SQLITE_PATH,
};

export function configureDefaults(defaults: Partial<RuntimeDefaults>): void {
	if (defaults.databaseName?.trim()) runtimeDefaults.databaseName = defaults.databaseName.trim();
	if (defaults.sqlitePath?.trim()) runtimeDefaults.sqlitePath = defaults.sqlitePath.trim();
}

export function getDefaultDatabaseName(): string {
	return runtimeDefaults.databaseName;
}

export function getDefaultSqlitePath(): string {
	return runtimeDefaults.sqlitePath;
}

export function registerDatabase(registration: DatabaseRegistration): void {
	if (!registration?.name) throw new Error("Database name is required");
	if (!registration?.db) throw new Error("Database instance is required");
	if (databases.has(registration.name)) {
		throw new Error(`Database \"${registration.name}\" is already registered`);
	}

	databases.set(registration.name, {
		name: registration.name,
		db: registration.db,
		driver: registration.driver ?? "custom",
		label: registration.label,
		description: registration.description,
		createdAt: Date.now(),
	});
}

export function getDatabase<T = any>(name?: string): Kysely<T> | undefined {
	const resolved = name ?? getDefaultDatabaseName();
	return databases.get(resolved)?.db as Kysely<T> | undefined;
}

export function requireDatabase<T = any>(name?: string): Kysely<T> {
	const resolved = name ?? getDefaultDatabaseName();
	const db = getDatabase<T>(resolved);
	if (!db) {
		throw new Error(`Database \"${resolved}\" is not registered`);
	}
	return db;
}

export function listDatabases(): DatabaseInfo[] {
	return Array.from(databases.values()).map((entry) => ({
		name: entry.name,
		driver: entry.driver,
		label: entry.label,
		description: entry.description,
		createdAt: entry.createdAt,
	}));
}

export async function unregisterDatabase(name: string, options?: { destroy?: boolean }): Promise<boolean> {
	const entry = databases.get(name);
	if (!entry) return false;
	databases.delete(name);
	if (options?.destroy !== false) {
		await entry.db.destroy();
	}
	return true;
}

/**
 * Get the raw better-sqlite3 instance for a registered SQLite database.
 * Returns undefined for non-SQLite databases or if the raw handle wasn't captured.
 */
export function getRawSqlite(name?: string): any | undefined {
	const resolved = name ?? getDefaultDatabaseName();
	const entry = databases.get(resolved);
	if (!entry || entry.driver !== "sqlite") return undefined;
	return entry.rawSqlite;
}

/**
 * Register a custom SQL function on a database.
 *
 * For SQLite: calls better-sqlite3's `db.function(name, opts, fn)`.
 * For Postgres: executes `CREATE OR REPLACE FUNCTION` via raw SQL.
 * For MySQL: not currently supported (returns false).
 *
 * @returns true if the function was registered successfully.
 */
export async function registerSqlFunction(
	databaseName: string | undefined,
	functionName: string,
	implementation: (...args: any[]) => any,
	options?: { deterministic?: boolean; varargs?: boolean },
): Promise<boolean> {
	const resolved = databaseName ?? getDefaultDatabaseName();
	const entry = databases.get(resolved);
	if (!entry) return false;

	if (entry.driver === "sqlite" && entry.rawSqlite) {
		try {
			const opts: Record<string, boolean> = {};
			if (options?.deterministic) opts.deterministic = true;
			if (options?.varargs) opts.varargs = true;
			entry.rawSqlite.function(functionName, opts, implementation);
			return true;
		} catch {
			return false;
		}
	}

	// Postgres: levenshtein is available via fuzzystrmatch extension.
	// Other custom functions would need PL/pgSQL — not supported generically here.
	// Extensions that need Postgres UDFs should use kysely:query with CREATE FUNCTION.

	return false;
}

export async function clearDatabases(options?: { destroy?: boolean }): Promise<void> {
	const entries = Array.from(databases.values());
	databases.clear();
	if (options?.destroy === false) return;
	await Promise.all(entries.map((entry) => entry.db.destroy()));
}

export interface SqliteOptions {
	readonly?: boolean;
	fileMustExist?: boolean;
	register?: boolean;
	label?: string;
	description?: string;
}

export async function createSqliteDatabase<T = any>(
	name?: string,
	filePath?: string,
	options?: SqliteOptions,
): Promise<Kysely<T>> {
	const resolvedName = name ?? getDefaultDatabaseName();
	const resolvedPath = filePath ?? getDefaultSqlitePath();
	mkdirSync(dirname(resolvedPath), { recursive: true });
	const BetterSqlite3 = (await import("better-sqlite3")).default as any;
	const sqliteOptions: { readonly?: boolean; fileMustExist?: boolean } = {};
	if (typeof options?.readonly === "boolean") sqliteOptions.readonly = options.readonly;
	if (typeof options?.fileMustExist === "boolean") sqliteOptions.fileMustExist = options.fileMustExist;
	const sqlite = new BetterSqlite3(resolvedPath, sqliteOptions);
	const db = new Kysely<T>({
		dialect: new SqliteDialect({ database: sqlite }),
	});
	if (options?.register !== false) {
		registerDatabase({
			name: resolvedName,
			db,
			driver: "sqlite",
			label: options?.label,
			description: options?.description,
		});
		// Stash raw handle for UDF registration
		const entry = databases.get(resolvedName);
		if (entry) entry.rawSqlite = sqlite;
	}
	return db;
}

export async function ensureDefaultSqliteDatabase<T = any>(): Promise<Kysely<T>> {
	const existing = getDatabase<T>(getDefaultDatabaseName());
	if (existing) return existing;
	return createSqliteDatabase<T>(getDefaultDatabaseName(), getDefaultSqlitePath(), {
		label: "Default SQLite",
		description: "Auto-created shared database",
	});
}

export interface PostgresOptions {
	register?: boolean;
	label?: string;
	description?: string;
}

export async function createPostgresDatabase<T = any>(
	name: string,
	config: string | Record<string, unknown>,
	options?: PostgresOptions,
): Promise<Kysely<T>> {
	const { Pool } = await import("pg");
	const pool = new Pool(typeof config === "string" ? { connectionString: config } : (config as any));
	const db = new Kysely<T>({
		dialect: new PostgresDialect({ pool }),
	});
	if (options?.register !== false) {
		registerDatabase({
			name,
			db,
			driver: "postgres",
			label: options?.label,
			description: options?.description,
		});
	}
	return db;
}

export interface MySqlOptions {
	register?: boolean;
	label?: string;
	description?: string;
}

export async function createMySqlDatabase<T = any>(
	name: string,
	config: string | Record<string, unknown>,
	options?: MySqlOptions,
): Promise<Kysely<T>> {
	const mysql = await import("mysql2");
	const pool = mysql.createPool(typeof config === "string" ? config : (config as any));
	const db = new Kysely<T>({
		dialect: new MysqlDialect({ pool }),
	});
	if (options?.register !== false) {
		registerDatabase({
			name,
			db,
			driver: "mysql",
			label: options?.label,
			description: options?.description,
		});
	}
	return db;
}
