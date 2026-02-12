/**
 * pi-cron — Web UI and REST API.
 *
 * Mounts on pi-webserver via event bus:
 *   Page: /cron       — Dashboard UI
 *   API:  /api/cron   — JSON CRUD
 *
 * The HTML is composed from three files at load time:
 *   ui/cron.html  — template with {{CSS}} and {{JS}} placeholders
 *   ui/cron.css   — styles
 *   ui/cron.js    — client-side logic
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadJobs, addJob, removeJob, updateJob, type CronJob } from "./crontab.ts";
import { validateCron, type CronScheduler } from "./scheduler.ts";

// ── HTTP helpers ────────────────────────────────────────────────

function json(res: ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function html(res: ServerResponse, content: string): void {
	res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	res.end(content);
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

// ── Compose page ────────────────────────────────────────────────

const uiDir = path.resolve(import.meta.dirname, "./ui");
const CRON_HTML = fs.readFileSync(path.join(uiDir, "cron.html"), "utf-8")
	.replace("{{CSS}}", fs.readFileSync(path.join(uiDir, "cron.css"), "utf-8"))
	.replace("{{JS}}", fs.readFileSync(path.join(uiDir, "cron.js"), "utf-8"));

// ── Types ───────────────────────────────────────────────────────

type RouteHandler = (req: IncomingMessage, res: ServerResponse, subPath: string) => void | Promise<void>;

interface MountConfig {
	name: string;
	label?: string;
	description?: string;
	prefix: string;
	handler: RouteHandler;
}

interface EventBus {
	emit(event: string, data: unknown): void;
}

interface StatusProvider {
	(): { schedulerActive: boolean; lockHolder: number | null; pid: number; jobCount: number };
}

interface SchedulerProvider {
	(): CronScheduler | null;
}

// ── State (set by mountCronRoutes) ──────────────────────────────

let getStatus: StatusProvider;
let getScheduler: SchedulerProvider;
let startFn: () => string;
let stopFn: () => string;

// ── Mount / unmount ─────────────────────────────────────────────

export function mountCronRoutes(
	bus: EventBus,
	opts: {
		getStatus: StatusProvider;
		getScheduler: SchedulerProvider;
		startScheduler: () => string;
		stopScheduler: () => string;
	},
): void {
	getStatus = opts.getStatus;
	getScheduler = opts.getScheduler;
	startFn = opts.startScheduler;
	stopFn = opts.stopScheduler;

	const webMount: MountConfig = {
		name: "cron",
		label: "Cron",
		description: "Cron scheduler dashboard",
		prefix: "/cron",
		handler: (req, res, subPath) => {
			if (req.method !== "GET") { json(res, 405, { error: "Method not allowed" }); return; }
			const p = subPath.replace(/\/+$/, "") || "/";
			if (p === "/") { html(res, CRON_HTML); return; }
			json(res, 404, { error: "Not found" });
		},
	};

	const apiMount: MountConfig = {
		name: "cron-api",
		label: "Cron API",
		description: "Cron CRUD API",
		prefix: "/cron",
		handler: async (req, res, subPath) => {
			const method = req.method ?? "GET";
			const p = subPath.replace(/\/+$/, "") || "/";

			try {
				// GET /api/cron — list all jobs + status
				if (method === "GET" && p === "/") {
					const scheduler = getScheduler();
					const jobs = scheduler
						? scheduler.list()
						: loadJobs().map(j => ({ ...j, running: false }));
					json(res, 200, { jobs, status: getStatus() });
					return;
				}

				// PUT /api/cron — add a new job
				if (method === "PUT" && p === "/") {
					const body = JSON.parse(await readBody(req));
					if (!body.name || !body.schedule || !body.prompt) {
						json(res, 400, { error: "name, schedule, and prompt are required" });
						return;
					}
					const err = validateCron(body.schedule);
					if (err) { json(res, 400, { error: `Invalid cron expression: ${err}` }); return; }
					const ok = addJob({
						name: body.name,
						schedule: body.schedule,
						prompt: body.prompt,
						channel: body.channel ?? "cron",
						disabled: false,
					});
					json(res, ok ? 201 : 409, {
						ok,
						message: ok ? `✓ Added "${body.name}"` : `Entry "${body.name}" already exists.`,
					});
					return;
				}

				// PATCH /api/cron — update a job
				if (method === "PATCH" && p === "/") {
					const body = JSON.parse(await readBody(req));
					if (!body.name) { json(res, 400, { error: "name is required" }); return; }
					const updates: Partial<CronJob> = {};
					if (body.schedule) {
						const err = validateCron(body.schedule);
						if (err) { json(res, 400, { error: `Invalid cron expression: ${err}` }); return; }
						updates.schedule = body.schedule;
					}
					if (body.prompt) updates.prompt = body.prompt;
					if (body.channel) updates.channel = body.channel;
					const ok = updateJob(body.name, updates);
					json(res, ok ? 200 : 404, {
						ok,
						message: ok ? `✓ Updated "${body.name}"` : `Entry "${body.name}" not found.`,
					});
					return;
				}

				// DELETE /api/cron — remove a job
				if (method === "DELETE" && p === "/") {
					const body = JSON.parse(await readBody(req));
					if (!body.name) { json(res, 400, { error: "name is required" }); return; }
					const ok = removeJob(body.name);
					json(res, ok ? 200 : 404, {
						ok,
						message: ok ? `✓ Removed "${body.name}"` : `Entry "${body.name}" not found.`,
					});
					return;
				}

				// POST /api/cron — actions: scheduler start/stop, enable/disable, run
				if (method === "POST" && p === "/") {
					const body = JSON.parse(await readBody(req));
					const action = body.action;

					if (action === "scheduler") {
						const msg = body.value === "start" ? startFn() : stopFn();
						json(res, 200, { ok: msg.startsWith("✓"), message: msg });
						return;
					}

					if (action === "enable" || action === "disable") {
						if (!body.name) { json(res, 400, { error: "name is required" }); return; }
						const ok = updateJob(body.name, { disabled: action === "disable" });
						json(res, ok ? 200 : 404, {
							ok,
							message: ok ? `✓ ${action === "enable" ? "Enabled" : "Disabled"} "${body.name}"` : `Entry "${body.name}" not found.`,
						});
						return;
					}

					if (action === "run") {
						if (!body.name) { json(res, 400, { error: "name is required" }); return; }
						const scheduler = getScheduler();
						if (!scheduler) {
							json(res, 400, { ok: false, message: "Scheduler is not active. Use /cron on to start it." });
							return;
						}
						const msg = scheduler.runNow(body.name);
						json(res, 200, { ok: msg.startsWith("✓"), message: msg });
						return;
					}

					json(res, 400, { error: `Unknown action: ${action}` });
					return;
				}

				json(res, 404, { error: "Not found" });
			} catch (e: any) {
				json(res, 400, { error: e.message });
			}
		},
	};

	bus.emit("web:mount", webMount);
	bus.emit("web:mount-api", apiMount);
}

export function unmountCronRoutes(bus: EventBus): void {
	bus.emit("web:unmount", { name: "cron" });
	bus.emit("web:unmount-api", { name: "cron-api" });
}
