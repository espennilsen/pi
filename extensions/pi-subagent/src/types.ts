/**
 * pi-subagent — Type definitions.
 */

// ── Agent config ────────────────────────────────────────────────

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

// ── Runner result ───────────────────────────────────────────────

export interface RunnerResult {
	/** Final text response */
	response: string;
	/** Process exit code */
	exitCode: number;
	/** Token usage */
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	/** Cost breakdown */
	costInput: number;
	costOutput: number;
	costCacheRead: number;
	costCacheWrite: number;
	costTotal: number;
	/** Counts */
	toolCallCount: number;
	turnCount: number;
	/** Duration in milliseconds */
	durationMs: number;
	/** Model actually used */
	model: string | null;
	/** stderr output */
	stderr: string;
}

// ── Task types ──────────────────────────────────────────────────

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	response: string;
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

// ── Tracker types ───────────────────────────────────────────────

export type OneShotStatus =
	| "running"
	| "completed"
	| "failed"
	| "aborted"
	| "timed_out";

export interface OneShotEntry {
	id: string;
	agentName: string;
	taskPreview: string;
	status: OneShotStatus;
	startedAt: number;
	completedAt: number | null;
	durationMs: number | null;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
	};
	model: string | null;
	exitCode: number | null;
	error?: string;
	responsePreview?: string;
}

// ── Settings ────────────────────────────────────────────────────

export interface SubagentSettings {
	maxConcurrent: number;
	maxTotal: number;
	timeoutMs: number;
	model: string | null;
}
