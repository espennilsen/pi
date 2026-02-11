/**
 * pi-cron — File-based crontab parser and writer.
 *
 * Format (one job per line):
 *   schedule(5 fields) name [channel:ch] [disabled] prompt
 *
 * Lines starting with # are comments. Blank lines are ignored.
 * The file lives at ~/.pi/agent/pi-cron.tab by default.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Types ───────────────────────────────────────────────────────

export interface CronJob {
	name: string;
	schedule: string;
	prompt: string;
	channel: string;
	disabled: boolean;
}

// ── Default path ────────────────────────────────────────────────

const DEFAULT_TAB_PATH = path.join(os.homedir(), ".pi", "agent", "pi-cron.tab");

let tabPath = DEFAULT_TAB_PATH;

export function setTabPath(p: string): void { tabPath = p; }
export function getTabPath(): string { return tabPath; }

// ── Parser ──────────────────────────────────────────────────────

export function parse(content: string): CronJob[] {
	const jobs: CronJob[] = [];

	for (const raw of content.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;

		// First 5 tokens are the cron fields
		const tokens = line.split(/\s+/);
		if (tokens.length < 7) continue; // 5 cron fields + name + at least 1 word of prompt

		const schedule = tokens.slice(0, 5).join(" ");
		const name = tokens[5];

		let idx = 6;
		let channel = "cron";
		let disabled = false;

		// Parse optional flags before the prompt
		while (idx < tokens.length) {
			if (tokens[idx].startsWith("channel:")) {
				channel = tokens[idx].slice(8);
				idx++;
			} else if (tokens[idx] === "disabled") {
				disabled = true;
				idx++;
			} else {
				break;
			}
		}

		const prompt = tokens.slice(idx).join(" ");
		if (!prompt) continue;

		jobs.push({ name, schedule, prompt, channel, disabled });
	}

	return jobs;
}

// ── Serializer ──────────────────────────────────────────────────

export function serialize(jobs: CronJob[]): string {
	const lines = [
		"# pi-cron.tab — Managed by pi-cron extension",
		"# Format: <min> <hour> <dom> <month> <dow>  <name>  [channel:<ch>]  [disabled]  <prompt>",
		"#",
		"# Examples:",
		"#   0 9 * * 1-5  daily-standup  Review my td tasks and summarize what's open",
		"#   */15 * * * *  health-check  channel:ops  Check system health",
		"#   0 0 * * 0  weekly-digest  disabled  Summarize the week",
		"",
	];

	for (const job of jobs) {
		const flags = [];
		if (job.channel !== "cron") flags.push(`channel:${job.channel}`);
		if (job.disabled) flags.push("disabled");
		const flagStr = flags.length > 0 ? "  " + flags.join("  ") : "";
		lines.push(`${job.schedule}  ${job.name}${flagStr}  ${job.prompt}`);
	}

	return lines.join("\n") + "\n";
}

// ── File I/O ────────────────────────────────────────────────────

export function loadJobs(): CronJob[] {
	try {
		const content = fs.readFileSync(tabPath, "utf-8");
		return parse(content);
	} catch {
		return [];
	}
}

export function saveJobs(jobs: CronJob[]): void {
	fs.mkdirSync(path.dirname(tabPath), { recursive: true });
	fs.writeFileSync(tabPath, serialize(jobs), "utf-8");
}

export function ensureTabFile(): void {
	if (!fs.existsSync(tabPath)) {
		saveJobs([]); // Creates file with header comments
	}
}

// ── CRUD helpers ────────────────────────────────────────────────

export function addJob(job: CronJob): boolean {
	const jobs = loadJobs();
	if (jobs.find(j => j.name === job.name)) return false;
	jobs.push(job);
	saveJobs(jobs);
	return true;
}

export function removeJob(name: string): boolean {
	const jobs = loadJobs();
	const filtered = jobs.filter(j => j.name !== name);
	if (filtered.length === jobs.length) return false;
	saveJobs(filtered);
	return true;
}

export function updateJob(name: string, updates: Partial<Pick<CronJob, "schedule" | "prompt" | "channel" | "disabled">>): boolean {
	const jobs = loadJobs();
	const job = jobs.find(j => j.name === name);
	if (!job) return false;
	if (updates.schedule !== undefined) job.schedule = updates.schedule;
	if (updates.prompt !== undefined) job.prompt = updates.prompt;
	if (updates.channel !== undefined) job.channel = updates.channel;
	if (updates.disabled !== undefined) job.disabled = updates.disabled;
	saveJobs(jobs);
	return true;
}

export function getJob(name: string): CronJob | undefined {
	return loadJobs().find(j => j.name === name);
}
