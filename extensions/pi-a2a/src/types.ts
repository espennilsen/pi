/**
 * pi-a2a — Extension config types.
 *
 * A2A protocol types are imported directly from @a2a-js/sdk where needed.
 */

// ── Extension Config ────────────────────────────────────────────

export interface A2AConfig {
	/** HTTP port for the A2A server. Defaults to 3100. */
	port?: number;
	/** Port range for dynamic port discovery (inclusive). When set, pi-a2a
	 *  finds the first free port in this range instead of using a fixed port.
	 *  E.g. [3100, 3199]. Takes precedence over `port`. */
	portRange?: [number, number];
	/** Bind address for the HTTP server. Defaults to "127.0.0.1" (localhost only).
	 *  Set to "0.0.0.0" for external access (requires apiKey). */
	bind?: string;
	/** Network interface name or IP to use for publicUrl auto-detection.
	 *  When set, publicUrl uses this interface's IP instead of the primary IP.
	 *  Examples: "en0", "eth0", "192.168.1.100". Requires `bind` to be set if not localhost. */
	bindInterface?: string;
	/** API key for authenticating RPC requests. Required when bind is not localhost. */
	apiKey?: string;
	/** Public-facing base URL. Defaults to http://localhost:{port}. */
	publicUrl?: string;
	/** Agent display name. Defaults to "Pi Agent". */
	name?: string;
	/** Agent description. */
	description?: string;
	/** Agent version. Defaults to "1.0.0". */
	version?: string;
	/** Provider organization name. */
	organization?: string;
	/** Provider URL. */
	providerUrl?: string;
	/** Agent owner name or email (displayed in agent discovery and hub UIs). */
	owner?: string;
	/** Skills to advertise in the Agent Card. */
	skills?: Array<{ id: string; name: string; description: string; tags?: string[] }>;
	/** A2A Hub settings for optional registration. */
	hub?: HubConfig;
	/** Timeout in milliseconds for outbound a2a_send requests. No timeout by default. */
	sendTimeoutMs?: number;
	/** Default maximum hop count for loop control. Defaults to 10.
	 *  Messages exceeding this many agent-to-agent hops are rejected. */
	maxHops?: number;
	/** URL to an icon for the agent (displayed in hub UIs and agent discovery). */
	iconUrl?: string;
	/** URL to the agent's documentation page. */
	documentationUrl?: string;
	/** Manually configured remote agents (no hub required). */
	staticAgents?: StaticAgentConfig[];
	/** Task time-to-live in milliseconds. Tasks older than this are pruned periodically.
	 *  Defaults to 86400000 (24 hours). Set to 0 to disable expiry. */
	taskTtlMs?: number;
	/** Timeout in milliseconds for processing a single inbound A2A task.
	 *  If the main agent doesn't respond within this time, the task is marked failed
	 *  and the queue is unblocked. Defaults to 600000 (10 minutes). Set to 0 to disable. */
	taskTimeoutMs?: number;
	/** Timeout in milliseconds for waiting for follow-up input when a task is in
	 *  input-required state. If the caller doesn't respond within this time, the
	 *  a2a_request_input tool returns an error and the task fails.
	 *  Defaults to 600000 (10 minutes). */
	inputRequiredTimeoutMs?: number;
	/** Maximum number of input-required rounds allowed per task.
	 *  Prevents infinite input loops. Defaults to 5. */
	maxInputRounds?: number;
	/** Clarification response poller settings.
	 *  When enabled, periodically checks the hub for answered owner clarifications
	 *  and spawns a fresh pi subprocess to handle each response. */
	poller?: PollerConfig;
	/** Long-running task support.
	 *  When enabled, tasks can run for hours/days without timeouts.
	 *  State is persisted to disk and survives Pi restarts.
	 *  Uses a smart resume queue that waits for agent to be idle. */
	longRunningTasks?: LongRunningTasksConfig;
}

/** Configuration for the background clarification poller. */
export interface PollerConfig {
	/** Enable the poller. Defaults to false. */
	enabled?: boolean;
	/** Poll interval in seconds. Defaults to 60. Min 15, max 600. */
	intervalSeconds?: number;
	/** Extension paths to load in spawned pi subprocesses. */
	extensions?: string[];
	/** Skill paths to load in spawned pi subprocesses. */
	skills?: string[];
	/** Model to use for spawned pi subprocesses. */
	model?: string;
}

/** Configuration for long-running task support. */
export interface LongRunningTasksConfig {
	/** Enable long-running task support. Defaults to false. */
	enabled?: boolean;
	/** Maximum task age in hours. Tasks older than this are pruned.
	 *  Defaults to 168 hours (7 days). */
	maxTaskAgeHours?: number;
	/** Maximum retry attempts for resume requests. Defaults to 3. */
	resumeRetryAttempts?: number;
	/** Delay between resume retry attempts in milliseconds. Defaults to 5000. */
	resumeRetryDelayMs?: number;
	/** Polling interval for checking completed tasks in milliseconds.
	 *  Defaults to 300000 (5 minutes). */
	pollingIntervalMs?: number;
}

