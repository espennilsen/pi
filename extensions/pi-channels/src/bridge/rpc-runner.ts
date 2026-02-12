/**
 * pi-channels — Persistent RPC session runner.
 *
 * Maintains a long-lived `pi --mode rpc` subprocess per sender,
 * enabling persistent conversation context across messages.
 * Falls back to stateless runner if RPC fails to start.
 *
 * Lifecycle:
 *   1. First message from a sender spawns a new RPC subprocess
 *   2. Subsequent messages reuse the same subprocess (session persists)
 *   3. /new command or idle timeout restarts the session
 *   4. Subprocess crash triggers auto-restart on next message
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import type { RunResult, IncomingAttachment } from "../types.ts";

export interface RpcRunnerOptions {
	cwd: string;
	model?: string | null;
	timeoutMs: number;
	extensions?: string[];
}

interface PendingRequest {
	resolve: (result: RunResult) => void;
	startTime: number;
	timer: ReturnType<typeof setTimeout>;
	textChunks: string[];
	abortHandler?: () => void;
}

/**
 * A persistent RPC session for a single sender.
 * Wraps a `pi --mode rpc` subprocess.
 */
export class RpcSession {
	private child: ChildProcess | null = null;
	private rl: readline.Interface | null = null;
	private options: RpcRunnerOptions;
	private pending: PendingRequest | null = null;
	private ready = false;
	private startedAt = 0;
	private _onStreaming: ((text: string) => void) | null = null;

	constructor(options: RpcRunnerOptions) {
		this.options = options;
	}

	/** Spawn the RPC subprocess if not already running. */
	async start(): Promise<boolean> {
		if (this.child && this.ready) return true;
		this.cleanup();

		const args = ["--mode", "rpc", "--no-extensions"];
		if (this.options.model) args.push("--model", this.options.model);

		if (this.options.extensions?.length) {
			for (const ext of this.options.extensions) {
				args.push("-e", ext);
			}
		}

		try {
			this.child = spawn("pi", args, {
				cwd: this.options.cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env },
			});
		} catch {
			return false;
		}

		if (!this.child.stdout || !this.child.stdin) {
			this.cleanup();
			return false;
		}

		this.rl = readline.createInterface({ input: this.child.stdout });
		this.rl.on("line", (line) => this.handleLine(line));

		this.child.on("close", () => {
			this.ready = false;
			// Reject any pending request
			if (this.pending) {
				const p = this.pending;
				this.pending = null;
				clearTimeout(p.timer);
				const text = p.textChunks.join("");
				p.resolve({
					ok: false,
					response: text || "(session ended)",
					error: "RPC subprocess exited unexpectedly",
					durationMs: Date.now() - p.startTime,
					exitCode: 1,
				});
			}
			this.child = null;
			this.rl = null;
		});

		this.child.on("error", () => {
			this.cleanup();
		});

