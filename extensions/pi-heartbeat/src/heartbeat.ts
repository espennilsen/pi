/**
 * pi-heartbeat — Core heartbeat runner.
 *
 * Periodically runs a health-check prompt as an isolated RPC subprocess.
 * If the agent responds with HEARTBEAT_OK, the result is suppressed.
 * Otherwise, the alert is delivered via pi-channels event bus.
 *
 * Spawns `pi --mode rpc` subprocesses — sends a prompt command via stdin,
 * collects the response from streamed events, then exits gracefully.
 */

import { spawn } from "node:child_process";
import * as readline from "node:readline";
import type { HeartbeatSettings } from "./settings.ts";
import { buildPrompt, readHeartbeatMd, isEffectivelyEmpty } from "./prompt.ts";
import { isStoreReady, getStore } from "./store.ts";

const HEARTBEAT_OK = "HEARTBEAT_OK";

export interface HeartbeatRunResult {
	ok: boolean;
	response: string;
	durationMs: number;
}

type LogFn = (event: string, data: unknown, level?: string) => void;

interface HeartbeatCallbacks {
	onCheck?: () => void;
	onResult?: (result: HeartbeatRunResult) => void;
	onAlert?: (message: string) => void;
	log?: LogFn;
}

export class HeartbeatRunner {
	private settings: HeartbeatSettings;
	private cwd: string;
	private callbacks: HeartbeatCallbacks;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private lastRun: Date | null = null;
	private lastResult: HeartbeatRunResult | null = null;
	private runCount = 0;
	private okCount = 0;
	private alertCount = 0;

	constructor(settings: HeartbeatSettings, cwd: string, callbacks: HeartbeatCallbacks = {}) {
		this.settings = settings;
		this.cwd = cwd;
		this.callbacks = callbacks;
	}

