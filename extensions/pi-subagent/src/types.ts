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
	/** Extension paths to whitelist for this agent (subagents run with -ne by default) */
	extensions?: string[];
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

// ── Runner result ───────────────────────────────────────────────

export interface RunnerResult {
	/** Final text response */
	response: string;
	/** Full message history from the subprocess */
	messages: any[];
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
	/** Stop reason (if any) */
	stopReason: string | null;
	/** Error message (if any) */
	errorMessage: string | null;
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
	/** Full message history for rich rendering */
	messages: any[];
	/** Final text response (convenience) */
	response: string;
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
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
	/** Default extensions to whitelist for all subagents (merged with per-agent extensions) */
	extensions: string[];
}
