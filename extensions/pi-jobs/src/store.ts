/**
 * Jobs store — unified async interface over multiple backends.
 *
 * Two backends:
 *   1. "sqlite" (default) — local better-sqlite3 via db.ts
 *   2. "kysely" — shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Consumers import `getJobsStore()` and get back the same async API
 * regardless of which backend is active.
 *
 * Backend selection is driven by `pi-jobs.useKysely` in settings.json.
 */

import type {
	JobRecord,
	ToolCallRecord,
	JobTotals,
	DailyStatRow,
	ModelBreakdownRow,
	ToolBreakdownRow,
} from "./db.ts";

// ── Store interface ─────────────────────────────────────────────

export interface JobsStore {
	createJob(opts: {
		channel: string;
		prompt: string;
		model?: string;
		provider?: string;
	}): Promise<string>;
	markJobRunning(jobId: string): Promise<void>;
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
	}): Promise<void>;
	failJob(jobId: string, errorMessage: string, durationMs?: number): Promise<void>;
	recordToolCall(opts: {
		jobId: string;
		toolName: string;
		argsJson?: string;
		resultPreview?: string;
		isError?: boolean;
		durationMs?: number;
	}): Promise<void>;
	getJob(jobId: string): Promise<JobRecord | undefined>;
	getRecentJobs(limit?: number, channel?: string): Promise<JobRecord[]>;
	getJobToolCalls(jobId: string): Promise<ToolCallRecord[]>;
	getTotals(channel?: string): Promise<JobTotals>;
	getDailyStats(days?: number, channel?: string): Promise<DailyStatRow[]>;
	getModelBreakdown(days?: number): Promise<ModelBreakdownRow[]>;
	getToolBreakdown(days?: number): Promise<ToolBreakdownRow[]>;
}

// ── Singleton ───────────────────────────────────────────────────

let activeStore: JobsStore | null = null;

export function setJobsStore(store: JobsStore): void {
	activeStore = store;
}

export function getJobsStore(): JobsStore {
	if (!activeStore) throw new Error("pi-jobs: store not initialized");
	return activeStore;
}

export function isStoreReady(): boolean {
	return activeStore !== null;
}

// ── SQLite backend (better-sqlite3, synchronous) ────────────────

/**
 * Create a store backed by the local SQLite file via better-sqlite3.
 * Uses a dynamic import so better-sqlite3 isn't loaded when using kysely.
 */
export async function createSqliteStore(dbPath: string): Promise<JobsStore> {
	const db = await import("./db.ts");
	db.initDb(dbPath);

	const api = db.getJobsApi();
	return {
		createJob: (opts) => Promise.resolve(api.createJob(opts)),
		markJobRunning: (id) => { api.markJobRunning(id); return Promise.resolve(); },
		completeJob: (id, r) => { api.completeJob(id, r); return Promise.resolve(); },
		failJob: (id, msg, ms) => { api.failJob(id, msg, ms); return Promise.resolve(); },
		recordToolCall: (opts) => { api.recordToolCall(opts); return Promise.resolve(); },
		getJob: (id) => Promise.resolve(api.getJob(id)),
		getRecentJobs: (limit, ch) => Promise.resolve(api.getRecentJobs(limit, ch)),
		getJobToolCalls: (id) => Promise.resolve(api.getJobToolCalls(id)),
		getTotals: (ch) => Promise.resolve(api.getTotals(ch)),
		getDailyStats: (days, ch) => Promise.resolve(api.getDailyStats(days, ch)),
		getModelBreakdown: (days) => Promise.resolve(api.getModelBreakdown(days)),
		getToolBreakdown: (days) => Promise.resolve(api.getToolBreakdown(days)),
	};
}

// ── Kysely backend (pi-kysely event bus, async) ─────────────────

interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

/**
 * Create a store backed by pi-kysely's shared database.
 */
export async function createKyselyStore(eventBus: EventBus): Promise<JobsStore> {
	const db = await import("./db-kysely.ts");
	await db.initDb(eventBus);
	return db;
}
