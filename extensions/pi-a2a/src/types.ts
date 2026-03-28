/**
 * pi-a2a — Extension config types.
 *
 * A2A protocol types are imported directly from @a2a-js/sdk where needed.
 */

// ── Extension Config ────────────────────────────────────────────

export interface A2AConfig {
	/** HTTP port for the A2A server. Defaults to 3100. */
	port?: number;
	/** Bind address for the HTTP server. Defaults to "127.0.0.1" (localhost only).
	 *  Set to "0.0.0.0" for external access (requires apiKey). */
	bind?: string;
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
	/** Skills to advertise in the Agent Card. */
	skills?: Array<{ id: string; name: string; description: string; tags?: string[] }>;
	/** A2A Hub settings for optional registration. */
	hub?: HubConfig;
	/** Timeout in milliseconds for outbound a2a_send requests. No timeout by default. */
	sendTimeoutMs?: number;
	/** Default maximum hop count for loop control. Defaults to 10.
	 *  Messages exceeding this many agent-to-agent hops are rejected. */
	maxHops?: number;
	/** Manually configured remote agents (no hub required). */
	staticAgents?: StaticAgentConfig[];
	/** Task time-to-live in milliseconds. Tasks older than this are pruned periodically.
	 *  Defaults to 86400000 (24 hours). Set to 0 to disable expiry. */
	taskTtlMs?: number;
	/** Clarification response poller settings.
	 *  When enabled, periodically checks the hub for answered owner clarifications
	 *  and spawns a fresh pi subprocess to handle each response. */
	poller?: PollerConfig;
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
