/**
 * pi-channels — Chat bridge.
 *
 * Listens for incoming messages (channel:receive), serializes per sender,
 * runs prompts via isolated subprocesses, and sends responses back via
 * the same adapter. Each sender gets their own FIFO queue. Multiple
 * senders run concurrently up to maxConcurrent.
 */

import type {
	IncomingMessage,
	IncomingAttachment,
	QueuedPrompt,
	SenderSession,
	BridgeConfig,
} from "../types.ts";
import type { ChannelRegistry } from "../registry.ts";
import type { EventBus } from "@mariozechner/pi-coding-agent";
import { runPrompt } from "./runner.ts";
import { RpcSessionManager } from "./rpc-runner.ts";
import { isCommand, handleCommand, type CommandContext } from "./commands.ts";
import { startTyping } from "./typing.ts";

const BRIDGE_DEFAULTS: Required<BridgeConfig> = {
	enabled: false,
	sessionMode: "persistent",
	sessionRules: [],
	idleTimeoutMinutes: 30,
	maxQueuePerSender: 5,
	timeoutMs: 300_000,
	maxConcurrent: 2,
	model: null,
	typingIndicators: true,
	commands: true,
	extensions: [],
};

type LogFn = (event: string, data: unknown, level?: string) => void;

let idCounter = 0;
function nextId(): string {
	return `msg-${Date.now()}-${++idCounter}`;
}

export class ChatBridge {
	private config: Required<BridgeConfig>;
	private cwd: string;
	private registry: ChannelRegistry;
	private events: EventBus;
	private log: LogFn;
	private sessions = new Map<string, SenderSession>();
	private activeCount = 0;
	private running = false;
	private rpcManager: RpcSessionManager | null = null;

	constructor(
		bridgeConfig: BridgeConfig | undefined,
		cwd: string,
		registry: ChannelRegistry,
		events: EventBus,
		log: LogFn = () => {},
	) {
		this.config = { ...BRIDGE_DEFAULTS, ...bridgeConfig };
		this.cwd = cwd;
		this.registry = registry;
		this.events = events;
		this.log = log;
	}

	// ── Lifecycle ─────────────────────────────────────────────

	start(): void {
		if (this.running) return;
		this.running = true;

		// Always create the RPC manager — it's used on-demand for persistent senders
		this.rpcManager = new RpcSessionManager(
			{
				cwd: this.cwd,
				model: this.config.model,
				timeoutMs: this.config.timeoutMs,
				extensions: this.config.extensions,
			},
			this.config.idleTimeoutMinutes * 60_000,
		);
	}

	stop(): void {
		this.running = false;
		for (const session of this.sessions.values()) {
			session.abortController?.abort();
		}
		this.sessions.clear();
		this.activeCount = 0;
		this.rpcManager?.killAll();
		this.rpcManager = null;
	}

	isActive(): boolean {
		return this.running;
	}

	updateConfig(cfg: BridgeConfig): void {
		this.config = { ...BRIDGE_DEFAULTS, ...cfg };
	}

	// ── Main entry point ──────────────────────────────────────

	handleMessage(message: IncomingMessage): void {
		if (!this.running) return;

		const text = message.text?.trim();
		const hasAttachments = message.attachments && message.attachments.length > 0;
		if (!text && !hasAttachments) return;

		// Rejected messages (too large, unsupported type) — send back directly
		if (message.metadata?.rejected) {
			this.sendReply(message.adapter, message.sender, text || "⚠️ Unsupported message.");
			return;
		}

		const senderKey = `${message.adapter}:${message.sender}`;

		// Get or create session
		let session = this.sessions.get(senderKey);
		if (!session) {
			session = this.createSession(message);
			this.sessions.set(senderKey, session);
		}

		// Bot commands (only for text-only messages)
		if (text && !hasAttachments && this.config.commands && isCommand(text)) {
			const reply = handleCommand(text, session, this.commandContext());
			if (reply !== null) {
				this.sendReply(message.adapter, message.sender, reply);
				return;
			}
			// Unrecognized command — fall through to agent
		}

		// Queue depth check
		if (session.queue.length >= this.config.maxQueuePerSender) {
			this.sendReply(
				message.adapter,
				message.sender,
				`⚠️ Queue full (${this.config.maxQueuePerSender} pending). ` +
				`Wait for current prompts to finish or use /abort.`,
			);
			return;
		}

		// Enqueue
		const queued: QueuedPrompt = {
			id: nextId(),
			adapter: message.adapter,
			sender: message.sender,
			text: text || "Describe this.",
			attachments: message.attachments,
			metadata: message.metadata,
			enqueuedAt: Date.now(),
		};
		session.queue.push(queued);
		session.messageCount++;

		this.events.emit("bridge:enqueue", {
			id: queued.id, adapter: message.adapter, sender: message.sender,
			queueDepth: session.queue.length,
		});

		this.processNext(senderKey);
	}

