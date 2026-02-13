/**
 * pi-jobs — Database layer via pi-kysely event bus.
 *
 * Drop-in replacement for db.ts. No direct imports from pi-kysely,
 * no better-sqlite3 dependency. All DB access via events:
 *
 *   - kysely:info   — detect SQL dialect (sqlite/postgres/mysql)
 *   - kysely:schema:register — table creation (portable DDL)
 *   - kysely:query  — raw SQL for reads/writes
 *   - kysely:migration:apply — tracked migrations
 *
 * Dialect-aware: queries `kysely:info` on init to detect the active
 * driver and adapts dialect-specific SQL (e.g. upsert syntax).
 *
 * Requires pi-kysely extension to be loaded.
 */

import { readdirSync, readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import type { EventBus } from "@mariozechner/pi-coding-agent";
import type {
	JobRecord,
	ToolCallRecord,
	JobTotals,
	DailyStatRow,
	ModelBreakdownRow,
	ToolBreakdownRow,
} from "./db.ts";

const ACTOR = "pi-jobs";

type Driver = "sqlite" | "postgres" | "mysql";

let events: EventBus;
let driver: Driver = "sqlite";

// ── Schema (portable DDL via Kysely schema builder) ─────────────

const SCHEMA = {
	actor: ACTOR,
	tables: {
		jobs: {
			columns: {
				id:                 { type: "text" as const, primaryKey: true },
				channel:            { type: "text" as const, notNull: true, default: "tui" },
				status:             { type: "text" as const, notNull: true, default: "pending" },
				prompt:             { type: "text" as const, notNull: true },
				response:           { type: "text" as const },
				model:              { type: "text" as const },
				provider:           { type: "text" as const },
				input_tokens:       { type: "integer" as const, notNull: true, default: 0 },
				output_tokens:      { type: "integer" as const, notNull: true, default: 0 },
				cache_read_tokens:  { type: "integer" as const, notNull: true, default: 0 },
				cache_write_tokens: { type: "integer" as const, notNull: true, default: 0 },
				total_tokens:       { type: "integer" as const, notNull: true, default: 0 },
				cost_input:         { type: "real" as const, notNull: true, default: 0 },
				cost_output:        { type: "real" as const, notNull: true, default: 0 },
				cost_cache_read:    { type: "real" as const, notNull: true, default: 0 },
				cost_cache_write:   { type: "real" as const, notNull: true, default: 0 },
				cost_total:         { type: "real" as const, notNull: true, default: 0 },
				tool_call_count:    { type: "integer" as const, notNull: true, default: 0 },
				turn_count:         { type: "integer" as const, notNull: true, default: 0 },
				error_message:      { type: "text" as const },
				duration_ms:        { type: "integer" as const },
				created_at:         { type: "text" as const, notNull: true },
				finished_at:        { type: "text" as const },
			},
			indexes: [
				{ columns: ["channel"], name: "idx_jobs_channel" },
				{ columns: ["status"], name: "idx_jobs_status" },
				{ columns: ["created_at"], name: "idx_jobs_created_at" },
				{ columns: ["model"], name: "idx_jobs_model" },
			],
		},
		tool_calls: {
			columns: {
				id:             { type: "integer" as const, primaryKey: true, autoIncrement: true },
				job_id:         { type: "text" as const, notNull: true, references: "jobs.id", onDelete: "cascade" as const },
				tool_name:      { type: "text" as const, notNull: true },
				args_json:      { type: "text" as const },
				result_preview: { type: "text" as const },
				is_error:       { type: "integer" as const, notNull: true, default: 0 },
				duration_ms:    { type: "integer" as const },
				created_at:     { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["job_id"], name: "idx_tool_calls_job" },
				{ columns: ["tool_name"], name: "idx_tool_calls_name" },
			],
		},
		daily_stats: {
			columns: {
				date:              { type: "text" as const, notNull: true },
				channel:           { type: "text" as const, notNull: true },
				model:             { type: "text" as const, notNull: true, default: "" },
				job_count:         { type: "integer" as const, notNull: true, default: 0 },
				error_count:       { type: "integer" as const, notNull: true, default: 0 },
				total_tokens:      { type: "integer" as const, notNull: true, default: 0 },
				cost_total:        { type: "real" as const, notNull: true, default: 0 },
				total_duration_ms: { type: "integer" as const, notNull: true, default: 0 },
				tool_call_count:   { type: "integer" as const, notNull: true, default: 0 },
			},
			unique: [["date", "channel", "model"]],
		},
	},
};

// ── Migrations ──────────────────────────────────────────────────

const migrationDir = new URL("../migrations", import.meta.url).pathname;

function loadMigrations(): Array<{ name: string; sql: string }> {
	try {
		return readdirSync(migrationDir)
			.filter((f) => f.endsWith(".sql"))
			.sort()
			.map((f) => ({
				name: f.replace(/\.sql$/, ""),
				sql: readFileSync(`${migrationDir}/${f}`, "utf-8"),
			}));
	} catch {
		return [];
	}
}

// ── Init ────────────────────────────────────────────────────────

export async function initDb(eventBus: EventBus): Promise<void> {
	events = eventBus;

	// Detect SQL dialect from pi-kysely
	events.emit("kysely:info", {
		reply: (info: { defaultDriver?: string }) => {
			if (info.defaultDriver === "postgres" || info.defaultDriver === "mysql") {
				driver = info.defaultDriver;
			}
		},
	});

	// Apply tracked migrations
	const migrations = loadMigrations();
	if (migrations.length > 0) {
		await new Promise<void>((resolve, reject) => {
			events.emit("kysely:migration:apply", {
				actor: ACTOR,
				migrations,
				reply: (result: { ok: boolean; applied: string[]; skipped: string[]; errors: string[] }) => {
					if (result.ok) resolve();
					else reject(new Error(`Migration failed: ${result.errors.join("; ")}`));
				},
			});
		});
	}

	// Schema:register as safety net — catches any column/index drift
	await new Promise<void>((resolve, reject) => {
		events.emit("kysely:schema:register", {
			...SCHEMA,
			reply: (result: { ok: boolean; errors: string[] }) => {
				if (result.ok) resolve();
				else reject(new Error(`Schema register failed: ${result.errors.join("; ")}`));
			},
		});
	});
}

/** Returns the detected SQL dialect. */
export function getDriver(): Driver {
	return driver;
}

// ── Query helper ────────────────────────────────────────────────

interface QueryResult {
	rows: Record<string, unknown>[];
	numAffectedRows?: number;
	insertId?: number | bigint;
}

function query(sql: string, params: unknown[] = []): Promise<QueryResult> {
	return new Promise((resolve, reject) => {
		events.emit("kysely:query", {
			actor: ACTOR,
			input: { sql, params },
			reply: (result: QueryResult) => resolve(result),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});
}

// ── Helpers ─────────────────────────────────────────────────────

function now(): string {
	return new Date().toISOString();
}

// ── CRUD ────────────────────────────────────────────────────────

export async function createJob(opts: {
	channel: string;
	prompt: string;
	model?: string;
	provider?: string;
}): Promise<string> {
	const id = crypto.randomUUID();
	const ts = now();
	await query(
		`INSERT INTO jobs (id, channel, status, prompt, model, provider, input_tokens, output_tokens,
		  cache_read_tokens, cache_write_tokens, total_tokens,
		  cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total,
		  tool_call_count, turn_count, created_at)
		 VALUES (?, ?, 'pending', ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
		[id, opts.channel, opts.prompt, opts.model ?? null, opts.provider ?? null, ts],
	);
	return id;
}

export async function markJobRunning(jobId: string): Promise<void> {
	await query("UPDATE jobs SET status = 'running' WHERE id = ?", [jobId]);
}

export async function completeJob(jobId: string, r: {
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
}): Promise<void> {
	const ts = now();
	await query(
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
			finished_at = ?
		 WHERE id = ?`,
		[
			r.response, r.inputTokens ?? 0, r.outputTokens ?? 0,
			r.cacheReadTokens ?? 0, r.cacheWriteTokens ?? 0, r.totalTokens ?? 0,
			r.costInput ?? 0, r.costOutput ?? 0, r.costCacheRead ?? 0, r.costCacheWrite ?? 0, r.costTotal ?? 0,
			r.toolCallCount ?? 0, r.turnCount ?? 0, r.durationMs ?? null,
			ts, jobId,
		],
	);

	// Update daily stats
	const job = await getJob(jobId);
	if (job) await updateDaily(job, false);
}

export async function failJob(jobId: string, errorMessage: string, durationMs?: number): Promise<void> {
	const ts = now();
	await query(
		`UPDATE jobs SET
			status = 'error', error_message = ?, duration_ms = ?,
			finished_at = ?
		 WHERE id = ?`,
		[errorMessage, durationMs ?? null, ts, jobId],
	);

	const job = await getJob(jobId);
	if (job) await updateDaily(job, true);
}

export async function recordToolCall(opts: {
	jobId: string;
	toolName: string;
	argsJson?: string;
	resultPreview?: string;
	isError?: boolean;
	durationMs?: number;
}): Promise<void> {
	const ts = now();
	await query(
		`INSERT INTO tool_calls (job_id, tool_name, args_json, result_preview, is_error, duration_ms, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			opts.jobId, opts.toolName, opts.argsJson ?? null,
			opts.resultPreview ?? null, opts.isError ? 1 : 0, opts.durationMs ?? null, ts,
		],
	);
}

export async function getJob(jobId: string): Promise<JobRecord | undefined> {
	const { rows } = await query("SELECT * FROM jobs WHERE id = ?", [jobId]);
	return rows.length > 0 ? (rows[0] as unknown as JobRecord) : undefined;
}

export async function getRecentJobs(limit: number = 20, channel?: string): Promise<JobRecord[]> {
	if (channel) {
		const { rows } = await query(
			"SELECT * FROM jobs WHERE channel = ? ORDER BY created_at DESC LIMIT ?",
			[channel, limit],
		);
		return rows as unknown as JobRecord[];
	}
	const { rows } = await query(
		"SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
		[limit],
	);
	return rows as unknown as JobRecord[];
}

export async function getJobToolCalls(jobId: string): Promise<ToolCallRecord[]> {
	const { rows } = await query(
		"SELECT * FROM tool_calls WHERE job_id = ? ORDER BY created_at ASC",
		[jobId],
	);
	return rows as unknown as ToolCallRecord[];
}

export async function getTotals(channel?: string): Promise<JobTotals> {
	const sql = channel
		? `SELECT COUNT(*) as jobs,
			SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors,
			COALESCE(SUM(total_tokens),0) as tokens,
			COALESCE(SUM(cost_total),0) as cost,
			COALESCE(SUM(tool_call_count),0) as toolCalls,
			COALESCE(AVG(duration_ms),0) as avgDurationMs
		   FROM jobs WHERE channel = ?`
		: `SELECT COUNT(*) as jobs,
			SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors,
			COALESCE(SUM(total_tokens),0) as tokens,
			COALESCE(SUM(cost_total),0) as cost,
			COALESCE(SUM(tool_call_count),0) as toolCalls,
			COALESCE(AVG(duration_ms),0) as avgDurationMs
		   FROM jobs`;
	const params = channel ? [channel] : [];
	const { rows } = await query(sql, params);
	const row = rows[0] as any;
	return {
		jobs: row.jobs ?? 0,
		errors: row.errors ?? 0,
		tokens: row.tokens ?? 0,
		cost: row.cost ?? 0,
		toolCalls: row.toolCalls ?? 0,
		avgDurationMs: Math.round(row.avgDurationMs ?? 0),
	};
}

export async function getDailyStats(days: number = 30, channel?: string): Promise<DailyStatRow[]> {
	const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
	if (channel) {
		const { rows } = await query(
			`SELECT date, channel, model, job_count, error_count, total_tokens, cost_total,
				CASE WHEN job_count > 0 THEN total_duration_ms / job_count ELSE 0 END as avg_duration_ms,
				tool_call_count
			 FROM daily_stats WHERE channel = ? AND date >= ? ORDER BY date DESC`,
			[channel, cutoff],
		);
		return rows as unknown as DailyStatRow[];
	}
	const { rows } = await query(
		`SELECT date, channel, model, job_count, error_count, total_tokens, cost_total,
			CASE WHEN job_count > 0 THEN total_duration_ms / job_count ELSE 0 END as avg_duration_ms,
			tool_call_count
		 FROM daily_stats WHERE date >= ? ORDER BY date DESC`,
		[cutoff],
	);
	return rows as unknown as DailyStatRow[];
}

export async function getModelBreakdown(days: number = 30): Promise<ModelBreakdownRow[]> {
	const cutoff = new Date(Date.now() - days * 86400000).toISOString();
	const { rows } = await query(
		`SELECT provider, model, COUNT(*) as job_count,
			SUM(total_tokens) as total_tokens, SUM(cost_total) as cost_total,
			AVG(duration_ms) as avg_duration_ms
		 FROM jobs WHERE created_at >= ?
		 GROUP BY provider, model ORDER BY cost_total DESC`,
		[cutoff],
	);
	return rows as unknown as ModelBreakdownRow[];
}

export async function getToolBreakdown(days: number = 30): Promise<ToolBreakdownRow[]> {
	const cutoff = new Date(Date.now() - days * 86400000).toISOString();
	const { rows } = await query(
		`SELECT tool_name, COUNT(*) as call_count,
			SUM(CASE WHEN is_error THEN 1 ELSE 0 END) as error_count,
			AVG(duration_ms) as avg_duration_ms
		 FROM tool_calls WHERE created_at >= ?
		 GROUP BY tool_name ORDER BY call_count DESC`,
		[cutoff],
	);
	return rows as unknown as ToolBreakdownRow[];
}

// ── Daily stats upsert ──────────────────────────────────────────

async function updateDaily(job: JobRecord, isError: boolean): Promise<void> {
	const date = job.created_at.slice(0, 10);

	const upsertSql =
		driver === "postgres"
			? `INSERT INTO daily_stats (date, channel, model, job_count, error_count, total_tokens, cost_total, total_duration_ms, tool_call_count)
			   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			   ON CONFLICT (date, channel, model) DO UPDATE SET
				 job_count = daily_stats.job_count + EXCLUDED.job_count,
				 error_count = daily_stats.error_count + EXCLUDED.error_count,
				 total_tokens = daily_stats.total_tokens + EXCLUDED.total_tokens,
				 cost_total = daily_stats.cost_total + EXCLUDED.cost_total,
				 total_duration_ms = daily_stats.total_duration_ms + EXCLUDED.total_duration_ms,
				 tool_call_count = daily_stats.tool_call_count + EXCLUDED.tool_call_count`
			: `INSERT INTO daily_stats (date, channel, model, job_count, error_count, total_tokens, cost_total, total_duration_ms, tool_call_count)
			   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			   ON CONFLICT(date, channel, model) DO UPDATE SET
				 job_count = job_count + excluded.job_count,
				 error_count = error_count + excluded.error_count,
				 total_tokens = total_tokens + excluded.total_tokens,
				 cost_total = cost_total + excluded.cost_total,
				 total_duration_ms = total_duration_ms + excluded.total_duration_ms,
				 tool_call_count = tool_call_count + excluded.tool_call_count`;

	await query(upsertSql, [
		date, job.channel, job.model ?? "",
		1, isError ? 1 : 0,
		isError ? 0 : job.total_tokens,
		isError ? 0 : job.cost_total,
		isError ? 0 : (job.duration_ms ?? 0),
		isError ? 0 : job.tool_call_count,
	]).catch(() => {}); // ignore upsert errors
}
