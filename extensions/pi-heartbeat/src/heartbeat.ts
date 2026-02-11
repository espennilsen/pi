/**
 * pi-heartbeat — Core heartbeat runner.
 *
 * Periodically runs a health-check prompt as an isolated subprocess.
 * If the agent responds with HEARTBEAT_OK, the result is suppressed.
 * Otherwise, the alert is delivered via pi-channels event bus.
 *
 * Spawns `pi -p --no-session` subprocesses (same pattern as pi-cron/pi-subagent).
 */

import { spawn } from "node:child_process";
import type { HeartbeatSettings } from "./settings.ts";
import { buildPrompt, readHeartbeatMd, isEffectivelyEmpty } from "./prompt.ts";

const HEARTBEAT_OK = "HEARTBEAT_OK";

export interface HeartbeatRunResult {
	ok: boolean;
	response: string;
	durationMs: number;
}

interface HeartbeatCallbacks {
	onCheck?: () => void;
	onResult?: (result: HeartbeatRunResult) => void;
	onAlert?: (message: string) => void;
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

			this.callbacks.onResult?.(runResult);

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

			this.callbacks.onResult?.(runResult);
			this.callbacks.onAlert?.(`🫀 Heartbeat error: ${err.message}`);
			return runResult;
		} finally {
			this.running = false;
		}
	}

	private runSubprocess(prompt: string, timeoutMs = 300_000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return new Promise((resolve) => {
			const child = spawn("pi", ["-p", "--no-session", prompt], {
				cwd: this.cwd,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
				timeout: timeoutMs,
			});

			let stdout = "";
			let stderr = "";

			child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
			child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

			child.on("close", (code) => {
				resolve({ stdout, stderr, exitCode: code ?? 1 });
			});

			child.on("error", (err) => {
				resolve({ stdout, stderr: stderr + "\n" + err.message, exitCode: 1 });
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
