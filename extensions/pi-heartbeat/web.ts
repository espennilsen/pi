/**
 * pi-heartbeat — Web UI and REST API.
 *
 * Mounts on pi-webserver via event bus:
 *   Page: /heartbeat       — Dashboard UI
 *   API:  /api/heartbeat   — JSON status & actions
 *
 * Listens on the event bus for heartbeat:check and heartbeat:result
 * to maintain a history ring buffer served to the UI.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HeartbeatRunner, HeartbeatRunResult } from "./heartbeat.ts";
import { isStoreReady, getStore } from "./store.ts";

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

// ── History ring buffer ─────────────────────────────────────────

export interface HistoryEntry {
	ok: boolean;
	response: string;
	durationMs: number;
	time: string;
}

const MAX_HISTORY = 100;
const history: HistoryEntry[] = [];

export function pushHistory(entry: HistoryEntry): void {
	history.unshift(entry);
	if (history.length > MAX_HISTORY) history.pop();
}

export function getHistory(): HistoryEntry[] {
	return history;
}

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
	on(event: string, handler: (...args: any[]) => void): void;
	emit(event: string, data: unknown): void;
}

interface HeartbeatWebOptions {
	getRunner: () => HeartbeatRunner | null;
	startHeartbeat: () => string;
	stopHeartbeat: () => string;
	createRunner: () => HeartbeatRunner;
}

// ── Compose page ────────────────────────────────────────────────

const uiDir = path.resolve(import.meta.dirname, "./ui");
const PAGE_HTML = fs.readFileSync(path.join(uiDir, "heartbeat.html"), "utf-8")
	.replace("{{CSS}}", fs.readFileSync(path.join(uiDir, "heartbeat.css"), "utf-8"))
	.replace("{{JS}}", fs.readFileSync(path.join(uiDir, "heartbeat.js"), "utf-8"));

// ── State ───────────────────────────────────────────────────────

let opts: HeartbeatWebOptions;

// ── Mount / unmount ─────────────────────────────────────────────

export function mountHeartbeatRoutes(bus: EventBus, options: HeartbeatWebOptions): void {
	opts = options;

	// Subscribe to bus events to maintain history
	bus.on("heartbeat:result", (data: unknown) => {
		const d = data as { ok: boolean; response: string; durationMs: number; time: string };
		pushHistory({ ok: d.ok, response: d.response, durationMs: d.durationMs, time: d.time });
	});

	const webMount: MountConfig = {
		name: "heartbeat",
		label: "Heartbeat",
		description: "Health check monitor",
		prefix: "/heartbeat",
		handler: (req, res, subPath) => {
			if (req.method !== "GET") {
				json(res, 405, { error: "Method not allowed" });
				return;
			}
			const p = subPath.replace(/\/+$/, "") || "/";
			if (p === "/") {
				html(res, PAGE_HTML);
				return;
			}
			json(res, 404, { error: "Not found" });
		},
	};

	const apiMount: MountConfig = {
		name: "heartbeat-api",
		label: "Heartbeat API",
		description: "Heartbeat status & actions",
		prefix: "/heartbeat",
		handler: async (req, res, subPath) => {
			const method = req.method ?? "GET";
			const p = subPath.replace(/\/+$/, "") || "/";

			try {
				// GET /api/heartbeat — status + history
				if (method === "GET" && p === "/") {
					const runner = opts.getRunner();
					const runnerStatus = runner?.getStatus() ?? {
						active: false,
						running: false,
						lastRun: null,
						lastResult: null,
						runCount: 0,
						okCount: 0,
						alertCount: 0,
						intervalMinutes: 15,
					};

					// Read history + stats from store if available, else in-memory
					let historyData: HistoryEntry[];
					let statsOverride: { runCount: number; okCount: number; alertCount: number; lastRun: string | null; lastOk: boolean | null } | null = null;
					if (isStoreReady()) {
						try {
							const [storeHistory, storeStats] = await Promise.all([
								getStore().getHistory(100),
								getStore().getStats(),
							]);
							historyData = storeHistory.map((e) => ({
								ok: e.ok,
								response: e.response,
								durationMs: e.durationMs,
								time: e.time,
							}));
							statsOverride = storeStats;
						} catch {
							historyData = getHistory();
						}
					} else {
						historyData = getHistory();
					}

					json(res, 200, {
						status: {
							...runnerStatus,
							lastRun: statsOverride?.lastRun ?? runnerStatus.lastRun?.toISOString() ?? null,
							runCount: statsOverride?.runCount ?? runnerStatus.runCount,
							okCount: statsOverride?.okCount ?? runnerStatus.okCount,
							alertCount: statsOverride?.alertCount ?? runnerStatus.alertCount,
						},
						history: historyData,
					});
					return;
				}

				// POST /api/heartbeat — actions: start, stop, run
				if (method === "POST" && p === "/") {
					const body = JSON.parse(await readBody(req));
					const action = body.action;

					if (action === "start") {
						const msg = opts.startHeartbeat();
						json(res, 200, { ok: msg.startsWith("✓"), message: msg });
						return;
					}

					if (action === "stop") {
						const msg = opts.stopHeartbeat();
						json(res, 200, { ok: msg.startsWith("✓"), message: msg });
						return;
					}

					if (action === "run") {
						let runner = opts.getRunner();
						if (!runner) runner = opts.createRunner();
						const result = await runner.runNow();
						json(res, 200, {
							ok: result.ok,
							response: result.response.slice(0, 500),
							durationMs: result.durationMs,
						});
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

export function unmountHeartbeatRoutes(bus: EventBus): void {
	bus.emit("web:unmount", { name: "heartbeat" });
	bus.emit("web:unmount-api", { name: "heartbeat-api" });
}
