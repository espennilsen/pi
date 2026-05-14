/**
 * pi-a2a — SQLite-backed TaskStore.
 *
 * Implements the @a2a-js/sdk TaskStore interface using better-sqlite3.
 * Tasks are serialized as JSON in a single column for SDK compatibility,
 * with extracted columns for efficient querying and future loop-control
 * metadata (hopCount, visitedAgents).
 *
 * Design:
 *   - DB at {agentDir}/db/a2a.db, WAL mode for concurrent reads
 *   - Migration table: a2a_migrations (version-based)
 *   - Parameterized queries only — no string interpolation
 *   - Sync operations (better-sqlite3 is sync) wrapped in async interface
 *   - Extended columns beyond SDK interface for loop control (td-02cbd2)
 *   - Distributed tracing columns: trace_id, parent_task_id (td-131872)
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { TaskStore, ServerCallContext, PushNotificationStore } from "@a2a-js/sdk/server";
import type { Task, PushNotificationConfig } from "@a2a-js/sdk";
import type { LogFn } from "./logger.ts";
import { randomUUID } from "node:crypto";

// ── Schema version ──────────────────────────────────────────────

const CURRENT_VERSION = 3;

const MIGRATIONS: Record<number, string[]> = {
	1: [
		`CREATE TABLE IF NOT EXISTS a2a_tasks (
			id TEXT PRIMARY KEY NOT NULL,
			context_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'submitted',
			data TEXT NOT NULL,
			hop_count INTEGER,
			visited_agents TEXT,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		)`,
		`CREATE INDEX IF NOT EXISTS idx_a2a_tasks_context_id ON a2a_tasks(context_id)`,
		`CREATE INDEX IF NOT EXISTS idx_a2a_tasks_status ON a2a_tasks(status)`,
		`CREATE INDEX IF NOT EXISTS idx_a2a_tasks_updated_at ON a2a_tasks(updated_at)`,
	],
	2: [
		`CREATE TABLE IF NOT EXISTS a2a_push_configs (
			task_id TEXT NOT NULL,
			config_id TEXT NOT NULL,
			url TEXT NOT NULL,
			token TEXT,
			auth_schemes TEXT,
			auth_credentials TEXT,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			PRIMARY KEY (task_id, config_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_a2a_push_configs_task_id ON a2a_push_configs(task_id)`,
	],
	3: [
		`ALTER TABLE a2a_tasks ADD COLUMN trace_id TEXT`,
		`ALTER TABLE a2a_tasks ADD COLUMN parent_task_id TEXT`,
		`CREATE INDEX IF NOT EXISTS idx_a2a_tasks_trace_id ON a2a_tasks(trace_id)`,
		`CREATE INDEX IF NOT EXISTS idx_a2a_tasks_parent_task_id ON a2a_tasks(parent_task_id)`,
	],
};

// ── SQLiteTaskStore ─────────────────────────────────────────────

export class SQLiteTaskStore implements TaskStore {
	private db: DatabaseType;
	private log: LogFn;

	// Prepared statements (initialized after migrations)
	private stmtUpsert!: Statement;
	private stmtLoad!: Statement;

	constructor(dbPath: string, log: LogFn) {
		this.log = log;

		// Ensure parent directory exists
		mkdirSync(dirname(dbPath), { recursive: true });

		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("foreign_keys = ON");
		this.db.pragma("busy_timeout = 5000");

		this.runMigrations();
		this.prepareStatements();

		log("task_store_init", { dbPath, version: CURRENT_VERSION });
	}

	// ── TaskStore interface ───────────────────────────────────

	async save(task: Task, _context?: ServerCallContext): Promise<void> {
		const data = JSON.stringify(task);
		const status = task.status?.state ?? "submitted";

		// Extract loop-control metadata for indexed querying (td-02cbd2, td-131872)
		const metadata = task.metadata as Record<string, unknown> | undefined;
		const hopCount = typeof metadata?.["pi:hopCount"] === "number"
			? metadata["pi:hopCount"] as number
			: null;
		const visitedAgents = Array.isArray(metadata?.["pi:visitedAgents"])
			? JSON.stringify(metadata["pi:visitedAgents"])
			: null;
		const traceId = typeof metadata?.["pi:traceId"] === "string"
			? metadata["pi:traceId"] as string
			: null;
		const parentTaskId = typeof metadata?.["pi:parentTaskId"] === "string"
			? metadata["pi:parentTaskId"] as string
			: null;

		const now = new Date().toISOString();

		// Atomic UPSERT — single statement, no race window
		this.stmtUpsert.run(task.id, task.contextId, status, data, hopCount, visitedAgents, traceId, parentTaskId, now, now);

		this.log("task_store_save", { taskId: task.id, status });
	}

	async load(taskId: string, _context?: ServerCallContext): Promise<Task | undefined> {
		const row = this.stmtLoad.get(taskId) as { data: string } | undefined;
		if (!row) return undefined;

		try {
			return JSON.parse(row.data) as Task;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.log("task_store_load_error", { taskId, error: msg }, "ERROR");
			return undefined;
		}
	}

	// ── Extended methods (beyond SDK interface) ───────────────

	/**
	 * List tasks, optionally filtered by status. Ordered by updated_at desc.
	 * Not part of the SDK TaskStore interface but useful for admin/debug.
	 */
	listTasks(opts?: { status?: string; limit?: number; offset?: number }): Task[] {
		const limit = opts?.limit ?? 50;
		const offset = opts?.offset ?? 0;

		let sql: string;
		let params: unknown[];

		if (opts?.status) {
			sql = `SELECT data FROM a2a_tasks WHERE status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
			params = [opts.status, limit, offset];
		} else {
			sql = `SELECT data FROM a2a_tasks ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
			params = [limit, offset];
		}

		const rows = this.db.prepare(sql).all(...params) as Array<{ data: string }>;
		const tasks: Task[] = [];
		for (const row of rows) {
			try {
				tasks.push(JSON.parse(row.data) as Task);
			} catch {
				// Skip corrupt rows
			}
		}
		return tasks;
	}

	/**
	 * Count tasks, optionally filtered by status.
	 */
	countTasks(status?: string): number {
		if (status) {
			const row = this.db.prepare(
				`SELECT COUNT(*) as cnt FROM a2a_tasks WHERE status = ?`,
			).get(status) as { cnt: number };
			return row.cnt;
		}
		const row = this.db.prepare(
			`SELECT COUNT(*) as cnt FROM a2a_tasks`,
		).get() as { cnt: number };
		return row.cnt;
	}

	/**
	 * Delete tasks older than the given age in milliseconds.
	 * Returns the number of deleted rows.
	 */
	pruneOlderThan(maxAgeMs: number): number {
		const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
		const result = this.db.prepare(
			`DELETE FROM a2a_tasks WHERE updated_at < ?`,
		).run(cutoff);
		if (result.changes > 0) {
			this.log("task_store_prune", { deleted: result.changes, cutoff });
		}
		return result.changes;
	}

	/**
	 * Get the underlying Database instance for sharing with other stores.
	 */
	getDb(): DatabaseType {
		return this.db;
	}

	/**
	 * Close the database connection. Call on shutdown.
	 */
	close(): void {
		try {
			this.db.close();
			this.log("task_store_closed");
		} catch {
			// Ignore close errors
		}
	}

	// ── Migrations ────────────────────────────────────────────

	private runMigrations(): void {
		// Create migration tracking table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS a2a_migrations (
				version INTEGER PRIMARY KEY NOT NULL,
				applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
			)
		`);

		const currentVersion = (
			this.db.prepare(`SELECT MAX(version) as v FROM a2a_migrations`).get() as { v: number | null }
		).v ?? 0;

		if (currentVersion >= CURRENT_VERSION) return;

		const migrate = this.db.transaction(() => {
			for (let v = currentVersion + 1; v <= CURRENT_VERSION; v++) {
				const stmts = MIGRATIONS[v];
				if (!stmts) {
					throw new Error(`Missing migration for version ${v}`);
				}
				for (const sql of stmts) {
					this.db.exec(sql);
				}
				this.db.prepare(
					`INSERT INTO a2a_migrations (version) VALUES (?)`,
				).run(v);
				this.log("task_store_migration", { version: v });
			}
		});

		migrate();
	}

	// ── Prepared Statements ───────────────────────────────────

	private prepareStatements(): void {
		this.stmtUpsert = this.db.prepare(
			`INSERT INTO a2a_tasks (id, context_id, status, data, hop_count, visited_agents, trace_id, parent_task_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   context_id = excluded.context_id,
			   status = excluded.status,
			   data = excluded.data,
			   hop_count = excluded.hop_count,
			   visited_agents = excluded.visited_agents,
			   trace_id = excluded.trace_id,
			   parent_task_id = excluded.parent_task_id,
			   updated_at = excluded.updated_at`,
		);

		this.stmtLoad = this.db.prepare(
			`SELECT data FROM a2a_tasks WHERE id = ?`,
		);
	}
}

// ── SQLitePushNotificationStore ─────────────────────────────

export class SQLitePushNotificationStore implements PushNotificationStore {
	private db: DatabaseType;
	private log: LogFn;

	// Prepared statements
	private stmtSave!: Statement;
	private stmtLoad!: Statement;
	private stmtDelete!: Statement;
	private stmtDeleteAll!: Statement;

	constructor(db: DatabaseType, log: LogFn) {
		this.db = db;
		this.log = log;
		this.prepareStatements();
	}

	async save(taskId: string, pushNotificationConfig: PushNotificationConfig): Promise<void> {
		const configId = pushNotificationConfig.id ?? randomUUID();
		const authSchemes = pushNotificationConfig.authentication?.schemes
			? JSON.stringify(pushNotificationConfig.authentication.schemes)
			: null;
		const authCredentials = pushNotificationConfig.authentication?.credentials ?? null;

		this.stmtSave.run(
			taskId,
			configId,
			pushNotificationConfig.url,
			pushNotificationConfig.token ?? null,
			authSchemes,
			authCredentials,
		);

		this.log("push_config_save", { taskId, configId });
	}

	async load(taskId: string): Promise<PushNotificationConfig[]> {
		const rows = this.stmtLoad.all(taskId) as Array<{
			config_id: string;
			url: string;
			token: string | null;
			auth_schemes: string | null;
			auth_credentials: string | null;
		}>;

		const configs: PushNotificationConfig[] = [];
		for (const row of rows) {
			const config: PushNotificationConfig = {
				id: row.config_id,
				url: row.url,
			};
			if (row.token) config.token = row.token;
			if (row.auth_schemes) {
				try {
					const schemes = JSON.parse(row.auth_schemes) as string[];
					config.authentication = { schemes };
					if (row.auth_credentials) {
						config.authentication.credentials = row.auth_credentials;
					}
				} catch {
					// Skip invalid auth data
				}
			}
			configs.push(config);
		}

		return configs;
	}

	async delete(taskId: string, configId?: string): Promise<void> {
		if (configId) {
			this.stmtDelete.run(taskId, configId);
			this.log("push_config_delete", { taskId, configId });
		} else {
			this.stmtDeleteAll.run(taskId);
			this.log("push_config_delete_all", { taskId });
		}
	}

	/**
	 * Delete push notification configs whose task no longer exists in a2a_tasks.
	 * Call after taskStore.pruneOlderThan() to clean up orphaned rows.
	 */
	pruneOrphaned(): number {
		const result = this.db.prepare(
			`DELETE FROM a2a_push_configs
			 WHERE task_id NOT IN (SELECT id FROM a2a_tasks)`,
		).run();

		if (result.changes > 0) {
			this.log("push_config_prune_orphaned", { deleted: result.changes });
		}
		return result.changes;
	}

	/**
	 * No-op close — we share the DB instance with SQLiteTaskStore.
	 */
	close(): void {
		// No-op
	}

	private prepareStatements(): void {
		this.stmtSave = this.db.prepare(
			`INSERT INTO a2a_push_configs (task_id, config_id, url, token, auth_schemes, auth_credentials)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(task_id, config_id) DO UPDATE SET
			   url = excluded.url,
			   token = excluded.token,
			   auth_schemes = excluded.auth_schemes,
			   auth_credentials = excluded.auth_credentials`,
		);

		this.stmtLoad = this.db.prepare(
			`SELECT config_id, url, token, auth_schemes, auth_credentials
			 FROM a2a_push_configs
			 WHERE task_id = ?`,
		);

		this.stmtDelete = this.db.prepare(
			`DELETE FROM a2a_push_configs WHERE task_id = ? AND config_id = ?`,
		);

		this.stmtDeleteAll = this.db.prepare(
			`DELETE FROM a2a_push_configs WHERE task_id = ?`,
		);
	}
}