	// ── Processing ────────────────────────────────────────────

	private async processNext(senderKey: string): Promise<void> {
		const session = this.sessions.get(senderKey);
		if (!session || session.processing || session.queue.length === 0) return;
		if (this.activeCount >= this.config.maxConcurrent) return;

		session.processing = true;
		this.activeCount++;
		const prompt = session.queue.shift()!;

		// Typing indicator
		const adapter = this.registry.getAdapter(prompt.adapter);
		const typing = this.config.typingIndicators
			? startTyping(adapter, prompt.sender)
			: { stop() {} };

		const ac = new AbortController();
		session.abortController = ac;

		const usePersistent = this.shouldUsePersistent(senderKey);

		this.events.emit("bridge:start", {
			id: prompt.id, adapter: prompt.adapter, sender: prompt.sender,
			text: prompt.text.slice(0, 100),
			persistent: usePersistent,
		});

		try {
			let result;

			if (usePersistent && this.rpcManager) {
				// Persistent mode: use RPC session
				result = await this.runWithRpc(senderKey, prompt, ac.signal);
			} else {
				// Stateless mode: spawn subprocess
				result = await runPrompt({
					prompt: prompt.text,
					cwd: this.cwd,
					timeoutMs: this.config.timeoutMs,
					model: this.config.model,
					signal: ac.signal,
					attachments: prompt.attachments,
					extensions: this.config.extensions,
				});
			}

			typing.stop();

			if (result.ok) {
				this.sendReply(prompt.adapter, prompt.sender, result.response);
			} else if (result.error === "Aborted by user") {
				this.sendReply(prompt.adapter, prompt.sender, "⏹ Aborted.");
			} else {
				const userError = sanitizeError(result.error);
				this.sendReply(
					prompt.adapter, prompt.sender,
					result.response || `❌ ${userError}`,
				);
			}

			this.events.emit("bridge:complete", {
				id: prompt.id, adapter: prompt.adapter, sender: prompt.sender,
				ok: result.ok, durationMs: result.durationMs,
				persistent: usePersistent,
			});
			this.log("bridge-complete", {
				id: prompt.id, adapter: prompt.adapter, ok: result.ok,
				durationMs: result.durationMs, persistent: usePersistent,
			}, result.ok ? "INFO" : "WARN");

		} catch (err: any) {
			typing.stop();
			this.log("bridge-error", { adapter: prompt.adapter, sender: prompt.sender, error: err.message }, "ERROR");
			this.sendReply(prompt.adapter, prompt.sender, `❌ Unexpected error: ${err.message}`);
		} finally {
			session.abortController = null;
			session.processing = false;
			this.activeCount--;

			if (session.queue.length > 0) this.processNext(senderKey);
			this.drainWaiting();
		}
	}

	/** Run a prompt via persistent RPC session. */
	private async runWithRpc(
		senderKey: string,
		prompt: QueuedPrompt,
		signal?: AbortSignal,
	): Promise<import("../types.ts").RunResult> {
		try {
			const rpcSession = await this.rpcManager!.getSession(senderKey);
			return await rpcSession.runPrompt(prompt.text, {
				signal,
				attachments: prompt.attachments,
			});
		} catch (err: any) {
			return {
				ok: false,
				response: "",
				error: err.message,
				durationMs: 0,
				exitCode: 1,
			};
		}
	}

