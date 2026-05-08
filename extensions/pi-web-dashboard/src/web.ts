/**
 * pi-web-dashboard — Web routes and SSE.
 *
 * Page:  /dashboard              — Dashboard HTML
 * API:   /api/dashboard/commands  — GET list available slash commands
 * API:   /api/dashboard/events    — SSE stream
 * API:   /api/dashboard/prompt    — POST prompt (auto-routes /commands)
 * API:   /api/dashboard/stop      — POST abort the running agent
 * API:   /api/dashboard/config    — GET status
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExtensionAPI, SlashCommandInfo } from "@earendil-works/pi-coding-agent";

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
		req.setTimeout(10_000, () => { reject(new Error("Request timeout")); req.destroy(); });
		req.on("data", (chunk: Buffer) => {
			if (body.length + chunk.length > maxBytes) {
				reject(new Error("Body too large"));
				req.destroy();
			} else {
				body += chunk.toString();
			}
		});
		req.on("end", () => { resolve(body); });
		req.on("error", (err) => { reject(err); });
	});
}

// ── Saved reference to pi for prompt submission ─────────────────

let _pi: ExtensionAPI | null = null;
let _piUnmountCleanup: (() => void)[] = [];

/** Abort callback set while the agent is running; cleared on agent_end. */
let _abortFn: (() => void) | null = null;

export function setAbortFn(fn: (() => void) | null): void {
	_abortFn = fn;
}

// ── Slash command routing ─────────────────────────────────────

/** Parse a slash command string into name and args. */
function parseCommand(text: string): { name: string; args: string } | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) return null;

	if (trimmed.startsWith("/skill:")) {
		const rest = trimmed.slice(7);
		const spaceIndex = rest.indexOf(" ");
		if (spaceIndex === -1) return { name: `skill:${rest}`, args: "" };
		return { name: `skill:${rest.slice(0, spaceIndex)}`, args: rest.slice(spaceIndex + 1) };
	}

	const spaceIndex = trimmed.indexOf(" ");
	if (spaceIndex === -1) return { name: trimmed.slice(1), args: "" };
	return { name: trimmed.slice(1, spaceIndex), args: trimmed.slice(spaceIndex + 1) };
}

/** Strip YAML frontmatter from file content. */
function stripFrontmatter(content: string): string {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return content;
	return content.slice(match[0].length);
}

/** Bash-style argument parsing — respects quoted strings. */
function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;
	for (let i = 0; i < argsString.length; i++) {
		const char = argsString[i];
		if (inQuote) {
			if (char === inQuote) inQuote = null;
			else current += char;
		} else if (char === '"' || char === "'") {
			inQuote = char;
		} else if (char === ' ' || char === '\t') {
			if (current) { args.push(current); current = ""; }
		} else {
			current += char;
		}
	}
	if (current) args.push(current);
	return args;
}

/** Substitute $1, $@, $ARGUMENTS, ${@:N}, ${@:N:L} in template content. */
function substituteArgs(content: string, args: string[]): string {
	let result = content;
	result = result.replace(/\$(\d+)/g, (_, num: string) => args[parseInt(num, 10) - 1] ?? "");
	result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startStr: string, lengthStr?: string) => {
		let start = parseInt(startStr, 10) - 1;
		if (start < 0) start = 0;
		if (lengthStr) return args.slice(start, start + parseInt(lengthStr, 10)).join(" ");
		return args.slice(start).join(" ");
	});
	const allArgs = args.join(" ");
	result = result.replace(/\$ARGUMENTS/g, allArgs);
	result = result.replace(/\$@/g, allArgs);
	return result;
}

