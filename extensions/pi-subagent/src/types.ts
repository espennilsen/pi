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

// ── Pool types (orchestrator + long-lived agents) ───────────────

export type RpcAgentState = "starting" | "idle" | "streaming" | "dead";

export interface PoolAgentNode {
	/** Unique agent ID within the pool */
	id: string;
	/** Agent config name (e.g. "worker", "scout") */
	agentName: string;
	/** Parent agent ID (null for root) */
	parentId: string | null;
	/** Child agent IDs */
	childIds: string[];
	/** Depth in the tree (root = 0) */
	depth: number;
	/** Current process state */
	state: RpcAgentState;
	/** When this agent was spawned */
	startedAt: number;
	/** Cumulative usage stats */
	usage: UsageStats;
	/** Model in use */
	model: string | null;
	/** Initial task description */
	task: string;
	/** Agent source (user/project) */
	agentSource: "user" | "project" | "unknown";
}

export interface PoolEntry {
	id: string;
	agentName: string;
	state: RpcAgentState;
	parentId: string | null;
	childIds: string[];
	depth: number;
	startedAt: number;
	usage: UsageStats;
	model: string | null;
	task: string;
}

/** IPC request from shim → pool server */
export interface PoolIpcRequest {
	/** Request ID for correlation */
	requestId: string;
	/** ID of the agent making the request */
	agentId: string;
	/** Action to perform */
	action: "spawn" | "send" | "kill" | "list";
	/** For spawn: agent config name */
	agentName?: string;
	/** For spawn: initial task */
	task?: string;
	/** For spawn: agent ID to assign */
	spawnId?: string;
	/** For send: target agent ID */
	targetId?: string;
	/** For send: message content */
	message?: string;
	/** For kill: agent ID to kill */
	killId?: string;
}

/** IPC response from pool server → shim */
export interface PoolIpcResponse {
	/** Matching request ID */
	requestId: string;
	/** Whether the operation succeeded */
	success: boolean;
	/** Response text (agent output, status, etc.) */
	data?: string;
	/** Error message if !success */
	error?: string;
}

export interface PoolDetails {
	mode: "orchestrator" | "pool";
	agents: PoolEntry[];
	rootId: string | null;
	totalUsage: UsageStats;
}

/** Result of a completed async pool operation (spawn or send) */
export interface PendingOpResult {
	/** Sequential operation ID */
	opId: number;
	/** Agent ID this operation was for */
	agentId: string;
	/** Whether this was a spawn or send */
	type: "spawn" | "send";
	/** When the operation was dispatched */
	startedAt: number;
	/** Agent response text (if successful) */
	response?: string;
	/** Error message (if failed) */
	error?: string;
}

// ── Settings ────────────────────────────────────────────────────

export interface SubagentSettings {
	maxConcurrent: number;
	maxTotal: number;
	timeoutMs: number;
	model: string | null;
	/** Default extensions to whitelist for all subagents (merged with per-agent extensions) */
	extensions: string[];
	/** Extensions that subagents are never allowed to load (pi-subagent is always blocked) */
	blockedExtensions: string[];
	/** Max agents in a single pool (orchestrator/pool mode) */
	maxPoolSize: number;
	/** Max tree depth for orchestrator mode (root = 0) */
	maxDepth: number;

}
