/**
 * pi-a2a — Type definitions.
 *
 * A2A protocol types (Agent Card, JSON-RPC, Tasks, Messages)
 * plus extension config types.
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
	/** Contact email. */
	contactEmail?: string;
	/** Website URL. */
	website?: string;
	/** Skills to advertise in the Agent Card. */
	skills?: AgentSkill[];
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

// ── A2A Protocol Types ──────────────────────────────────────────

export interface AgentCard {
	name: string;
	description: string;
	url: string;
	version: string;
	provider?: AgentProvider;
	capabilities: AgentCapabilities;
	skills: AgentSkill[];
	defaultInputModes?: string[];
	defaultOutputModes?: string[];
	supportsAuthenticatedExtendedCard?: boolean;
}

export interface AgentProvider {
	organization: string;
	contactEmail?: string;
	website?: string;
}

export interface AgentCapabilities {
	streaming?: boolean;
	pushNotifications?: boolean;
	multiTurn?: boolean;
}

export interface AgentSkill {
	id: string;
	name: string;
	description: string;
	tags?: string[];
	examples?: string[];
}

// ── JSON-RPC 2.0 ────────────────────────────────────────────────

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
	id?: string | number | null;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	result?: unknown;
	error?: JsonRpcError;
	id: string | number | null;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

// ── A2A Task & Message Types ────────────────────────────────────

export type TaskState =
	| "submitted"
	| "working"
	| "input-required"
	| "completed"
	| "canceled"
	| "failed"
	| "unknown";

export interface Task {
	id: string;
	contextId: string;
	status: TaskStatus;
	history?: Message[];
	artifacts?: Artifact[];
	metadata?: Record<string, unknown>;
}

export interface TaskStatus {
	state: TaskState;
	message?: Message;
	timestamp?: string;
}

export type Role = "user" | "agent";

export interface Message {
	role: Role;
	parts: Part[];
	metadata?: Record<string, unknown>;
}

export type Part = TextPart | FilePart | DataPart;

export interface TextPart {
	type: "text";
	text: string;
}

export interface FilePart {
	type: "file";
	file: {
		name?: string;
		mimeType?: string;
		bytes?: string; // base64
		uri?: string;
	};
}

export interface DataPart {
	type: "data";
	data: Record<string, unknown>;
}

export interface Artifact {
	artifactId: string;
	name?: string;
	parts: Part[];
	metadata?: Record<string, unknown>;
}

// ── Send Message Request ────────────────────────────────────────

export interface SendMessageRequest {
	message: Message;
	/** Optional context ID for multi-turn conversations. */
	contextId?: string;
	configuration?: SendMessageConfiguration;
}

export interface SendMessageConfiguration {
	acceptedOutputModes?: string[];
	historyLength?: number;
	blocking?: boolean;
}
