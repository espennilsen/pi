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
}
