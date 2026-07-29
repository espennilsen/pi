/**
 * pi-subagent — RPC subprocess wrapper.
 *
 * Wraps a single `pi --mode rpc` subprocess. Manages the JSON protocol
 * over stdin/stdout, tracks state, and provides prompt/kill lifecycle.
 *
 * Unlike runner.ts (one-shot, --mode json), RpcAgent stays alive between
 * prompts and accumulates context across interactions.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { RpcAgentState, UsageStats } from "./types.ts";

export interface RpcAgentOpts {
	/** Working directory for the subprocess */
	cwd: string;
	/** Model override (e.g. "claude-haiku-4-5") */
	model?: string;
	/** Tool list (comma-separated) or undefined for defaults */
	tools?: string;
	/** Disable all built-in tools */
	noTools?: boolean;
	/** Extension paths to load (runs with -ne, only whitelisted) */
	extensions?: string[];
	/** Skill files/dirs to load */
	skills?: string[];
	/** Disable skill discovery */
	noSkills?: boolean;
	/** Thinking level */
	thinking?: string;
	/** System prompt to append */
	systemPrompt?: string;
	/** Environment variables to pass to subprocess */
	env?: Record<string, string>;
	/** Timeout for individual prompts (ms) */
	promptTimeoutMs?: number;
}

export interface RpcPromptResult {
	/** Final text response from the assistant */
	response: string;
	/** All messages generated during this prompt */
	messages: any[];
	/** Token usage for this prompt */
	usage: UsageStats;
	/** Model used */
	model: string | null;
	/** Stop reason */
	stopReason: string | null;
	/** Error message if any */
	errorMessage: string | null;
}

// ── Temp file management (for system prompt) ────────────────────

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function writeTempFile(label: string, content: string): { dir: string; path: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rpc-"));
	const safe = label.replace(/[^\w.-]+/g, "_");
	const fp = path.join(dir, `prompt-${safe}.md`);
	fs.writeFileSync(fp, content, { encoding: "utf-8", mode: 0o600 });
	return { dir, path: fp };
}

// ── RpcAgent class ──────────────────────────────────────────────

export class RpcAgent {
	readonly id: string;
	private proc: ChildProcess | null = null;
	private opts: RpcAgentOpts;
	private tmpDir: string | null = null;
	private tmpPath: string | null = null;
	private buffer = "";
	private state_: RpcAgentState = "starting";
	private usage_: UsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
	private model_: string | null = null;
	private stderr_ = "";

	/** Resolves when the current prompt completes (agent_end received) */
	private promptResolve: ((result: RpcPromptResult) => void) | null = null;
	private promptReject: ((err: Error) => void) | null = null;

	/** Messages collected during the current prompt */
	private currentMessages: any[] = [];
	private currentTextParts: string[] = [];
	private currentUsage: UsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
	private currentModel: string | null = null;
	private currentStopReason: string | null = null;
	private currentErrorMessage: string | null = null;

	/** Callback for streaming progress */
	onMessage?: (msg: any) => void;

	get state(): RpcAgentState { return this.state_; }
	get usage(): UsageStats { return { ...this.usage_ }; }
	get model(): string | null { return this.model_; }

	constructor(id: string, opts: RpcAgentOpts) {
		this.id = id;
		this.opts = opts;
	}

	/** Spawn the RPC subprocess. Must be called before prompt(). */
	async start(): Promise<void> {
		if (this.proc) throw new Error(`RpcAgent ${this.id} already started`);

		const args = ["--mode", "rpc", "--no-session", "-ne"];

		if (this.opts.extensions?.length) {
			for (const ext of this.opts.extensions) {
				args.push("-e", ext);
			}
		}

		if (this.opts.model) args.push("--model", this.opts.model);
		if (this.opts.noTools) args.push("--no-tools");
		else if (this.opts.tools) args.push("--tools", this.opts.tools);
		if (this.opts.noSkills) args.push("-ns");
		if (this.opts.skills?.length) {
			for (const skill of this.opts.skills) {
				args.push("--skill", skill);
			}
		}
		if (this.opts.thinking) args.push("--thinking", this.opts.thinking);

		if (this.opts.systemPrompt?.trim()) {
			const tmp = writeTempFile(this.id, this.opts.systemPrompt);
			this.tmpDir = tmp.dir;
			this.tmpPath = tmp.path;
			args.push("--append-system-prompt", tmp.path);
		}

		const env = { ...process.env, ...(this.opts.env ?? {}) };

		this.proc = spawn("pi", args, {
			cwd: this.opts.cwd,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
			env,
		});

		this.proc.stdout!.on("data", (data: Buffer) => {
			this.buffer += data.toString();
			const lines = this.buffer.split("\n");
			this.buffer = lines.pop() || "";
			for (const line of lines) this.processLine(line);
		});

		this.proc.stderr!.on("data", (data: Buffer) => {
			this.stderr_ += data.toString();
		});

		this.proc.on("close", (code) => {
			this.state_ = "dead";
			if (this.promptReject) {
				const stderrSuffix = this.stderr_.trim() ? `\n${this.stderr_.trim()}` : "";
				this.promptReject(new Error(`RPC agent ${this.id} exited with code ${code}${stderrSuffix}`));
				this.promptResolve = null;
				this.promptReject = null;
			}
		});

		this.proc.on("error", (err) => {
			this.state_ = "dead";
			if (this.promptReject) {
				this.promptReject(err);
				this.promptResolve = null;
				this.promptReject = null;
			}
		});

		this.state_ = "idle";
	}

