/**
 * pi-cron — Lightweight cron scheduler.
 *
 * Ticks every 30s and matches 5-field cron expressions against local time.
 * Watches the crontab file for changes and reloads automatically.
 * Jobs run as isolated `pi -p` subprocesses.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { loadJobs, getTabPath, type CronJob } from "./crontab.ts";
import type { CronSettings } from "./settings.ts";

// ── Cron field parser ───────────────────────────────────────────

function parseField(field: string, min: number, max: number): Set<number> {
	const values = new Set<number>();

	for (const part of field.split(",")) {
		const [rangeStr, stepStr] = part.split("/");
		const step = stepStr ? parseInt(stepStr, 10) : 1;

		if (step < 1 || isNaN(step)) {
			throw new Error(`Invalid step "${stepStr}" in field "${field}"`);
		}

		let lo: number, hi: number;

		if (rangeStr === "*") {
			lo = min;
			hi = max;
		} else if (rangeStr.includes("-")) {
			const [a, b] = rangeStr.split("-");
			lo = parseInt(a, 10);
			hi = parseInt(b, 10);
		} else {
			lo = parseInt(rangeStr, 10);
			hi = lo;
		}

		if (isNaN(lo) || isNaN(hi)) {
			throw new Error(`Invalid value in field "${field}"`);
		}
		if (lo < min || hi > max) {
			throw new Error(`Value out of range in "${field}" (allowed ${min}-${max})`);
		}

		for (let i = lo; i <= hi; i += step) {
			values.add(i);
		}
	}

	return values;
}

function matchesCron(expr: string, date: Date): boolean {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) {
		throw new Error(`Invalid cron expression (need 5 fields): "${expr}"`);
	}

	return (
		parseField(fields[0], 0, 59).has(date.getMinutes()) &&
		parseField(fields[1], 0, 23).has(date.getHours()) &&
		parseField(fields[2], 1, 31).has(date.getDate()) &&
		parseField(fields[3], 1, 12).has(date.getMonth() + 1) &&
		parseField(fields[4], 0, 6).has(date.getDay())
	);
}

export function validateCron(expr: string): string | null {
	try {
		matchesCron(expr, new Date());
		return null;
	} catch (err: any) {
		return err.message;
	}
}

// ── Subprocess runner ───────────────────────────────────────────

interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

function runPiSubprocess(prompt: string, cwd: string, extensions: string[] = [], timeoutMs = 600_000): Promise<RunResult> {
	return new Promise((resolve) => {
		const args = ["-p", "--no-session", "--no-extensions"];
		for (const ext of extensions) {
			args.push("-e", ext);
		}
		args.push(prompt);

		const child = spawn("pi", args, {
			cwd,
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

// ── Events emitted by scheduler ─────────────────────────────────

export interface CronJobEvent {
	job: CronJob;
	startedAt: Date;
}

export interface CronJobCompleteEvent extends CronJobEvent {
	durationMs: number;
	ok: boolean;
	response?: string;
	error?: string;
}

type LogFn = (event: string, data: unknown, level?: string) => void;

export type CronEventHandler = {
	onJobStart?: (event: CronJobEvent) => void;
	onJobComplete?: (event: CronJobCompleteEvent) => void;
	onReload?: (jobs: CronJob[]) => void;
	log?: LogFn;
};

// ── Scheduler ───────────────────────────────────────────────────

const TICK_INTERVAL_MS = 30_000;

export class CronScheduler {
	private cwd: string;
	private timer: ReturnType<typeof setInterval> | null = null;
	private watcher: fs.FSWatcher | null = null;
	private lastTickMinute = "";
	private running = new Set<string>();
	private jobs: CronJob[] = [];
	private handlers: CronEventHandler;
	private settings: CronSettings;

	constructor(cwd: string, settings: CronSettings, handlers?: CronEventHandler) {
		this.cwd = cwd;
		this.settings = settings;
		this.handlers = handlers ?? {};
	}

	updateSettings(settings: CronSettings): void {
		this.settings = settings;
	}

	// ── Lifecycle ───────────────────────────────────────────

	start(): void {
		if (this.timer) return;
		this.reload();
		this.startWatcher();
		this.tick();
		this.timer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.stopWatcher();
	}

	isRunning(): boolean {
		return this.timer !== null;
	}

	// ── File watcher ────────────────────────────────────────

	private startWatcher(): void {
		this.stopWatcher();
		try {
			this.watcher = fs.watch(getTabPath(), { persistent: false }, (_event) => {
				this.reload();
			});
			this.watcher.on("error", () => {
				// File might be deleted temporarily during writes — ignore
			});
		} catch {
			// File doesn't exist yet — fine, we'll pick it up on next reload
		}
	}

	private stopWatcher(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
	}

	private reload(): void {
		this.jobs = loadJobs();
		this.handlers.onReload?.(this.jobs);
	}

	// ── Public read API ─────────────────────────────────────

	list(): Array<CronJob & { running: boolean }> {
		return this.jobs.map(j => ({ ...j, running: this.running.has(j.name) }));
	}

	getRunningNames(): string[] {
		return [...this.running];
	}

	// ── Run now ─────────────────────────────────────────────

	runNow(name: string): string {
		const job = this.jobs.find(j => j.name === name);
		if (!job) return `Entry "${name}" not found.`;
		if (this.running.has(name)) return `Entry "${name}" is already running.`;
		this.running.add(name);
		this.execute(job).finally(() => this.running.delete(name));
		return `✓ Triggered cron job "${name}"`;
	}

	// ── Tick ────────────────────────────────────────────────

	private inActiveHours(): boolean {
		if (!this.settings.activeHours) return true;
		const { start, end } = this.settings.activeHours;
		const now = new Date();
		const currentMinutes = now.getHours() * 60 + now.getMinutes();
		const [startH, startM] = start.split(":").map(Number);
		const [endH, endM] = end.split(":").map(Number);
		return currentMinutes >= startH * 60 + startM && currentMinutes < endH * 60 + endM;
	}

	private tick(): void {
		const now = new Date();
		const currentMinute = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;

		if (currentMinute === this.lastTickMinute) return;
		this.lastTickMinute = currentMinute;

		// Suppress jobs outside active hours
		if (!this.inActiveHours()) return;

		for (const job of this.jobs) {
			if (job.disabled || this.running.has(job.name)) continue;

			try {
				if (!matchesCron(job.schedule, now)) continue;
			} catch {
				continue;
			}

			this.running.add(job.name);
			this.execute(job).finally(() => this.running.delete(job.name));
		}
	}

	private async execute(job: CronJob): Promise<void> {
		const startedAt = new Date();
		this.handlers.onJobStart?.({ job, startedAt });

		try {
			const result = await runPiSubprocess(job.prompt, this.cwd, this.settings.extensions);
			const durationMs = Date.now() - startedAt.getTime();

			if (result.exitCode !== 0 && !result.stdout) {
				throw new Error(result.stderr || `Process exited with code ${result.exitCode}`);
			}

			const response = result.stdout.trim() || undefined;
			this.handlers.onJobComplete?.({
				job, startedAt, durationMs, ok: true, response,
			});
			this.handlers.log?.("job-complete", { job: job.name, durationMs });
		} catch (err: any) {
			const durationMs = Date.now() - startedAt.getTime();
			this.handlers.onJobComplete?.({
				job, startedAt, durationMs, ok: false,
				error: err.message?.slice(0, 2000) ?? "Unknown error",
			});
			this.handlers.log?.("job-error", { job: job.name, durationMs, error: err.message?.slice(0, 500) }, "ERROR");
		}
	}
}
