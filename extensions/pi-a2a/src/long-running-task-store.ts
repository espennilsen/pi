/**
 * pi-a2a — Long-running task state persistence.
 *
 * Stores A2A task state in SQLite to survive Pi restarts.
 * Tasks can run for hours/days without timeouts.
 */

import Database from 'better-sqlite3';
import type { LogFn } from './logger.ts';

export interface LongRunningTask {
	taskId: string;
	contextId: string;
	sessionId: string;
	state: 'submitted' | 'working' | 'completed' | 'failed' | 'input-required';
	createdAt: number;
	lastUpdatedAt: number;
	response?: string;
	error?: string;
	metadata?: Record<string, unknown>;
}

export interface ResumeRequest {
	taskId: string;
	contextId: string;
	priority: 'normal' | 'high';
	enqueuedAt: number;
	retryCount: number;
}

export class LongRunningTaskStore {
	private db: Database.Database;
	private log: LogFn;

	constructor(dbPath: string, log: LogFn) {
		this.log = log;
		this.db = new Database(dbPath);
		this.db.pragma('journal_mode = WAL');
		this.initSchema();
	}

	private initSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS long_running_tasks (
				task_id TEXT PRIMARY KEY,
				context_id TEXT NOT NULL,
				session_id TEXT NOT NULL,
				state TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				last_updated_at INTEGER NOT NULL,
				response TEXT,
				error TEXT,
				metadata TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_long_running_tasks_state 
			ON long_running_tasks(state);

			CREATE INDEX IF NOT EXISTS idx_long_running_tasks_session 
			ON long_running_tasks(session_id);

			CREATE TABLE IF NOT EXISTS resume_queue (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				task_id TEXT NOT NULL UNIQUE,
				context_id TEXT NOT NULL,
				priority TEXT NOT NULL DEFAULT 'normal',
				enqueued_at INTEGER NOT NULL,
				retry_count INTEGER NOT NULL DEFAULT 0
			);

			CREATE INDEX IF NOT EXISTS idx_resume_queue_priority 
			ON resume_queue(priority, enqueued_at);
		`);
	}

	/** Save or update a long-running task. */
	save(task: LongRunningTask): void {
		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO long_running_tasks 
			(task_id, context_id, session_id, state, created_at, last_updated_at, response, error, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		stmt.run(
			task.taskId,
			task.contextId,
			task.sessionId,
			task.state,
			task.createdAt,
			task.lastUpdatedAt,
			task.response ?? null,
			task.error ?? null,
			task.metadata ? JSON.stringify(task.metadata) : null,
		);
		this.log('long_running_task_saved', { taskId: task.taskId, state: task.state });
	}

	/** Load a task by ID. */
	load(taskId: string): LongRunningTask | null {
		const stmt = this.db.prepare('SELECT * FROM long_running_tasks WHERE task_id = ?');
		const row = stmt.get(taskId) as any;
		if (!row) return null;
		return {
			taskId: row.task_id,
			contextId: row.context_id,
			sessionId: row.session_id,
			state: row.state,
			createdAt: row.created_at,
			lastUpdatedAt: row.last_updated_at,
			response: row.response,
			error: row.error,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		};
	}

	/** Get all tasks in a specific state. */
	getByState(state: LongRunningTask['state']): LongRunningTask[] {
		const stmt = this.db.prepare('SELECT * FROM long_running_tasks WHERE state = ?');
		const rows = stmt.all(state) as any[];
		return rows.map((row) => ({
			taskId: row.task_id,
			contextId: row.context_id,
			sessionId: row.session_id,
			state: row.state,
			createdAt: row.created_at,
			lastUpdatedAt: row.last_updated_at,
			response: row.response,
			error: row.error,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}));
	}

	/** Get all pending tasks (not completed/failed). */
	getPendingTasks(): LongRunningTask[] {
		const stmt = this.db.prepare(
			"SELECT * FROM long_running_tasks WHERE state NOT IN ('completed', 'failed')",
		);
		const rows = stmt.all() as any[];
		return rows.map((row) => ({
			taskId: row.task_id,
			contextId: row.context_id,
			sessionId: row.session_id,
			state: row.state,
			createdAt: row.created_at,
			lastUpdatedAt: row.last_updated_at,
			response: row.response,
			error: row.error,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}));
	}

	/** Delete a task by ID. */
	delete(taskId: string): void {
		const stmt = this.db.prepare('DELETE FROM long_running_tasks WHERE task_id = ?');
		stmt.run(taskId);
		this.log('long_running_task_deleted', { taskId });
	}

	/** Prune tasks older than maxAgeMs. */
	pruneOlderThan(maxAgeMs: number): number {
		const cutoff = Date.now() - maxAgeMs;
		const stmt = this.db.prepare(
			'DELETE FROM long_running_tasks WHERE created_at < ?',
		);
		const result = stmt.run(cutoff);
		this.log('long_running_tasks_pruned', { pruned: result.changes, maxAgeMs });
		return result.changes;
	}

	// ── Resume Queue Operations ─────────────────────────────────

	/** Add a resume request to the queue. */
 enqueueResume(request: ResumeRequest): void {
		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO resume_queue 
			(task_id, context_id, priority, enqueued_at, retry_count)
			VALUES (?, ?, ?, ?, ?)
		`);
		stmt.run(request.taskId, request.contextId, request.priority, request.enqueuedAt, request.retryCount);
		this.log('resume_request_enqueued', { taskId: request.taskId, priority: request.priority });
	}

	/** Get the next resume request (high priority first, then oldest). */
	dequeueResume(): ResumeRequest | null {
		const stmt = this.db.prepare(`
			SELECT * FROM resume_queue 
			ORDER BY 
				CASE WHEN priority = 'high' THEN 0 ELSE 1 END,
				enqueued_at ASC
			LIMIT 1
		`);
		const row = stmt.get() as any;
		if (!row) return null;
		
		// Remove from queue
		const deleteStmt = this.db.prepare('DELETE FROM resume_queue WHERE id = ?');
		deleteStmt.run(row.id);
		
		return {
			taskId: row.task_id,
			contextId: row.context_id,
			priority: row.priority as 'normal' | 'high',
			enqueuedAt: row.enqueued_at,
			retryCount: row.retry_count,
		};
	}

	/** Get queue length. */
	getQueueLength(): number {
		const stmt = this.db.prepare('SELECT COUNT(*) as count FROM resume_queue');
		const result = stmt.get() as { count: number };
		return result.count;
	}

	/** Close the database connection. */
	close(): void {
		this.db.close();
	}

	/** Get the underlying database instance (for sharing with other stores). */
	getDb(): Database.Database {
		return this.db;
	}
}