	/** Send a prompt and wait for completion (agent_end). */
	async prompt(message: string): Promise<RpcPromptResult> {
		if (!this.proc || this.state_ === "dead") {
			throw new Error(`RpcAgent ${this.id} is not running`);
		}
		if (this.state_ === "streaming") {
			throw new Error(`RpcAgent ${this.id} is already processing a prompt`);
		}

		// Reset per-prompt state
		this.currentMessages = [];
		this.currentTextParts = [];
		this.currentUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
		this.currentModel = null;
		this.currentStopReason = null;
		this.currentErrorMessage = null;

		this.state_ = "streaming";

		const timeoutMs = this.opts.promptTimeoutMs ?? 600_000;

		return new Promise<RpcPromptResult>((resolve, reject) => {
			this.promptResolve = resolve;
			this.promptReject = reject;

			// Send the prompt command
			const cmd = JSON.stringify({ type: "prompt", message }) + "\n";
			this.proc!.stdin!.write(cmd);

			// Timeout
			if (timeoutMs > 0) {
				let graceTimer: ReturnType<typeof setTimeout> | null = null;
				const timer = setTimeout(() => {
					if (this.state_ === "streaming") {
						// Abort the current operation
						this.proc!.stdin!.write(JSON.stringify({ type: "abort" }) + "\n");
						// Give it a moment to abort gracefully
						graceTimer = setTimeout(() => {
							if (this.promptReject) {
								this.promptReject(new Error(`Prompt timed out after ${timeoutMs}ms`));
								this.promptResolve = null;
								this.promptReject = null;
								this.state_ = "idle";
							}
						}, 5000);
					}
				}, timeoutMs);
				timer.unref();

				// Clear timeouts when prompt completes
				const origResolve = this.promptResolve;
				this.promptResolve = (result) => {
					clearTimeout(timer);
					if (graceTimer) clearTimeout(graceTimer);
					origResolve(result);
				};
				const origReject = this.promptReject;
				this.promptReject = (err) => {
					clearTimeout(timer);
					if (graceTimer) clearTimeout(graceTimer);
					origReject(err);
				};
			}
		});
	}

	/** Kill the subprocess. */
	kill(): void {
		if (this.proc && this.state_ !== "dead") {
			this.proc.kill("SIGTERM");
			const killTimer = setTimeout(() => {
				if (this.proc && !this.proc.killed) this.proc.kill("SIGKILL");
			}, 5000);
			killTimer.unref();
		}
		this.cleanup();
	}

	/** Clean up temp files. */
	private cleanup(): void {
		if (this.tmpPath) { try { fs.unlinkSync(this.tmpPath); } catch { /* ignore */ } this.tmpPath = null; }
		if (this.tmpDir) { try { fs.rmdirSync(this.tmpDir); } catch { /* ignore */ } this.tmpDir = null; }
	}

	/** Process a JSON line from the RPC subprocess stdout. */
	private processLine(line: string): void {
		if (!line.trim()) return;
		let ev: any;
		try { ev = JSON.parse(line); } catch { return; }

		// RPC response to our prompt command — just acknowledge
		if (ev.type === "response") return;

		// message_end — collect assistant messages
		if (ev.type === "message_end" && ev.message) {
			const msg = ev.message;
			this.currentMessages.push(msg);

			if (msg.role === "assistant") {
				this.currentUsage.turns++;
				const u = msg.usage;
				if (u) {
					this.currentUsage.input += u.input || 0;
					this.currentUsage.output += u.output || 0;
					this.currentUsage.cacheRead += u.cacheRead || 0;
					this.currentUsage.cacheWrite += u.cacheWrite || 0;
					if (u.cost) {
						this.currentUsage.cost += (u.cost.input || 0) + (u.cost.output || 0) +
							(u.cost.cacheRead || 0) + (u.cost.cacheWrite || 0);
					}
				}
				if (!this.currentModel && msg.model) this.currentModel = msg.model;
				if (msg.stopReason) this.currentStopReason = msg.stopReason;
				if (msg.errorMessage) this.currentErrorMessage = msg.errorMessage;

				if (Array.isArray(msg.content)) {
					for (const block of msg.content) {
						if (block.type === "text") this.currentTextParts.push(block.text);
					}
				}
			}

			this.onMessage?.(msg);
		}

		// tool_result_end — collect tool results
		if (ev.type === "tool_execution_end" && ev.result) {
			this.currentMessages.push({
				role: "toolResult",
				toolCallId: ev.toolCallId,
				toolName: ev.toolName,
				content: ev.result.content,
				isError: ev.isError ?? false,
			});
			this.onMessage?.({ role: "toolResult", toolCallId: ev.toolCallId, toolName: ev.toolName });
		}

		// agent_end — prompt is complete
		if (ev.type === "agent_end") {
			// Accumulate into lifetime usage
			this.usage_.input += this.currentUsage.input;
			this.usage_.output += this.currentUsage.output;
			this.usage_.cacheRead += this.currentUsage.cacheRead;
			this.usage_.cacheWrite += this.currentUsage.cacheWrite;
			this.usage_.cost += this.currentUsage.cost;
			this.usage_.contextTokens += this.currentUsage.contextTokens;
			this.usage_.turns += this.currentUsage.turns;
			if (this.currentModel) this.model_ = this.currentModel;

			this.state_ = "idle";

			if (this.promptResolve) {
				const result: RpcPromptResult = {
					response: this.currentTextParts.join("") || "(no response)",
					messages: this.currentMessages,
					usage: { ...this.currentUsage },
					model: this.currentModel,
					stopReason: this.currentStopReason,
					errorMessage: this.currentErrorMessage,
				};
				this.promptResolve(result);
				this.promptResolve = null;
				this.promptReject = null;
			}
		}
	}
}
