/**
 * Calendar web routes — mounts on pi-webserver via event bus.
 *
 * Web page:  /calendar        — Weekly calendar UI
 * API:       /api/calendar/*  — CRUD endpoints
 *
 * The HTML page is composed from three files at load time:
 *   ui/calendar.html  — HTML template with {{CSS}} and {{JS}} placeholders
 *   ui/calendar.css   — Styles
 *   ui/calendar.js    — Client-side logic
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getStore } from "./store.ts";

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

// ── Compose page from parts ─────────────────────────────────────

const uiDir = path.resolve(import.meta.dirname, "./ui");
const CALENDAR_HTML = fs.readFileSync(path.join(uiDir, "calendar.html"), "utf-8")
	.replace("{{CSS}}", fs.readFileSync(path.join(uiDir, "calendar.css"), "utf-8"))
	.replace("{{JS}}", fs.readFileSync(path.join(uiDir, "calendar.js"), "utf-8"));

// ── Types for pi-webserver ──────────────────────────────────────

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

// ── Mount / unmount ─────────────────────────────────────────────

export function mountCalendarRoutes(bus: EventBus): void {
	const webMount: MountConfig = {
		name: "calendar",
		label: "Calendar",
		description: "Weekly calendar with events and reminders",
		prefix: "/calendar",
		handler: (req, res, subPath) => {
			if (req.method !== "GET") { json(res, 405, { error: "Method not allowed" }); return; }
			const p = subPath.replace(/\/+$/, "") || "/";
			if (p === "/") { html(res, CALENDAR_HTML); return; }
			json(res, 404, { error: "Not found" });
		},
	};

	const apiMount: MountConfig = {
		name: "calendar-api",
		label: "Calendar API",
		description: "Calendar CRUD endpoints",
		prefix: "/calendar",
		handler: async (req, res, subPath) => {
			const method = req.method ?? "GET";
			const p = subPath.replace(/\/+$/, "") || "/";
			const store = getStore();

			try {
				if (method === "GET" && p === "/") {
					const url = new URL(req.url ?? "/", "http://localhost");
					const rangeStart = url.searchParams.get("start") ?? new Date().toISOString();
					const rangeEnd = url.searchParams.get("end") ?? new Date(Date.now() + 7 * 86_400_000).toISOString();
					json(res, 200, await store.getEvents(rangeStart, rangeEnd));
					return;
				}

				if (method === "POST" && p === "/") {
					const data = JSON.parse(await readBody(req));
					if (!data.title || !data.start_time || !data.end_time) {
						json(res, 400, { error: "title, start_time, and end_time are required" });
						return;
					}
					json(res, 201, await store.createEvent(data));
					return;
				}

				if (method === "PATCH" && p === "/") {
					const { id, ...updates } = JSON.parse(await readBody(req));
					if (!id) { json(res, 400, { error: "id is required" }); return; }
					const event = await store.updateEvent(id, updates);
					if (!event) { json(res, 404, { error: "Event not found" }); return; }
					json(res, 200, event);
					return;
				}

				if (method === "DELETE" && p === "/") {
					const { id } = JSON.parse(await readBody(req));
					if (!id) { json(res, 400, { error: "id is required" }); return; }
					json(res, 200, { ok: await store.deleteEvent(id) });
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

export function unmountCalendarRoutes(bus: EventBus): void {
	bus.emit("web:unmount", { name: "calendar" });
	bus.emit("web:unmount-api", { name: "calendar-api" });
}
