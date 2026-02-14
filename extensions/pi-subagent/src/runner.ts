/**
 * pi-subagent — Isolated agent runner.
 *
 * Spawns `pi` subprocesses in JSON mode for complete isolation.
 * Each run gets a fresh context — no shared state with the parent session.
 *
 * Captures full Message[] for rich rendering of subagent work.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RunnerResult } from "./types.ts";

export interface RunnerOpts {
	prompt: string;
	cwd?: string;
	model?: string;
	provider?: string;
	tools?: string;
	/** Disable all built-in tools (--no-tools) */
	noTools?: boolean;
	/** Skill files/dirs to load via --skill */
	skills?: string[];
	/** Disable skill discovery (--no-skills / -ns) */
	noSkills?: boolean;
	/** Thinking level: off, minimal, low, medium, high, xhigh */
	thinking?: string;
	systemPrompt?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	/** Called after every message_end / tool_result_end event */
	onMessage?: (msg: any) => void;
	/**
	 * Extension paths to load via -e flags.
	 * Always runs with --no-extensions (-ne) to prevent subagents
	 * from loading all extensions (including pi-subagent).
	 */
	extensions?: string[];
}

// ── Temp file management ────────────────────────────────────────

function writeTempPrompt(
	label: string,
	content: string,
): { dir: string; path: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-isolated-"));
	const safe = label.replace(/[^\w.-]+/g, "_");
	const fp = path.join(dir, `prompt-${safe}.md`);
	fs.writeFileSync(fp, content, { encoding: "utf-8", mode: 0o600 });
	return { dir, path: fp };
}

// ── Core runner ─────────────────────────────────────────────────

export async function runIsolatedAgent(
	opts: RunnerOpts,
): Promise<RunnerResult> {
	const startTime = Date.now();
	const args = ["--mode", "json", "-p", "--no-session", "-ne"];

	// Whitelist specific extensions via -e (subagents never get full extension discovery)
	if (opts.extensions?.length) {
		for (const ext of opts.extensions) {
			args.push("-e", ext);
		}
	}

	if (opts.model) args.push("--model", opts.model);
	if (opts.provider) args.push("--provider", opts.provider);
	if (opts.noTools) args.push("--no-tools");
	else if (opts.tools) args.push("--tools", opts.tools);
	if (opts.noSkills) args.push("-ns");
	if (opts.skills?.length) {
		for (const skill of opts.skills) {
			args.push("--skill", skill);
		}
	}
	if (opts.thinking) args.push("--thinking", opts.thinking);

	let tmpDir: string | null = null;
	let tmpPath: string | null = null;

	// Accumulators
	const messages: any[] = [];
	const textParts: string[] = [];
	let turnCount = 0;
	let toolCallCount = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	let costInput = 0;
	let costOutput = 0;
	let costCacheRead = 0;
	let costCacheWrite = 0;
	let model: string | null = null;
	let stopReason: string | null = null;
	let errorMessage: string | null = null;
	let stderr = "";

	try {
		if (opts.systemPrompt?.trim()) {
			const tmp = writeTempPrompt("system", opts.systemPrompt);
			tmpDir = tmp.dir;
			tmpPath = tmp.path;
			args.push("--append-system-prompt", tmpPath);
		}

		args.push(opts.prompt);
		let aborted = false;
		let timedOut = false;

		const exitCode = await new Promise<number>((resolve) => {
			const proc = spawn("pi", args, {
				cwd: opts.cwd ?? process.cwd(),
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			const timeoutMs = opts.timeoutMs ?? 600_000;
			const timeoutHandle =
				timeoutMs > 0
					? setTimeout(() => {
							timedOut = true;
							proc.kill("SIGTERM");
							const killTimer = setTimeout(() => {
								if (!proc.killed) proc.kill("SIGKILL");
							}, 5000);
							killTimer.unref();
						}, timeoutMs)
					: null;
			if (timeoutHandle) (timeoutHandle as any).unref?.();
			let buf = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let ev: any;
				try {
					ev = JSON.parse(line);
				} catch {
					return;
				}

				if (ev.type === "message_end" && ev.message) {
					const msg = ev.message;
					messages.push(msg);

					if (msg.role === "assistant") {
						turnCount++;
						const u = msg.usage;
						if (u) {
							inputTokens += u.input || 0;
							outputTokens += u.output || 0;
							cacheReadTokens += u.cacheRead || 0;
							cacheWriteTokens += u.cacheWrite || 0;
							if (u.cost) {
								costInput += u.cost.input || 0;
								costOutput += u.cost.output || 0;
								costCacheRead += u.cost.cacheRead || 0;
								costCacheWrite += u.cost.cacheWrite || 0;
							}
						}
						if (!model && msg.model) model = msg.model;
						if (msg.stopReason) stopReason = msg.stopReason;
						if (msg.errorMessage) errorMessage = msg.errorMessage;

						if (Array.isArray(msg.content)) {
							for (const block of msg.content) {
								if (block.type === "text") textParts.push(block.text);
							}
						}
					}

					opts.onMessage?.(msg);
				}

				if (ev.type === "tool_result_end" && ev.message) {
					messages.push(ev.message);
					toolCallCount++;
					opts.onMessage?.(ev.message);
				}
			};

			proc.stdout.on("data", (data: Buffer) => {
				buf += data.toString();
				const lines = buf.split("\n");
				buf = lines.pop() || "";
				for (const l of lines) processLine(l);
			});

			proc.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			// Abort signal handling — clean up listener on process close
			let abortHandler: (() => void) | null = null;
			if (opts.signal) {
				abortHandler = () => {
					aborted = true;
					proc.kill("SIGTERM");
					const killTimer = setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
					killTimer.unref();
				};
				if (opts.signal.aborted) abortHandler();
				else opts.signal.addEventListener("abort", abortHandler, { once: true });
			}

			proc.on("close", (code) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (abortHandler && opts.signal) opts.signal.removeEventListener("abort", abortHandler);
				if (buf.trim()) processLine(buf);
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				if (abortHandler && opts.signal) opts.signal.removeEventListener("abort", abortHandler);
				resolve(1);
			});
		});

		const durationMs = Date.now() - startTime;
		const totalTokens = inputTokens + outputTokens;
		const costTotal = costInput + costOutput + costCacheRead + costCacheWrite;

		const mkResult = (response: string, code: number): RunnerResult => ({
			response,
			messages,
			exitCode: code,
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheWriteTokens,
			totalTokens,
			costInput,
			costOutput,
			costCacheRead,
			costCacheWrite,
			costTotal,
			toolCallCount,
			turnCount,
			durationMs,
			model,
			stopReason,
			errorMessage,
			stderr,
		});

		if (timedOut) return mkResult("(timed out)", 1);
		if (aborted) return mkResult("(aborted)", 1);
		return mkResult(textParts.join("") || "(no response)", exitCode);
	} finally {
		if (tmpPath) try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
		if (tmpDir) try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
	}
}