/** Configuration for a manually defined remote agent. */
export interface StaticAgentConfig {
	/** Agent display name (used for resolution in a2a_send). */
	name: string;
	/** Agent's A2A base URL (e.g. "http://192.168.1.50:3100"). */
	url: string;
	/** API key for authenticating with this agent (sent as Bearer token). */
	apiKey?: string;
	/** Optional description override (defaults to agent card description). */
	description?: string;
}

export interface HubConfig {
	/** Hub API base URL (e.g. "http://localhost:3001/api"). */
	url: string;
	/** API key for hub authentication. */
	apiKey: string;
	/** Categories to register under. */
	categories?: string[];
	/** Freeform tags. */
	tags?: string[];
	/** Visibility: public, unlisted, or private. Defaults to "public". */
	visibility?: "public" | "unlisted" | "private";
	/** Auto-register on session start. Defaults to true when hub config is present. */
	autoRegister?: boolean;
}

// ── Remote Agent Types (from hub API responses) ─────────────────

export interface RemoteAgentSummary {
	id: string;
	name: string;
	description: string;
	url: string;
	category: string[];
	tags: string[];
	iconUrl: string | null;
	healthStatus: "healthy" | "degraded" | "down" | "unknown";
	popularity: number;
	featured: boolean;
	queueDepth: number;
	activeTasks: number;
	maxConcurrent: number;
	avgResponseMs: number | null;
	availability: "idle" | "busy" | "saturated" | "unknown";
	telemetryUpdatedAt: string | null;
	lastSeenAt: string | null;
}

export interface RemoteAgentDetail {
	id: string;
	agentCard: Record<string, unknown>;
	status: "pending" | "active" | "suspended" | "archived";
	visibility: "public" | "private" | "unlisted";
	category: string[];
	tags: string[];
	featured: boolean;
	popularity: number;
	healthStatus: "healthy" | "degraded" | "down" | "unknown";
	uptimePercentage: number;
	validationStatus: "valid" | "invalid" | "warning" | "unknown";
	hasCredential: boolean;
	credentialUpdatedAt: string | null;
	createdAt: string;
	updatedAt: string;
	queueDepth: number;
	activeTasks: number;
	maxConcurrent: number;
	avgResponseMs: number | null;
	totalTasks: number;
	totalFailures: number;
	availability: "idle" | "busy" | "saturated" | "unknown";
	telemetryUpdatedAt: string | null;
	lastSeenAt: string | null;
}

// ── Telemetry Snapshot ──────────────────────────────────────────

export interface TelemetrySnapshot {
	queueDepth: number;
	activeTasks: number;
	maxConcurrent: number;
	lastTaskDurationMs?: number;
	lastTaskStatus?: "completed" | "failed";
}

// ── Orchestrator Types ──────────────────────────────────────────

export interface AgentSelectionResult {
	agentId: string;
}

export interface AgentStrategy {
	name: string;
	description: string;
	weights?: Record<string, number>;
}

export interface ProjectSettings {
	project: string;
	displayName?: string;
	maxConcurrent?: number;
	stallTimeoutMs?: number;
	turnTimeoutMs?: number;
	maxRetryBackoffMs?: number;
	pollIntervalMs?: number;
	autoApprove?: boolean;
	inputRequiredPolicy?: "block" | "ask";
	eligibleAgents?: string[];
	createdAt: string;
	updatedAt: string;
}

// ── SSE Stream Types ──────────────────────────────────────────

export interface PipelineStreamEvent {
	type: "task.stateChanged";
	data: {
		taskId: string;
		fromState: string | null;
		toState: string;
		project: string;
		assignedAgentId: string | null;
		externalTaskId: string | null;
		branch: string | null;
		prUrl: string | null;
		prNumber: number | null;
		title: string;
		priority: string;
	};
	timestamp: string;
}

// ── Push Notification Types ──────────────────────────────────────────

export type PushEventType =
	| "task.stateChanged"
	| "task.progress"
	| "task.error"
	| "heartbeat";

export interface PushEventPayload {
	taskId?: string;
	fromState?: string | null;
	toState?: string;
	progress?: number;
	message?: string;
	error?: string;
	artifact?: unknown;
	queueDepth?: number;
	activeTasks?: number;
	maxConcurrent?: number;
	timestamp: string;
}

export interface AgentPushCapabilities {
	enabled: boolean;
	url: string;
	events: PushEventType[];
}
