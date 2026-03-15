/**
 * pi-web-dashboard — Web routes and SSE.
 *
 * Page:  /dashboard              — Dashboard HTML
 * API:   /api/dashboard/events   — SSE stream
 * API:   /api/dashboard/prompt   — POST prompt
 * API:   /api/dashboard/config   — GET status
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── SSE state ───────────────────────────────────────────────────

const sseClients = new Set<ServerResponse>();

export function broadcast(data: unknown): void {
	const payload = `data: ${JSON.stringify(data)}\n\n`;
	for (const client of sseClients) {
		try { client.write(payload); } catch {}
	}
}

// ── Rate limiter ────────────────────────────────────────────────

class RateLimiter {
	private hits = new Map<string, number[]>();
	constructor(private max: number, private windowMs: number) {}

	isAllowed(key: string): boolean {
		const now = Date.now();
		const ts = this.hits.get(key)?.filter(t => now - t < this.windowMs) ?? [];
		if (ts.length >= this.max) { this.hits.set(key, ts); return false; }
		ts.push(now);
		this.hits.set(key, ts);
		return true;
	}
}

const promptLimiter = new RateLimiter(10, 60_000);

// ── HTML ────────────────────────────────────────────────────────

const DASHBOARD_HTML = fs.readFileSync(
	path.resolve(import.meta.dirname, "../dashboard.html"),
	"utf-8",
);

// ── Helpers ─────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		let oversized = false;
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
			if (body.length > maxBytes) { oversized = true; req.destroy(); }
		});
		req.on("end", () => {
			if (oversized) reject(new Error("Body too large"));
			else resolve(body);
		});
		req.on("error", reject);
	});
}

// ── Saved reference to pi for prompt submission ─────────────────

let _pi: ExtensionAPI | null = null;

// ── Page handler ────────────────────────────────────────────────

function handlePage(_req: IncomingMessage, res: ServerResponse, subPath: string): void {
	const p = subPath.replace(/\/+$/, "") || "/";
	if (p === "/") {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(DASHBOARD_HTML);
		return;
	}
	json(res, 404, { error: "Not found" });
}

// ── API handler ─────────────────────────────────────────────────

async function handleApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	const p = subPath.replace(/\/+$/, "") || "/";
	const method = req.method ?? "GET";

	// GET /api/dashboard/events — SSE
	if (method === "GET" && p === "/events") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
		});
		res.write(`data: ${JSON.stringify({ type: "connected", time: new Date().toISOString() })}\n\n`);
		sseClients.add(res);
		req.on("close", () => { sseClients.delete(res); });
		return;
	}

	// GET /api/dashboard/config
	if (method === "GET" && p === "/config") {
		json(res, 200, {
			sseClients: sseClients.size,
			time: new Date().toISOString(),
		});
		return;
	}

	// POST /api/dashboard/prompt
	if (method === "POST" && p === "/prompt") {
		const clientIp = req.socket.remoteAddress ?? "unknown";
		if (!promptLimiter.isAllowed(clientIp)) {
			json(res, 429, { error: "Too many requests. Max 10 per minute." });
			return;
		}

		try {
			const body = await readBody(req, 1_048_576);
			const { prompt } = JSON.parse(body);
			if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
				json(res, 400, { error: "Missing prompt" });
				return;
			}

			if (!_pi) {
				json(res, 503, { error: "Agent not ready" });
				return;
			}

			const trimmed = prompt.trim();

			// Send to agent first — only broadcast + respond if it doesn't throw.
			// This avoids phantom user bubbles in the UI on delivery failure.
			try {
				_pi.sendUserMessage(trimmed);
			} catch (sendErr: unknown) {
				const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
				json(res, 500, { error: `Agent rejected message: ${msg}` });
				return;
			}

			broadcast({ type: "user_message", text: trimmed, time: new Date().toISOString() });
			json(res, 202, { status: "accepted" });
		} catch (err: any) {
			if (err.message === "Body too large") {
				json(res, 413, { error: "Request body too large (max 1MB)" });
			} else {
				json(res, 400, { error: "Invalid JSON" });
			}
		}
		return;
	}

	// OPTIONS (CORS preflight)
	if (method === "OPTIONS") {
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
		res.writeHead(204);
		res.end();
		return;
	}

	json(res, 404, { error: "Not found" });
}

// ── Mount / unmount ─────────────────────────────────────────────

export function mountDashboard(pi: ExtensionAPI): void {
	_pi = pi;

	pi.events.emit("web:mount", {
		name: "dashboard",
		label: "Dashboard",
		description: "Live agent dashboard with SSE streaming",
		prefix: "/dashboard",
		handler: handlePage,
	});

	pi.events.emit("web:mount-api", {
		name: "dashboard-api",
		label: "Dashboard API",
		description: "Dashboard SSE + prompt API",
		prefix: "/dashboard",
		handler: handleApi,
	});
}

export function unmountDashboard(pi: ExtensionAPI): void {
	_pi = null;

	// Close all SSE connections
	for (const client of sseClients) {
		try { client.end(); } catch {}
	}
	sseClients.clear();

	pi.events.emit("web:unmount", { name: "dashboard" });
	pi.events.emit("web:unmount-api", { name: "dashboard-api" });
}