	start(): void {
		if (this.timer) return;
		const ms = this.settings.intervalMinutes * 60_000;
		this.timer = setInterval(() => this.tick(), ms);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	isActive(): boolean {
		return this.timer !== null;
	}

	isRunning(): boolean {
		return this.running;
	}

	getStatus(): {
		active: boolean;
		running: boolean;
		lastRun: Date | null;
		lastResult: HeartbeatRunResult | null;
		runCount: number;
		okCount: number;
		alertCount: number;
		intervalMinutes: number;
	} {
		return {
			active: this.isActive(),
			running: this.running,
			lastRun: this.lastRun,
			lastResult: this.lastResult,
			runCount: this.runCount,
			okCount: this.okCount,
			alertCount: this.alertCount,
			intervalMinutes: this.settings.intervalMinutes,
		};
	}

	updateSettings(settings: HeartbeatSettings): void {
		const wasActive = this.isActive();
		const intervalChanged = this.settings.intervalMinutes !== settings.intervalMinutes;
		this.settings = settings;

		if (wasActive && intervalChanged) {
			this.stop();
			this.start();
		}
	}

	/** Run a heartbeat check immediately. */
	async runNow(): Promise<HeartbeatRunResult> {
		return this.execute();
	}

	private async tick(): Promise<void> {
		if (this.running) return;

		// Check active hours
		if (this.settings.activeHours && !this.inActiveHours()) return;

		// Check HEARTBEAT.md — if it exists but is empty, skip
		const heartbeatMd = readHeartbeatMd(this.cwd);
		if (heartbeatMd !== null && isEffectivelyEmpty(heartbeatMd)) return;

		await this.execute();
	}

	private async execute(): Promise<HeartbeatRunResult> {
		this.running = true;
		this.callbacks.onCheck?.();

		const startTime = Date.now();
		try {
			const prompt = buildPrompt(this.cwd, this.settings.prompt);
			const result = await this.runSubprocess(prompt);

			const response = result.stdout.trim();
			const durationMs = Date.now() - startTime;
			const isOk = response === HEARTBEAT_OK || response.startsWith(HEARTBEAT_OK);

			const runResult: HeartbeatRunResult = { ok: isOk, response, durationMs };
			this.lastRun = new Date();
			this.lastResult = runResult;
			this.runCount++;
			if (isOk) this.okCount++;
			else this.alertCount++;

			// Persist to store
			if (isStoreReady()) {
				try {
					await getStore().insertRun(isOk, response, durationMs);
				} catch { /* ignore store errors */ }
			}

			this.callbacks.onResult?.(runResult);
			this.callbacks.log?.("check", { ok: isOk, durationMs, ...(isOk ? {} : { alert: response }) }, isOk ? "INFO" : "WARN");

			if (!isOk) {
				this.callbacks.onAlert?.(`🫀 Heartbeat:\n\n${response}`);
			} else if (this.settings.showOk) {
				this.callbacks.onAlert?.(`✅ ${HEARTBEAT_OK}`);
			}

			return runResult;
		} catch (err: any) {
			const durationMs = Date.now() - startTime;
			const runResult: HeartbeatRunResult = {
				ok: false,
				response: `Error: ${err.message}`,
				durationMs,
			};
			this.lastRun = new Date();
			this.lastResult = runResult;
			this.runCount++;
			this.alertCount++;

			// Persist to store
			if (isStoreReady()) {
				try {
					await getStore().insertRun(false, runResult.response, durationMs);
				} catch { /* ignore store errors */ }
			}

			this.callbacks.onResult?.(runResult);
			this.callbacks.log?.("error", { alert: err.message, durationMs }, "ERROR");
			this.callbacks.onAlert?.(`🫀 Heartbeat error: ${err.message}`);
			return runResult;
		} finally {
			this.running = false;
		}
	}

	private buildArgs(): string[] {
		const args = ["--mode", "rpc"];

		// Extension loading: -ne disables discovery, then -e for each explicit extension
		const exts = this.settings.extensions;
		args.push("-ne");
		if (exts && exts.length > 0) {
			for (const ext of exts) {
				args.push("-e", ext);
			}
		}

		return args;
	}

	private runSubprocess(prompt: string, timeoutMs = 300_000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return new Promise((resolve) => {
			const args = this.buildArgs();
			const child = spawn("pi", args, {
				cwd: this.cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env },
			});

			let responseText = "";
			let stderr = "";
			let settled = false;
			let killTimer: ReturnType<typeof setTimeout> | null = null;

			// Parse JSON-line events from RPC stdout
			const rl = readline.createInterface({ input: child.stdout });

			function settle(result: { stdout: string; stderr: string; exitCode: number }): void {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				rl.close();
				resolve(result);
			}

			const timeout = setTimeout(() => {
				child.kill("SIGTERM");
				// Force kill if SIGTERM is ignored — unref so it doesn't block exit
				killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5_000);
				killTimer.unref();
				settle({ stdout: responseText, stderr: stderr + "\nHeartbeat timed out", exitCode: 1 });
			}, timeoutMs);

			child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
			child.stdin.on("error", () => { /* ignore EPIPE / ERR_STREAM_DESTROYED */ });

			rl.on("line", (line) => {
				try {
					const event = JSON.parse(line);

					// Collect text deltas from assistant message streaming
					if (event.type === "message_update") {
						const delta = event.assistantMessageEvent;
						if (delta?.type === "text_delta" && delta.delta) {
							responseText += delta.delta;
						}
					}

					// Agent finished — kill the subprocess
					if (event.type === "agent_end") {
						child.stdin.end();
						child.kill("SIGTERM");
					}
				} catch {
					// Ignore non-JSON lines
				}
			});

			// Send the prompt once the child process has spawned
			const promptCmd = JSON.stringify({ type: "prompt", message: prompt }) + "\n";
			child.once("spawn", () => {
				child.stdin.write(promptCmd);
			});

			child.on("close", (code) => {
				if (killTimer) { clearTimeout(killTimer); killTimer = null; }
				settle({ stdout: responseText, stderr, exitCode: code ?? 0 });
			});

			child.on("error", (err) => {
				if (killTimer) { clearTimeout(killTimer); killTimer = null; }
				settle({ stdout: responseText, stderr: stderr + "\n" + err.message, exitCode: 1 });
			});
		});
	}

	private inActiveHours(): boolean {
		const { start, end } = this.settings.activeHours!;
		const now = new Date();
		const currentMinutes = now.getHours() * 60 + now.getMinutes();

		const [startH, startM] = start.split(":").map(Number);
		const [endH, endM] = end.split(":").map(Number);
		const startMinutes = startH * 60 + startM;
		const endMinutes = endH * 60 + endM;

		return currentMinutes >= startMinutes && currentMinutes < endMinutes;
	}
}