	/** After a slot frees up, check other senders waiting for concurrency. */
	private drainWaiting(): void {
		if (this.activeCount >= this.config.maxConcurrent) return;
		for (const [key, session] of this.sessions) {
			if (!session.processing && session.queue.length > 0) {
				this.processNext(key);
				if (this.activeCount >= this.config.maxConcurrent) break;
			}
		}
	}

	// ── Session management ────────────────────────────────────

	private createSession(message: IncomingMessage): SenderSession {
		return {
			adapter: message.adapter,
			sender: message.sender,
			displayName:
				(message.metadata?.firstName as string) ||
				(message.metadata?.username as string) ||
				message.sender,
			queue: [],
			processing: false,
			abortController: null,
			messageCount: 0,
			startedAt: Date.now(),
		};
	}

	getStats(): {
		active: boolean;
		sessions: number;
		activePrompts: number;
		totalQueued: number;
	} {
		let totalQueued = 0;
		for (const s of this.sessions.values()) totalQueued += s.queue.length;
		return {
			active: this.running,
			sessions: this.sessions.size,
			activePrompts: this.activeCount,
			totalQueued,
		};
	}

	getSessions(): Map<string, SenderSession> {
		return this.sessions;
	}

	// ── Session mode resolution ───────────────────────────────

	/**
	 * Determine if a sender should use persistent (RPC) or stateless mode.
	 * Checks sessionRules first (first match wins), falls back to sessionMode default.
	 */
	private shouldUsePersistent(senderKey: string): boolean {
		for (const rule of this.config.sessionRules) {
			if (globMatch(rule.match, senderKey)) {
				return rule.mode === "persistent";
			}
		}
		return this.config.sessionMode === "persistent";
	}

	// ── Command context ───────────────────────────────────────

	private commandContext(): CommandContext {
		return {
			isPersistent: (sender: string) => {
				// Find the sender key to check mode
				for (const [key, session] of this.sessions) {
					if (session.sender === sender) return this.shouldUsePersistent(key);
				}
				return this.config.sessionMode === "persistent";
			},
			abortCurrent: (sender: string): boolean => {
				for (const session of this.sessions.values()) {
					if (session.sender === sender && session.abortController) {
						session.abortController.abort();
						return true;
					}
				}
				return false;
			},
			clearQueue: (sender: string): void => {
				for (const session of this.sessions.values()) {
					if (session.sender === sender) session.queue.length = 0;
				}
			},
			resetSession: (sender: string): void => {
				for (const [key, session] of this.sessions) {
					if (session.sender === sender) {
						this.sessions.delete(key);
						// Also reset persistent RPC session
						if (this.rpcManager) {
							this.rpcManager.resetSession(key).catch(() => {});
						}
					}
				}
			},
		};
	}

	// ── Reply ─────────────────────────────────────────────────

	private sendReply(adapter: string, recipient: string, text: string): void {
		this.registry.send({ adapter, recipient, text });
	}
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Simple glob matcher supporting `*` (any chars) and `?` (single char).
 * Used for sessionRules pattern matching against "adapter:senderId" keys.
 */
function globMatch(pattern: string, text: string): boolean {
	// Escape regex special chars except * and ?
	const re = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${re}$`).test(text);
}

const MAX_ERROR_LENGTH = 200;

/**
 * Sanitize subprocess error output for end-user display.
 * Strips stack traces, extension crash logs, and long technical details.
 */
function sanitizeError(error: string | undefined): string {
	if (!error) return "Something went wrong. Please try again.";

	// Extract the most meaningful line — skip "Extension error" noise and stack traces
	const lines = error.split("\n").filter(l => l.trim());

	// Find the first line that isn't an extension loading error or stack frame
	const meaningful = lines.find(l =>
		!l.startsWith("Extension error") &&
		!l.startsWith("    at ") &&
		!l.startsWith("node:") &&
		!l.includes("NODE_MODULE_VERSION") &&
		!l.includes("compiled against a different") &&
		!l.includes("Emitted 'error' event")
	);

	const msg = meaningful?.trim() || "Something went wrong. Please try again.";

	return msg.length > MAX_ERROR_LENGTH
		? msg.slice(0, MAX_ERROR_LENGTH) + "…"
		: msg;
}
