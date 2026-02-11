/**
 * pi-channels — Shared types.
 */

// ── Channel message ─────────────────────────────────────────────

export interface ChannelMessage {
	/** Adapter name: "telegram", "webhook", or a custom adapter */
	adapter: string;
	/** Recipient — adapter-specific (chat ID, webhook URL, email address, etc.) */
	recipient: string;
	/** Message text to deliver */
	text: string;
	/** Where this came from (e.g. "cron:daily-standup") */
	source?: string;
	/** Arbitrary metadata for adapter handlers */
	metadata?: Record<string, unknown>;
}

// ── Incoming message (from external → pi) ───────────────────────

export interface IncomingMessage {
	/** Which adapter received this */
	adapter: string;
	/** Who sent it (chat ID, user ID, etc.) */
	sender: string;
	/** Message text */
	text: string;
	/** Adapter-specific metadata (message ID, username, timestamp, etc.) */
	metadata?: Record<string, unknown>;
}

// ── Adapter direction ───────────────────────────────────────────

export type AdapterDirection = "outgoing" | "incoming" | "bidirectional";

/** Callback for adapters to emit incoming messages */
export type OnIncomingMessage = (message: IncomingMessage) => void;

// ── Adapter handler ─────────────────────────────────────────────

export interface ChannelAdapter {
	/** What this adapter supports */
	direction: AdapterDirection;
	/** Send a message outward. Required for outgoing/bidirectional. */
	send?(message: ChannelMessage): Promise<void>;
	/** Start listening for incoming messages. Required for incoming/bidirectional. */
	start?(onMessage: OnIncomingMessage): Promise<void>;
	/** Stop listening. */
	stop?(): Promise<void>;
}

// ── Config (lives under "pi-channels" key in pi settings.json) ──

export interface AdapterConfig {
	type: string;
	[key: string]: unknown;
}

export interface ChannelConfig {
	/** Named adapter definitions */
	adapters: Record<string, AdapterConfig>;
	/**
	 * Route map: alias -> { adapter, recipient }.
	 * e.g. "ops" -> { adapter: "telegram", recipient: "-100987654321" }
	 * Lets cron jobs and other extensions use friendly names.
	 */
	routes?: Record<string, { adapter: string; recipient: string }>;
}
