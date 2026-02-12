/**
 * pi-jobs — SQLite database for job tracking.
 *
 * Self-contained: owns the schema (jobs, tool_calls, daily_stats),
 * prepared statements, and all CRUD operations.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

// ── Types ───────────────────────────────────────────────────────

export interface JobRecord {
	id: string;
	channel: string;
	status: string;
	prompt: string;
	response: string | null;
	model: string | null;
	provider: string | null;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_write_tokens: number;
	total_tokens: number;
	cost_input: number;
	cost_output: number;
	cost_cache_read: number;
	cost_cache_write: number;
	cost_total: number;
	tool_call_count: number;
	turn_count: number;
	error_message: string | null;
	duration_ms: number | null;
	created_at: string;
	finished_at: string | null;
}

export interface ToolCallRecord {
	id: number;
	job_id: string;
	tool_name: string;
	args_json: string | null;
	result_preview: string | null;
	is_error: number;
	duration_ms: number | null;
	created_at: string;
}

export interface DailyStatRow {
	date: string;
	channel: string;
	model: string;
	job_count: number;
	error_count: number;
	total_tokens: number;
	cost_total: number;
	avg_duration_ms: number;
	tool_call_count: number;
}

export interface ModelBreakdownRow {
	provider: string;
	model: string;
	job_count: number;
	total_tokens: number;
	cost_total: number;
	avg_duration_ms: number;
}

export interface ToolBreakdownRow {
	tool_name: string;
	call_count: number;
	error_count: number;
	avg_duration_ms: number;
}

export interface JobTotals {
	jobs: number;
	errors: number;
	tokens: number;
	cost: number;
	toolCalls: number;
	avgDurationMs: number;
}

export interface JobsApi {
	createJob(opts: {
		channel: string;
		prompt: string;
		model?: string;
		provider?: string;
	}): string;
	markJobRunning(jobId: string): void;
	completeJob(jobId: string, result: {
		response: string;
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalTokens?: number;
		costInput?: number;
		costOutput?: number;
		costCacheRead?: number;
		costCacheWrite?: number;
		costTotal?: number;
		toolCallCount?: number;
		turnCount?: number;
		durationMs?: number;
	}): void;
	failJob(jobId: string, errorMessage: string, durationMs?: number): void;
	recordToolCall(opts: {
		jobId: string;
		toolName: string;
		argsJson?: string;
		resultPreview?: string;
		isError?: boolean;
		durationMs?: number;
	}): void;
	getJob(jobId: string): JobRecord | undefined;
	getRecentJobs(limit?: number, channel?: string): JobRecord[];
	getJobToolCalls(jobId: string): ToolCallRecord[];
	getTotals(channel?: string): JobTotals;
	getDailyStats(days?: number, channel?: string): DailyStatRow[];
	getModelBreakdown(days?: number): ModelBreakdownRow[];
	getToolBreakdown(days?: number): ToolBreakdownRow[];
}

// ── Singleton state ─────────────────────────────────────────────

let db: Database.Database | null = null;
let api: JobsApi | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
	id              TEXT PRIMARY KEY,
	channel         TEXT NOT NULL DEFAULT 'tui',
	status          TEXT NOT NULL DEFAULT 'pending'
	                CHECK(status IN ('pending','running','done','error')),
	prompt          TEXT NOT NULL,
	response        TEXT,
	model           TEXT,
	provider        TEXT,
	input_tokens      INTEGER NOT NULL DEFAULT 0,
	output_tokens     INTEGER NOT NULL DEFAULT 0,
	cache_read_tokens INTEGER NOT NULL DEFAULT 0,
	cache_write_tokens INTEGER NOT NULL DEFAULT 0,
	total_tokens      INTEGER NOT NULL DEFAULT 0,
	cost_input       REAL NOT NULL DEFAULT 0,
	cost_output      REAL NOT NULL DEFAULT 0,
	cost_cache_read  REAL NOT NULL DEFAULT 0,
	cost_cache_write REAL NOT NULL DEFAULT 0,
	cost_total       REAL NOT NULL DEFAULT 0,
	tool_call_count  INTEGER NOT NULL DEFAULT 0,
	turn_count       INTEGER NOT NULL DEFAULT 0,
	error_message    TEXT,
	duration_ms      INTEGER,
	created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	finished_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_channel    ON jobs(channel);
CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_model      ON jobs(model);

CREATE TABLE IF NOT EXISTS tool_calls (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
	tool_name     TEXT NOT NULL,
	args_json     TEXT,
	result_preview TEXT,
	is_error      INTEGER NOT NULL DEFAULT 0,
	duration_ms   INTEGER,
	created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_job  ON tool_calls(job_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

CREATE TABLE IF NOT EXISTS daily_stats (
	date          TEXT NOT NULL,
	channel       TEXT NOT NULL,
	model         TEXT NOT NULL DEFAULT '',
	job_count     INTEGER NOT NULL DEFAULT 0,
	error_count   INTEGER NOT NULL DEFAULT 0,
	total_tokens  INTEGER NOT NULL DEFAULT 0,
	cost_total    REAL NOT NULL DEFAULT 0,
	total_duration_ms INTEGER NOT NULL DEFAULT 0,
	tool_call_count INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (date, channel, model)
);
`;

export function initDb(dbPath: string): void {
	if (db) return;
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	db.exec(SCHEMA_SQL);
	buildApi(db);
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
		api = null;
	}
}

export function isDbReady(): boolean {
	return api !== null;
}

export function getJobsApi(): JobsApi {
	if (!api) throw new Error("pi-jobs: DB not initialized. Call initDb() first.");
	return api;
}

// ── Build API with prepared statements ──────────────────────────

function buildApi(db: Database.Database): void {
	const stmts = {
		insertJob: db.prepare(
			`INSERT INTO jobs (id, channel, status, prompt, model, provider)
			 VALUES (?, ?, 'pending', ?, ?, ?)`,
		),
		markRunning: db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?"),
		complete: db.prepare(
			`UPDATE jobs SET
				status = 'done', response = ?,
				input_tokens = ?, output_tokens = ?,
				cache_read_tokens = ?, cache_write_tokens = ?,
				total_tokens = ?,
				cost_input = ?, cost_output = ?,
				cost_cache_read = ?, cost_cache_write = ?,
				cost_total = ?,
				tool_call_count = ?, turn_count = ?,
				duration_ms = ?,
				finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			 WHERE id = ?`,
		),
		fail: db.prepare(
			`UPDATE jobs SET
				status = 'error', error_message = ?, duration_ms = ?,
				finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			 WHERE id = ?`,
		),
		getJob: db.prepare("SELECT * FROM jobs WHERE id = ?"),
		recentAll: db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?"),
		recentCh: db.prepare("SELECT * FROM jobs WHERE channel = ? ORDER BY created_at DESC LIMIT ?"),
		insertToolCall: db.prepare(
			`INSERT INTO tool_calls (job_id, tool_name, args_json, result_preview, is_error, duration_ms)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		),
		toolCallsForJob: db.prepare("SELECT * FROM tool_calls WHERE job_id = ? ORDER BY created_at ASC"),
		upsertDaily: db.prepare(
			`INSERT INTO daily_stats (date, channel, model, job_count, error_count, total_tokens, cost_total, total_duration_ms, tool_call_count)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(date, channel, model) DO UPDATE SET
				job_count         = job_count + excluded.job_count,
				error_count       = error_count + excluded.error_count,
				total_tokens      = total_tokens + excluded.total_tokens,
				cost_total        = cost_total + excluded.cost_total,
				total_duration_ms = total_duration_ms + excluded.total_duration_ms,
				tool_call_count   = tool_call_count + excluded.tool_call_count`,
		),
		totalsAll: db.prepare(
			`SELECT COUNT(*) as jobs,
				SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors,
				COALESCE(SUM(total_tokens),0) as tokens,
				COALESCE(SUM(cost_total),0) as cost,
				COALESCE(SUM(tool_call_count),0) as toolCalls,
				COALESCE(AVG(duration_ms),0) as avgDurationMs
			 FROM jobs`,
		),
		totalsCh: db.prepare(
			`SELECT COUNT(*) as jobs,
				SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors,
				COALESCE(SUM(total_tokens),0) as tokens,
				COALESCE(SUM(cost_total),0) as cost,
				COALESCE(SUM(tool_call_count),0) as toolCalls,
				COALESCE(AVG(duration_ms),0) as avgDurationMs
			 FROM jobs WHERE channel = ?`,
		),
		dailyAll: db.prepare(
			`SELECT date, channel, model, job_count, error_count, total_tokens, cost_total,
				CASE WHEN job_count > 0 THEN total_duration_ms / job_count ELSE 0 END as avg_duration_ms,
				tool_call_count
			 FROM daily_stats WHERE date >= date('now', ?) ORDER BY date DESC`,
		),
		dailyCh: db.prepare(
			`SELECT date, channel, model, job_count, error_count, total_tokens, cost_total,
				CASE WHEN job_count > 0 THEN total_duration_ms / job_count ELSE 0 END as avg_duration_ms,
				tool_call_count
			 FROM daily_stats WHERE channel = ? AND date >= date('now', ?) ORDER BY date DESC`,
		),
		modelBreakdown: db.prepare(
			`SELECT provider, model, COUNT(*) as job_count,
				SUM(total_tokens) as total_tokens, SUM(cost_total) as cost_total,
				AVG(duration_ms) as avg_duration_ms
			 FROM jobs WHERE created_at >= datetime('now', ?)
			 GROUP BY provider, model ORDER BY cost_total DESC`,
		),
		toolBreakdown: db.prepare(
			`SELECT tool_name, COUNT(*) as call_count,
				SUM(CASE WHEN is_error THEN 1 ELSE 0 END) as error_count,
				AVG(duration_ms) as avg_duration_ms
			 FROM tool_calls WHERE created_at >= datetime('now', ?)
			 GROUP BY tool_name ORDER BY call_count DESC`,
		),
	};

	function updateDaily(job: JobRecord, isError: boolean): void {
		const date = job.created_at.slice(0, 10);
		stmts.upsertDaily.run(
			date, job.channel, job.model ?? "",
			1, isError ? 1 : 0,
			isError ? 0 : job.total_tokens,
			isError ? 0 : job.cost_total,
			isError ? 0 : (job.duration_ms ?? 0),
			isError ? 0 : job.tool_call_count,
		);
	}

	api = {
		createJob(opts) {
			const id = crypto.randomUUID();
			stmts.insertJob.run(id, opts.channel, opts.prompt, opts.model ?? null, opts.provider ?? null);
			return id;
		},

		markJobRunning(jobId) {
			stmts.markRunning.run(jobId);
		},

		completeJob(jobId, r) {
			stmts.complete.run(
				r.response, r.inputTokens ?? 0, r.outputTokens ?? 0,
				r.cacheReadTokens ?? 0, r.cacheWriteTokens ?? 0, r.totalTokens ?? 0,
				r.costInput ?? 0, r.costOutput ?? 0, r.costCacheRead ?? 0, r.costCacheWrite ?? 0, r.costTotal ?? 0,
				r.toolCallCount ?? 0, r.turnCount ?? 0, r.durationMs ?? null,
				jobId,
			);
			const job = stmts.getJob.get(jobId) as JobRecord | undefined;
			if (job) updateDaily(job, false);
		},

		failJob(jobId, errorMessage, durationMs) {
			stmts.fail.run(errorMessage, durationMs ?? null, jobId);
			const job = stmts.getJob.get(jobId) as JobRecord | undefined;
			if (job) updateDaily(job, true);
		},

		recordToolCall(opts) {
			stmts.insertToolCall.run(
				opts.jobId, opts.toolName, opts.argsJson ?? null,
				opts.resultPreview ?? null, opts.isError ? 1 : 0, opts.durationMs ?? null,
			);
		},

		getJob(jobId) {
			return stmts.getJob.get(jobId) as JobRecord | undefined;
		},

		getRecentJobs(limit = 20, channel?) {
			return channel
				? stmts.recentCh.all(channel, limit) as JobRecord[]
				: stmts.recentAll.all(limit) as JobRecord[];
		},

		getJobToolCalls(jobId) {
			return stmts.toolCallsForJob.all(jobId) as ToolCallRecord[];
		},

		getTotals(channel?) {
			const row = (channel ? stmts.totalsCh.get(channel) : stmts.totalsAll.get()) as any;
			return {
				jobs: row.jobs, errors: row.errors, tokens: row.tokens,
				cost: row.cost, toolCalls: row.toolCalls,
				avgDurationMs: Math.round(row.avgDurationMs),
			};
		},

		getDailyStats(days = 30, channel?) {
			return channel
				? stmts.dailyCh.all(channel, `-${days} days`) as DailyStatRow[]
				: stmts.dailyAll.all(`-${days} days`) as DailyStatRow[];
		},

		getModelBreakdown(days = 30) {
			return stmts.modelBreakdown.all(`-${days} days`) as ModelBreakdownRow[];
		},

		getToolBreakdown(days = 30) {
			return stmts.toolBreakdown.all(`-${days} days`) as ToolBreakdownRow[];
		},
	};
}