/** Determine how to route a slash command. */
function routeCommand(text: string, commands: SlashCommandInfo[]): {
	action: "event-bus" | "expand-and-send" | "unknown";
	eventName?: string;
	expandedText?: string;
	info?: SlashCommandInfo;
} {
	const parsed = parseCommand(text);
	if (!parsed) return { action: "unknown" };

	const cmd = commands.find(c => c.name === parsed.name);
	if (!cmd) return { action: "unknown" };

	if (cmd.source === "extension") {
		return { action: "event-bus", eventName: `command:${parsed.name}`, info: cmd };
	}

	if (cmd.source === "skill") {
		const filePath = (cmd as any).sourceInfo?.path ?? (cmd as any).path;
		const baseDir = (cmd as any).sourceInfo?.baseDir ?? filePath?.replace(/\/[^\/]+$/, "");
		try {
			if (!filePath) return { action: "unknown" };
			const content = fs.readFileSync(filePath, "utf-8");
			const body = stripFrontmatter(content).trim();
			const block = `<skill name="${parsed.name.replace("skill:", "")}" location="${filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
			return { action: "expand-and-send", expandedText: parsed.args ? `${block}\n\n${parsed.args}` : block, info: cmd };
		} catch {
			return { action: "unknown" };
		}
	}

	if (cmd.source === "prompt") {
		const filePath = (cmd as any).sourceInfo?.path ?? (cmd as any).path;
		try {
			if (!filePath) return { action: "unknown" };
			const content = fs.readFileSync(filePath, "utf-8");
			const body = stripFrontmatter(content).trim();
			const args = parseCommandArgs(parsed.args);
			return { action: "expand-and-send", expandedText: substituteArgs(body, args), info: cmd };
		} catch {
			return { action: "unknown" };
		}
	}

	return { action: "unknown" };
}

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

	// GET /api/dashboard/commands — list available slash commands
	if (method === "GET" && p === "/commands") {
		if (!_pi) { json(res, 503, { error: "Agent not ready" }); return; }
		const commands = _pi.getCommands();
		json(res, 200, { commands });
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

			// Route slash commands through event bus or expansion
			if (trimmed.startsWith("/")) {
				const commands = _pi.getCommands();
				const route = routeCommand(trimmed, commands);

				if (route.action === "event-bus") {
					const parsed = parseCommand(trimmed)!;
					_pi.events.emit(route.eventName!, { args: parsed.args, source: "pi-web-dashboard" });
					json(res, 202, { status: "accepted", dispatched: true, command: parsed.name, source: "extension" });
					return;
				}

				if (route.action === "expand-and-send") {
					const parsed = parseCommand(trimmed)!;
					try {
						_pi.sendUserMessage(route.expandedText!);
					} catch (sendErr: unknown) {
						const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
						json(res, 500, { error: `Agent rejected message: ${msg}` });
						return;
					}
					json(res, 202, { status: "accepted", dispatched: true, command: parsed.name, source: route.info?.source });
					return;
				}

				// Unknown /command — fall through as literal text
			}

			// Regular prompt — send to agent
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
			} else if (err.message === "Request timeout") {
				json(res, 408, { error: "Request timed out" });
			} else {
				json(res, 400, { error: "Invalid JSON" });
			}
		}
		return;
	}

	// POST /api/dashboard/stop
	if (method === "POST" && p === "/stop") {
		if (!_abortFn) {
			json(res, 409, { error: "Agent is not running" });
			return;
		}
		try {
			_abortFn();
			json(res, 202, { status: "stopping" });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			json(res, 500, { error: `Abort failed: ${msg}` });
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

	// Forward command_result events from extensions to SSE clients
	// Only forward results intended for this extension (source matching).
	const unsubCommandResult = pi.events.on("command_result", (data: unknown) => {
		const d = data as { command?: string; message?: string; type?: string; source?: string };
		// Only forward if source is empty (TUI/channels) or matches pi-web-dashboard
		if (d.source && d.source !== "pi-web-dashboard") return;
		broadcast({ type: "command_result", command: d.command, message: d.message, notificationType: d.type, time: new Date().toISOString() });
	});

	// Agent lifecycle events (agent_start, agent_end, turn_end, tool_call,
	// tool_result) are handled by index.ts. Those listeners are more complete
	// (thinking blocks, turn indices, tool input, structured content).
	// Duplicating them here caused every SSE event to fire twice (issue #160).

	_piUnmountCleanup = [unsubCommandResult];

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
	// Clean up event listeners
	for (const fn of _piUnmountCleanup) { try { fn(); } catch {} }
	_piUnmountCleanup = [];

	_pi = null;

	// Close all SSE connections
	for (const client of sseClients) {
		try { client.end(); } catch {}
	}
	sseClients.clear();

	pi.events.emit("web:unmount", { name: "dashboard" });
	pi.events.emit("web:unmount-api", { name: "dashboard-api" });
}