		this.ready = true;
		this.startedAt = Date.now();
		return true;
	}

	/** Send a prompt and collect the full response. */
	runPrompt(
		prompt: string,
		options?: {
			signal?: AbortSignal;
			attachments?: IncomingAttachment[];
			onStreaming?: (text: string) => void;
		},
	): Promise<RunResult> {
		return new Promise(async (resolve) => {
			// Ensure subprocess is running
			if (!this.ready) {
				const ok = await this.start();
				if (!ok) {
					resolve({
						ok: false,
						response: "",
						error: "Failed to start RPC session",
						durationMs: 0,
						exitCode: 1,
					});
					return;
				}
			}

			const startTime = Date.now();
			this._onStreaming = options?.onStreaming ?? null;

			// Timeout
			const timer = setTimeout(() => {
				if (this.pending) {
					const p = this.pending;
					this.pending = null;
					const text = p.textChunks.join("");
					p.resolve({
						ok: false,
						response: text || "(timed out)",
						error: "Timeout",
						durationMs: Date.now() - p.startTime,
						exitCode: 124,
					});
					// Kill and restart on next message
					this.cleanup();
				}
			}, this.options.timeoutMs);

			this.pending = { resolve, startTime, timer, textChunks: [] };

			// Abort handler
			const onAbort = () => {
				this.sendCommand({ type: "abort" });
			};
			if (options?.signal) {
				if (options.signal.aborted) {
					clearTimeout(timer);
					this.pending = null;
					this.sendCommand({ type: "abort" });
					resolve({
						ok: false,
						response: "(aborted)",
						error: "Aborted by user",
						durationMs: Date.now() - startTime,
						exitCode: 130,
					});
					return;
				}
				options.signal.addEventListener("abort", onAbort, { once: true });
				this.pending.abortHandler = () =>
					options.signal?.removeEventListener("abort", onAbort);
			}

			// Build prompt command
			const cmd: Record<string, unknown> = {
				type: "prompt",
				message: prompt,
			};

			// Attach images as base64
			if (options?.attachments?.length) {
				const images: Array<Record<string, string>> = [];
				for (const att of options.attachments) {
					if (att.type === "image") {
						try {
							const fs = await import("node:fs");
							const data = fs.readFileSync(att.path).toString("base64");
							images.push({
								type: "image",
								data,
								mimeType: att.mimeType || "image/jpeg",
							});
						} catch {
							// Skip unreadable attachments
						}
					}
				}
				if (images.length > 0) cmd.images = images;
			}

			this.sendCommand(cmd);
		});
	}

	/** Request a new session (clear context). */
	async newSession(): Promise<void> {
		if (this.ready) {
			this.sendCommand({ type: "new_session" });
		}
	}

	/** Check if the subprocess is alive. */
	isAlive(): boolean {
		return this.ready && this.child !== null;
	}

	/** Get uptime in ms. */
	uptime(): number {
		return this.ready ? Date.now() - this.startedAt : 0;
	}

	/** Kill the subprocess. */
	cleanup(): void {
		this.ready = false;
		this._onStreaming = null;
		if (this.pending) {
			clearTimeout(this.pending.timer);
			this.pending.abortHandler?.();
			this.pending = null;
		}
		if (this.rl) {
			this.rl.close();
			this.rl = null;
		}
		if (this.child) {
			this.child.kill("SIGTERM");
			setTimeout(() => {
				if (this.child && !this.child.killed) this.child.kill("SIGKILL");
			}, 3000);
			this.child = null;
		}
	}

	// ── Private ─────────────────────────────────────────────

	private sendCommand(cmd: Record<string, unknown>): void {
		if (!this.child?.stdin?.writable) return;
		this.child.stdin.write(JSON.stringify(cmd) + "\n");
	}

	private handleLine(line: string): void {
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}

		const type = event.type as string;

		// Streaming text deltas
		if (type === "message_update") {
			const delta = event.assistantMessageEvent as Record<string, unknown> | undefined;
			if (delta?.type === "text_delta" && typeof delta.delta === "string") {
				if (this.pending) this.pending.textChunks.push(delta.delta);
				if (this._onStreaming) this._onStreaming(delta.delta);
			}
		}

		// Agent finished — resolve the pending promise
		if (type === "agent_end") {
			if (this.pending) {
				const p = this.pending;
				this.pending = null;
				this._onStreaming = null;
				clearTimeout(p.timer);
				p.abortHandler?.();
				const text = p.textChunks.join("").trim();
				p.resolve({
					ok: true,
					response: text || "(no output)",
					durationMs: Date.now() - p.startTime,
					exitCode: 0,
				});
			}
		}

		// Handle errors in message_update (aborted, error)
		if (type === "message_update") {
			const delta = event.assistantMessageEvent as Record<string, unknown> | undefined;
			if (delta?.type === "done" && delta.reason === "error") {
				if (this.pending) {
					const p = this.pending;
					this.pending = null;
					this._onStreaming = null;
					clearTimeout(p.timer);
					p.abortHandler?.();
					const text = p.textChunks.join("").trim();
					p.resolve({
						ok: false,
						response: text || "",
						error: "Agent error",
						durationMs: Date.now() - p.startTime,
						exitCode: 1,
					});
				}
			}
		}

		// Prompt response (just ack, actual result comes via agent_end)
		// Response errors
		if (type === "response") {
			const success = event.success as boolean;
			if (!success && this.pending) {
				const p = this.pending;
				this.pending = null;
				this._onStreaming = null;
				clearTimeout(p.timer);
				p.abortHandler?.();
				p.resolve({
					ok: false,
					response: "",
					error: (event.error as string) || "RPC command failed",
					durationMs: Date.now() - p.startTime,
					exitCode: 1,
				});
			}
		}
	}
}

/**
 * Manages RPC sessions across multiple senders.
 * Each sender gets their own persistent subprocess.
 */
export class RpcSessionManager {
	private sessions = new Map<string, RpcSession>();
	private options: RpcRunnerOptions;
	private idleTimeoutMs: number;
	private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(
		options: RpcRunnerOptions,
		idleTimeoutMs = 30 * 60_000, // 30 min default
	) {
		this.options = options;
		this.idleTimeoutMs = idleTimeoutMs;
	}

	/** Get or create a session for a sender. */
	async getSession(senderKey: string): Promise<RpcSession> {
		let session = this.sessions.get(senderKey);
		if (session && session.isAlive()) {
			this.resetIdleTimer(senderKey);
			return session;
		}

		// Clean up dead session
		if (session) {
			session.cleanup();
			this.sessions.delete(senderKey);
		}

		// Create new
		session = new RpcSession(this.options);
		const ok = await session.start();
		if (!ok) throw new Error("Failed to start RPC session");

		this.sessions.set(senderKey, session);
		this.resetIdleTimer(senderKey);
		return session;
	}

	/** Reset a sender's session (new conversation). */
	async resetSession(senderKey: string): Promise<void> {
		const session = this.sessions.get(senderKey);
		if (session) {
			await session.newSession();
		}
	}

	/** Kill a specific sender's session. */
	killSession(senderKey: string): void {
		const session = this.sessions.get(senderKey);
		if (session) {
			session.cleanup();
			this.sessions.delete(senderKey);
		}
		const timer = this.idleTimers.get(senderKey);
		if (timer) {
			clearTimeout(timer);
			this.idleTimers.delete(senderKey);
		}
	}

	/** Kill all sessions. */
	killAll(): void {
		for (const [key, session] of this.sessions) {
			session.cleanup();
		}
		this.sessions.clear();
		for (const timer of this.idleTimers.values()) {
			clearTimeout(timer);
		}
		this.idleTimers.clear();
	}

	/** Get stats. */
	getStats(): { activeSessions: number; senders: string[] } {
		return {
			activeSessions: this.sessions.size,
			senders: [...this.sessions.keys()],
		};
	}

	private resetIdleTimer(senderKey: string): void {
		const existing = this.idleTimers.get(senderKey);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this.killSession(senderKey);
		}, this.idleTimeoutMs);

		this.idleTimers.set(senderKey, timer);
	}
}
