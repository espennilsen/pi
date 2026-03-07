/**
 * pi-channels — Shared types.
 */

// ── Channel message ─────────────────────────────────────────────

export type ChannelPayloadMode = "envelope" | "raw";

export interface WebhookRequestOptions {
	/** Override HTTP method for this message (e.g. POST, PUT, PATCH). */
	method?: string;
	/** Override Content-Type header for this message body. */
	contentType?: string;
}

export interface ChannelMessage {
	/** Adapter name: "telegram", "webhook", or a custom adapter */
	adapter: string;
	/** Recipient — adapter-specific (chat ID, webhook URL, email address, etc.) */
	recipient: string;
	/** Message text to deliver (optional when using raw payload mode) */
	text?: string;
	/** Where this came from (e.g. "cron:daily-standup") */
	source?: string;
	/** Arbitrary metadata for adapter handlers */
	metadata?: Record<string, unknown>;
	/** Payload mode hint for adapters that support multiple body formats */
	payloadMode?: ChannelPayloadMode;
	/** First-class custom body payload (used by webhook adapter in raw mode) */
	rawBody?: unknown;
	/** Webhook transport overrides for this message */
	webhook?: WebhookRequestOptions;
}

// ── Incoming message (from external → pi) ───────────────────────

export interface IncomingAttachment {
	/** Attachment type */
	type: "image" | "document" | "audio";
	/** Local file path (temporary, downloaded by the adapter) */
	path: string;
	/** Original filename (if available) */
	filename?: string;
	/** MIME type */
	mimeType?: string;
	/** File size in bytes */
	size?: number;
}

// ── Transcription config ────────────────────────────────────────

export interface TranscriptionConfig {
	/** Enable voice/audio transcription (default: false) */
	enabled: boolean;
	/**
	 * Transcription provider:
	 * - "apple"      — macOS SFSpeechRecognizer (free, offline, no API key)
	 * - "openai"     — Whisper API (uses pi's built-in auth if available, or explicit apiKey)
	 * - "elevenlabs" — Scribe API (requires explicit apiKey)
	 */
	provider: "apple" | "openai" | "elevenlabs";
	/**
	 * API key for cloud providers. Optional for OpenAI if pi has authentication configured.
	 * Put the key value directly in settings.json. Not needed for apple provider.
	 */
	apiKey?: string;
	/** Model name (e.g. "whisper-1", "scribe_v1"). Provider-specific default used if omitted. */
	model?: string;
	/** ISO 639-1 language hint (e.g. "en", "no"). Optional. */
	language?: string;
}

export interface IncomingMessage {
	/** Which adapter received this */
	adapter: string;
	/** Who sent it (chat ID, user ID, etc.) */
	sender: string;
	/** Message text */
	text: string;
	/** File attachments (images, documents) */
	attachments?: IncomingAttachment[];
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
	/**
	 * Send a typing/processing indicator.
	 * Optional — only supported by adapters that have real-time presence (e.g. Telegram).
	 */
	sendTyping?(recipient: string): Promise<void>;
	/**
	 * Sync bot commands with the platform (e.g. Telegram's /command menu).
	 * Optional — only supported by adapters with a command menu API.
	 */
	syncBotCommands?(commands: Array<{ command: string; description: string }>): Promise<void>;
}

// ── Config (lives under "pi-channels" key in pi settings.json) ──

export interface AdapterConfig {
	type: string;
	[key: string]: unknown;
}

export interface BridgeConfig {
	/** Enable the chat bridge (default: false). Also enabled via --chat-bridge flag. */
	enabled?: boolean;
	/**
	 * Default session mode (default: "persistent").
	 *
	 * - "persistent" — long-lived `pi --mode rpc` subprocess with conversation memory
	 * - "stateless"  — isolated `pi -p --no-session` subprocess per message (no memory)
	 *
	 * Can be overridden per sender via `sessionRules`.
	 */
	sessionMode?: "persistent" | "stateless";
	/**
	 * Per-sender session mode overrides.
	 * Each rule matches sender keys (`adapter:senderId`) against glob patterns.
	 * First match wins. Unmatched senders use `sessionMode` default.
	 *
	 * Examples:
	 *   - `{ "match": "telegram:-100*", "mode": "stateless" }` — group chats stateless
	 *   - `{ "match": "webhook:*", "mode": "stateless" }` — all webhooks stateless
	 *   - `{ "match": "telegram:123456789", "mode": "persistent" }` — specific user persistent
	 */
	sessionRules?: Array<{ match: string; mode: "persistent" | "stateless" }>;
	/**
	 * Idle timeout in minutes for persistent sessions (default: 30).
	 * After this period of inactivity, the sender's RPC subprocess is killed.
	 * A new one is spawned on the next message.
	 */
	idleTimeoutMinutes?: number;
	/** Max queued messages per sender before rejecting (default: 5). */
	maxQueuePerSender?: number;
	/** Subprocess timeout in ms (default: 300000 = 5 min). */
	timeoutMs?: number;
	/** Max senders processed concurrently (default: 2). */
	maxConcurrent?: number;
	/** Model override for subprocess (default: null = use default). */
	model?: string | null;
	/** Send typing indicators while processing (default: true). */
	typingIndicators?: boolean;
	/** Handle bot commands like /start, /help, /abort (default: true). */
	commands?: boolean;
	/**
	 * Extension paths to load in bridge subprocesses.
	 * Subprocess runs with --no-extensions by default (avoids loading
	 * extensions that crash or conflict, e.g. webserver port collisions).
	 * List only the extensions the bridge agent actually needs.
	 *
	 * Example: ["/Users/you/Dev/pi/extensions/pi-vault/src/index.ts"]
	 */
	extensions?: string[];
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
	/** Chat bridge configuration. */
	bridge?: BridgeConfig;
}

// ── Bridge types ────────────────────────────────────────────────

/** A queued prompt waiting to be processed. */
export interface QueuedPrompt {
	id: string;
	adapter: string;
	sender: string;
	text: string;
	attachments?: IncomingAttachment[];
	metadata?: Record<string, unknown>;
	enqueuedAt: number;
}

/** Per-sender session state. */
export interface SenderSession {
	adapter: string;
	sender: string;
	displayName: string;
	queue: QueuedPrompt[];
	processing: boolean;
	abortController: AbortController | null;
	messageCount: number;
	startedAt: number;
}

/** Result from a subprocess run. */
export interface RunResult {
	ok: boolean;
	response: string;
	error?: string;
	durationMs: number;
	exitCode: number;
}
