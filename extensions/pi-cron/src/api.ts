/**
 * pi-cron — Public API for inter-extension communication via pi.events.
 *
 * Read events:
 *   pi.events.emit("cron:list", { callback: (jobs) => ... })
 *   pi.events.emit("cron:get", { name: "my-job", callback: (job) => ... })
 *   pi.events.emit("cron:status", { callback: (status) => ... })
 *
 * Write events (modifies crontab file, scheduler picks up via watcher):
 *   pi.events.emit("cron:add", { name, schedule, prompt, channel?, callback? })
 *   pi.events.emit("cron:update", { name, schedule?, prompt?, channel?, callback? })
 *   pi.events.emit("cron:remove", { name, callback? })
 *   pi.events.emit("cron:enable", { name, callback? })
 *   pi.events.emit("cron:disable", { name, callback? })
 *   pi.events.emit("cron:run", { name, callback? })
 *
 * Lifecycle events (listen only):
 *   pi.events.on("cron:job_start", (event) => ...)
 *   pi.events.on("cron:job_complete", (event) => ...)
 *   pi.events.on("cron:reload", (jobs) => ...)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CronScheduler } from "./scheduler.ts";
import { loadJobs, getJob, addJob, removeJob, updateJob, type CronJob } from "./crontab.ts";
import { validateCron } from "./scheduler.ts";

export interface CronStatus {
	schedulerActive: boolean;
	lockHolder: number | null;
	pid: number;
	jobCount: number;
}

export interface CronWriteResult {
	ok: boolean;
	message: string;
}

export function registerCronApi(
	pi: ExtensionAPI,
	getScheduler: () => CronScheduler | null,
	getStatus: () => CronStatus,
): void {

	pi.events.on("cron:list", (raw: unknown) => {
		const data = raw as { callback?: (jobs: Array<CronJob & { running: boolean }>) => void };
		const scheduler = getScheduler();
		const jobs = scheduler
			? scheduler.list()
			: loadJobs().map(j => ({ ...j, running: false }));
		data.callback?.(jobs);
	});

	pi.events.on("cron:get", (raw: unknown) => {
		const data = raw as { name: string; callback?: (job: CronJob | undefined) => void };
		data.callback?.(getJob(data.name));
	});

	pi.events.on("cron:status", (raw: unknown) => {
		const data = raw as { callback?: (status: CronStatus) => void };
		data.callback?.(getStatus());
	});

	pi.events.on("cron:add", (raw: unknown) => {
		const data = raw as { name: string; schedule: string; prompt: string; channel?: string; callback?: (r: CronWriteResult) => void };
		const err = validateCron(data.schedule);
		if (err) { data.callback?.({ ok: false, message: `Invalid cron expression: ${err}` }); return; }
		const ok = addJob({ name: data.name, schedule: data.schedule, prompt: data.prompt, channel: data.channel ?? "cron", disabled: false });
		data.callback?.({ ok, message: ok ? `✓ Added "${data.name}"` : `Entry "${data.name}" already exists.` });
	});

	pi.events.on("cron:update", (raw: unknown) => {
		const data = raw as { name: string; schedule?: string; prompt?: string; channel?: string; callback?: (r: CronWriteResult) => void };
		if (data.schedule) {
			const err = validateCron(data.schedule);
			if (err) { data.callback?.({ ok: false, message: `Invalid cron expression: ${err}` }); return; }
		}
		const ok = updateJob(data.name, data);
		data.callback?.({ ok, message: ok ? `✓ Updated "${data.name}"` : `Entry "${data.name}" not found.` });
	});

	pi.events.on("cron:remove", (raw: unknown) => {
		const data = raw as { name: string; callback?: (r: CronWriteResult) => void };
		const ok = removeJob(data.name);
		data.callback?.({ ok, message: ok ? `✓ Removed "${data.name}"` : `Entry "${data.name}" not found.` });
	});

	pi.events.on("cron:enable", (raw: unknown) => {
		const data = raw as { name: string; callback?: (r: CronWriteResult) => void };
		const ok = updateJob(data.name, { disabled: false });
		data.callback?.({ ok, message: ok ? `✓ Enabled "${data.name}"` : `Entry "${data.name}" not found.` });
	});

	pi.events.on("cron:disable", (raw: unknown) => {
		const data = raw as { name: string; callback?: (r: CronWriteResult) => void };
		const ok = updateJob(data.name, { disabled: true });
		data.callback?.({ ok, message: ok ? `✓ Disabled "${data.name}"` : `Entry "${data.name}" not found.` });
	});

	pi.events.on("cron:run", (raw: unknown) => {
		const data = raw as { name: string; callback?: (r: CronWriteResult) => void };
		const scheduler = getScheduler();
		if (!scheduler) {
			data.callback?.({ ok: false, message: "Scheduler is not active. Use /cron on to start it." });
			return;
		}
		const msg = scheduler.runNow(data.name);
		data.callback?.({ ok: msg.startsWith("✓"), message: msg });
	});
}
