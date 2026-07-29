/**
 * pi-jobs — Web UI and REST API.
 *
 * Mounts on pi-webserver via event bus:
 *   Page: /jobs       — Dashboard UI
 *   API:  /api/jobs   — JSON endpoints
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getJobsStore } from "./store.ts";

// ── HTTP helpers ────────────────────────────────────────────────

function json(res: ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function htmlResponse(res: ServerResponse, content: string): void {
	res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	res.end(content);
}

// ── Compose page ────────────────────────────────────────────────

const uiDir = path.resolve(import.meta.dirname, "./ui");
const JOBS_HTML = fs.readFileSync(path.join(uiDir, "jobs.html"), "utf-8")
	.replace("{{CSS}}", fs.readFileSync(path.join(uiDir, "jobs.css"), "utf-8"))
	.replace("{{JS}}", fs.readFileSync(path.join(uiDir, "jobs.js"), "utf-8"));

// ── Types ───────────────────────────────────────────────────────

type RouteHandler = (req: IncomingMessage, res: ServerResponse, subPath: string) => void | Promise<void>;

interface EventBus {
	emit(event: string, data: unknown): void;
}

// ── Page handler ────────────────────────────────────────────────

async function handleJobsPage(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	if (req.method !== "GET") { json(res, 405, { error: "Method not allowed" }); return; }
	const p = subPath.replace(/\/+$/, "") || "/";

	// Forward API subpaths (relative URLs from HTML)
	if (p.startsWith("/api/jobs")) {
		const apiPath = p.slice("/api/jobs".length) || "/";
		return handleJobsApi(req, res, apiPath);
	}

	if (p === "/") { htmlResponse(res, JOBS_HTML); return; }
	json(res, 404, { error: "Not found" });
}

// ── API handler ─────────────────────────────────────────────────

async function handleJobsApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const method = req.method ?? "GET";
	const p = subPath.replace(/\/+$/, "") || "/";

	try {
		const store = getJobsStore();

		// GET /api/jobs/stats
		if (method === "GET" && p === "/stats") {
			const channel = url.searchParams.get("channel") || undefined;
			json(res, 200, await store.getTotals(channel));
			return;
		}

		// GET /api/jobs/recent
		if (method === "GET" && p === "/recent") {
			const limit = parseInt(url.searchParams.get("limit") ?? "50");
			const channel = url.searchParams.get("channel") || undefined;
			json(res, 200, await store.getRecentJobs(limit, channel));
			return;
		}

		// GET /api/jobs/daily
		if (method === "GET" && p === "/daily") {
			const days = parseInt(url.searchParams.get("days") ?? "30");
			const channel = url.searchParams.get("channel") || undefined;
			json(res, 200, await store.getDailyStats(days, channel));
			return;
		}

		// GET /api/jobs/models
		if (method === "GET" && p === "/models") {
			const days = parseInt(url.searchParams.get("days") ?? "30");
			json(res, 200, await store.getModelBreakdown(days));
			return;
		}

		// GET /api/jobs/tools
		if (method === "GET" && p === "/tools") {
			const days = parseInt(url.searchParams.get("days") ?? "30");
			json(res, 200, await store.getToolBreakdown(days));
			return;
		}

		// GET /api/jobs/:id
		const jobMatch = p.match(/^\/([0-9a-f-]+)$/);
		if (method === "GET" && jobMatch) {
			const job = await store.getJob(jobMatch[1]);
			if (!job) { json(res, 404, { error: "Not found" }); return; }
			const toolCalls = await store.getJobToolCalls(jobMatch[1]);
			json(res, 200, { job, toolCalls });
			return;
		}

		json(res, 404, { error: "Not found" });
	} catch (err: any) {
		json(res, 500, { error: err.message });
	}
}

// ── Mount / unmount ─────────────────────────────────────────────

export function mountJobsRoutes(bus: EventBus): void {
	bus.emit("web:mount", {
		name: "jobs",
		label: "Jobs",
		description: "Agent run telemetry and cost tracking",
		prefix: "/jobs",
		handler: handleJobsPage,
	});
	bus.emit("web:mount-api", {
		name: "jobs-api",
		label: "Jobs API",
		description: "Jobs REST API",
		prefix: "/jobs",
		handler: handleJobsApi,
	});
}

export function unmountJobsRoutes(bus: EventBus): void {
	bus.emit("web:unmount", { name: "jobs" });
	bus.emit("web:unmount-api", { name: "jobs-api" });
}
