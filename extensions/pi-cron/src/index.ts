/**
 * pi-cron — Cron scheduler extension for pi.
 *
 * Provides:
 *   - `cron` tool for the LLM to manage scheduled jobs
 *   - `/cron` command to toggle scheduler on/off
 *   - `cron:*` event API for inter-extension communication
 *   - Lock file to ensure only one pi instance runs the scheduler
 *   - File watcher on pi-cron.tab for live reload
 *
 * **Disabled by default.** Enable with:
 *   - `pi --cron` flag
 *   - `/cron on` command
 *   - settings.json: { "pi-cron": { "autostart": true } }
 *
 * The crontab file (.pi/pi-cron.tab) is always readable/writable
 * regardless of scheduler state. The scheduler just controls whether
 * jobs actually execute on their schedule.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { ensureTabFile, loadJobs, addJob, removeJob, updateJob, initTabPath, type CronJob } from "./crontab.ts";
import { CronScheduler, validateCron } from "./scheduler.ts";
import { acquireLock, releaseLock, lockHolder, initLockPath } from "./lock.ts";
import { registerCronApi, type CronStatus } from "./api.ts";
import { mountCronRoutes, unmountCronRoutes } from "./web.ts";
import { resolveSettings } from "./settings.ts";
import { createLogger } from "./logger.ts";

interface CronParams {
	action: "list" | "add" | "update" | "remove" | "enable" | "disable" | "run";
	name?: string;
	schedule?: string;
	prompt?: string;
	channel?: string;
}

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let scheduler: CronScheduler | null = null;
	let cwd = process.cwd();

	// ── Powerbar segment ──────────────────────────────────────

	pi.events.emit("powerbar:register-segment", {
		id: "cron",
		label: "Cron",
	});

	function updatePowerbar(): void {
		if (!scheduler) {
			pi.events.emit("powerbar:update", { id: "cron", text: undefined });
			return;
		}
		const jobs = scheduler.list();
		const total = jobs.filter(j => !j.disabled).length;
		const running = jobs.filter(j => j.running).length;

		if (total === 0) {
			pi.events.emit("powerbar:update", {
				id: "cron",
				text: "idle",
				icon: "⏰",
				color: "muted",
			});
			return;
		}

		if (running > 0) {
			const queued = total - running;
			const suffix = queued > 0 ? ` +${queued}` : "";
			pi.events.emit("powerbar:update", {
				id: "cron",
				text: `${running} running${suffix}`,
				icon: "⏰",
				color: "accent",
			});
		} else {
			pi.events.emit("powerbar:update", {
				id: "cron",
				text: `${total} jobs`,
				icon: "⏰",
				color: "muted",
			});
		}
	}

	// ── Flag: --cron ──────────────────────────────────────────

	pi.registerFlag("cron", {
		description: "Enable cron scheduler on startup",
		type: "boolean",
		default: false,
	});

	// ── Helpers ───────────────────────────────────────────────

	function startScheduler(): string {
		if (scheduler) return "Scheduler is already running.";
		if (!acquireLock()) {
			const holder = lockHolder();
			return `Another pi instance (PID ${holder}) is already running the cron scheduler.`;
		}
		const settings = resolveSettings(cwd);
		scheduler = new CronScheduler(cwd, settings, {
			onJobStart: (event) => {
				pi.events.emit("cron:job_start", event);
				updatePowerbar();
			},
			onJobComplete: (event) => {
				pi.events.emit("cron:job_complete", event);
				updatePowerbar();

				// Send results via channel
				const s = resolveSettings(cwd);
				if (event.ok && !s.showOk) return;
				const prefix = event.ok ? "✅" : "❌";
				const text = event.ok
					? `${prefix} Cron "${event.job.name}" completed (${(event.durationMs / 1000).toFixed(1)}s)`
					: `${prefix} Cron "${event.job.name}" failed: ${(event.error ?? "unknown error").slice(0, 500)}`;
				pi.events.emit("channel:send", {
					route: s.route,
					text,
					source: "pi-cron",
				});
			},
			onReload: (jobs) => {
				pi.events.emit("cron:reload", jobs);
				updatePowerbar();
			},
			log,
		});
		scheduler.start();
		log("start", { pid: process.pid });
		updatePowerbar();
		return `✓ Cron scheduler started (PID ${process.pid})`;
	}

	function stopScheduler(): string {
		if (!scheduler) return "Scheduler is not running.";
		scheduler.stop();
		scheduler = null;
		releaseLock();
		log("stop", {});
		updatePowerbar();
		return "✓ Cron scheduler stopped";
	}

	function getStatus(): CronStatus {
		return {
			schedulerActive: scheduler !== null,
			lockHolder: lockHolder(),
			pid: process.pid,
			jobCount: loadJobs().length,
		};
	}

	// ── Web mount helper ─────────────────────────────────────

	function mountWeb(): void {
		mountCronRoutes(pi.events, {
			getStatus,
			getScheduler: () => scheduler,
			startScheduler,
			stopScheduler,
		});
	}

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		initTabPath(cwd);
		initLockPath(cwd);
		ensureTabFile();

		const settings = resolveSettings(cwd);

		if (pi.getFlag("--cron") || settings.autostart) {
			const result = startScheduler();
			if (result.startsWith("✓")) {
				ctx.ui.setStatus("pi-cron", "⏰ cron active");
			}
		}

		// Update powerbar (shows state or hides if inactive)
		updatePowerbar();

		// Mount web routes (no-op if pi-webserver isn't loaded yet)
		mountWeb();
	});

	// Re-mount when pi-webserver starts after us
	pi.events.on("web:ready", () => {
		mountWeb();
	});

	pi.on("session_shutdown", async () => {
		unmountCronRoutes(pi.events);
		if (scheduler) {
			scheduler.stop();
			scheduler = null;
			releaseLock();
		}
		pi.events.emit("powerbar:update", { id: "cron", text: undefined });
	});

	// ── Event API for other extensions ────────────────────────

	registerCronApi(pi, () => scheduler, getStatus);

	// ── Command: /cron ────────────────────────────────────────

	pi.registerCommand("cron", {
		description: "Toggle cron scheduler: /cron on | /cron off | /cron status",
		handler: async (args, ctx) => {
			const arg = args?.trim().toLowerCase();

			if (arg === "on" || arg === "start") {
				const result = startScheduler();
				ctx.ui.notify(result, result.startsWith("✓") ? "info" : "error");
				if (result.startsWith("✓")) {
					ctx.ui.setStatus("pi-cron", "⏰ cron active");
				}
			} else if (arg === "off" || arg === "stop") {
				const result = stopScheduler();
				ctx.ui.notify(result, result.startsWith("✓") ? "info" : "error");
				ctx.ui.setStatus("pi-cron", undefined);
			} else {
				const s = getStatus();
				const lines = [
					`Scheduler: ${s.schedulerActive ? "✅ active" : "⏸ inactive"}`,
					`PID: ${s.pid}`,
					s.lockHolder ? `Lock: PID ${s.lockHolder}` : "Lock: free",
					`Jobs: ${s.jobCount}`,
				];
				ctx.ui.notify(lines.join(" · "), "info");
			}
		},
	});

	// ── Tool ──────────────────────────────────────────────────

	pi.registerTool({
		name: "cron",
		label: "Cron",
		description:
			"Manage scheduled cron jobs stored in .pi/pi-cron.tab (workspace-local). " +
			"Actions: list, add, update, remove, enable, disable, run. " +
			"The scheduler must be started with /cron on or --cron for jobs to execute. " +
			"Reading and writing jobs works regardless of scheduler state.",
		parameters: Type.Object({
			action: StringEnum(
				["list", "add", "update", "remove", "enable", "disable", "run"] as const,
				{ description: "Action to perform" },
			) as any,
			name: Type.Optional(
				Type.String({ description: "Job name (required for all actions except list)" }),
			),
			schedule: Type.Optional(
				Type.String({
					description:
						"Cron expression: 'min hour dom month dow' (required for add, optional for update). Example: '0 9 * * 1-5' = weekdays at 9am",
				}),
			),
			prompt: Type.Optional(
				Type.String({ description: "Prompt to send to the agent when the job fires (required for add, optional for update)" }),
			),
			channel: Type.Optional(
				Type.String({ description: "Channel tag for grouping (optional, default: 'cron')" }),
			),
		}) as any,

		async execute(_toolCallId, _params) {
			const params = _params as CronParams;
			let result: string;

			switch (params.action) {
				case "list": {
					const jobs = scheduler
						? scheduler.list()
						: loadJobs().map(j => ({ ...j, running: false }));
					if (jobs.length === 0) {
						result = "No cron jobs configured.";
					} else {
						const note = scheduler ? "" : "\n\n⚠️ Scheduler is inactive. Use `/cron on` to start.";
						const lines = jobs.map((j) => {
							const status = j.disabled ? "⏸ disabled" : j.running ? "🔄 running" : "✅ active";
							const ch = j.channel !== "cron" ? ` [${j.channel}]` : "";
							return `- **${j.name}** \`${j.schedule}\` ${status}${ch}\n  ${j.prompt.slice(0, 80)}`;
						});
						result = `**Cron Jobs (${jobs.length}):**\n\n${lines.join("\n\n")}${note}`;
					}
					break;
				}
				case "add": {
					if (!params.name || !params.schedule || !params.prompt) {
						result = "Missing required fields: name, schedule, and prompt.";
						break;
					}
					const err = validateCron(params.schedule);
					if (err) { result = `Invalid cron expression: ${err}`; break; }
					const ok = addJob({
						name: params.name,
						schedule: params.schedule,
						prompt: params.prompt,
						channel: params.channel ?? "cron",
						disabled: false,
					});
					result = ok
						? `✓ Added cron job "${params.name}" (${params.schedule})`
						: `Entry "${params.name}" already exists.`;
					break;
				}
				case "update": {
					if (!params.name) { result = "Missing required field: name"; break; }
					const updates: Partial<CronJob> = {};
					if (params.schedule) {
						const err = validateCron(params.schedule);
						if (err) { result = `Invalid cron expression: ${err}`; break; }
						updates.schedule = params.schedule;
					}
					if (params.prompt) updates.prompt = params.prompt;
					if (params.channel) updates.channel = params.channel;
					if (Object.keys(updates).length === 0) {
						result = "Nothing to update. Provide at least one of: schedule, prompt, channel.";
						break;
					}
					result = updateJob(params.name, updates)
						? `✓ Updated "${params.name}"`
						: `Entry "${params.name}" not found.`;
					break;
				}
				case "remove": {
					if (!params.name) { result = "Missing required field: name"; break; }
					result = removeJob(params.name)
						? `✓ Removed "${params.name}"`
						: `Entry "${params.name}" not found.`;
					break;
				}
				case "enable": {
					if (!params.name) { result = "Missing required field: name"; break; }
					result = updateJob(params.name, { disabled: false })
						? `✓ Enabled "${params.name}"`
						: `Entry "${params.name}" not found.`;
					break;
				}
				case "disable": {
					if (!params.name) { result = "Missing required field: name"; break; }
					result = updateJob(params.name, { disabled: true })
						? `✓ Disabled "${params.name}"`
						: `Entry "${params.name}" not found.`;
					break;
				}
				case "run": {
					if (!params.name) { result = "Missing required field: name"; break; }
					if (!scheduler) {
						result = "Scheduler is not active. Use `/cron on` or `--cron` to start it.";
						break;
					}
					result = scheduler.runNow(params.name);
					break;
				}
				default:
					result = `Unknown action: ${(params as any).action}`;
			}

			return {
				content: [{ type: "text" as const, text: result }],
				details: {},
			};
		},
	});
}
