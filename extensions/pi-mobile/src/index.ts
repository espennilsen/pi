/**
 * pi-mobile — PWA mobile app for Pi agents.
 *
 * Mounts on pi-webserver:
 *   Page: /mobile              — PWA app shell (Preact + HTM)
 *   Page: /mobile/manifest.json — PWA manifest
 *   Page: /mobile/sw.js        — Service worker
 *   Page: /mobile/screens/*.js  — Screen modules
 *   API:  /api/mobile/health   — Health check
 *   API:  /api/mobile/chat/*   — Chat proxy (prompt submission)
 *   API:  /api/mobile/chat/commands — List available slash commands
 *   API:  /api/mobile/chat/prompt   — Submit prompt (auto-routes /commands)
 *   API:  /api/mobile/status   — Agent status
 *   API:  /api/mobile/td/*     — Task management proxy
 *   API:  /api/mobile/files/*  — File browser
 *   API:  /api/mobile/logs/*   — Log streaming
 *   API:  /api/mobile/cron/*   — Cron job management
 *   API:  /api/mobile/skills   — Skills browser
 *   API:  /api/mobile/extensions — Extensions list
 *   API:  /api/mobile/crm/*    — CRM proxy
 *   API:  /api/mobile/calendar/* — Calendar proxy
 *   API:  /api/mobile/settings — Settings
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExtensionAPI, SlashCommandInfo } from "@mariozechner/pi-coding-agent";

// ── Static files ─────────────────────────────────────────────

const PUBLIC_DIR = path.resolve(import.meta.dirname, "../public");

function readPublicFile(filePath: string): string {
	return fs.readFileSync(path.join(PUBLIC_DIR, filePath), "utf-8");
}

const APP_HTML = readPublicFile("app.html");
const MANIFEST_JSON = readPublicFile("manifest.json");
const SW_JS = readPublicFile("sw.js");

/** Cache for screen JS modules — loaded lazily on first request. */
const screenCache = new Map<string, string>();

function getScreenJs(name: string): string | null {
	if (screenCache.has(name)) return screenCache.get(name)!;
	const screensDir = path.join(PUBLIC_DIR, "screens");
	const filePath = path.join(screensDir, `${name}.js`);
	// Prevent path traversal — must stay within screens directory
	if (!filePath.startsWith(screensDir + path.sep) && filePath !== screensDir) return null;
	if (!fs.existsSync(filePath)) return null;
	const content = fs.readFileSync(filePath, "utf-8");
	screenCache.set(name, content);
	return content;
}

// ── HTTP helpers ─────────────────────────────────────────────

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
	res.writeHead(status, { "Content-Type": contentType });
	res.end(body);
}

function json(res: ServerResponse, status: number, data: unknown): void {
	send(res, status, "application/json; charset=utf-8", JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
	const MAX_SIZE = 1024 * 1024; // 1 MB
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let totalSize = 0;
		req.on("data", (c: Buffer) => {
			totalSize += c.length;
			if (totalSize > MAX_SIZE) {
				req.destroy();
				reject(new Error("Request body too large"));
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
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
		try {
			const content = fs.readFileSync(cmd.sourceInfo.path, "utf-8");
			const body = stripFrontmatter(content).trim();
			const baseDir = cmd.sourceInfo.baseDir || cmd.sourceInfo.path.replace(/\/[^\/]+$/, "");
			const block = `<skill name="${parsed.name.replace("skill:", "")}" location="${cmd.sourceInfo.path}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
			return { action: "expand-and-send", expandedText: parsed.args ? `${block}\n\n${parsed.args}` : block, info: cmd };
		} catch {
			return { action: "unknown" };
		}
	}

	if (cmd.source === "prompt") {
		try {
			const content = fs.readFileSync(cmd.sourceInfo.path, "utf-8");
			const body = stripFrontmatter(content).trim();
			const args = parseCommandArgs(parsed.args);
			return { action: "expand-and-send", expandedText: substituteArgs(body, args), info: cmd };
		} catch {
			return { action: "unknown" };
		}
	}

	return { action: "unknown" };
}

// ── API: Chat ────────────────────────────────────────────────

let _pi: ExtensionAPI | null = null;

/** Active SSE client connections. */
const sseClients = new Set<ServerResponse>();
/** Active log SSE client connections. */
const logClients = new Set<ServerResponse>();

/** Broadcast a log entry to connected log SSE clients. */
function broadcastLog(data: unknown): void {
	const payload = `data: ${JSON.stringify(data)}\n\n`;
	for (const res of logClients) {
		if (!res.writable) { logClients.delete(res); continue; }
		try { res.write(payload); } catch { logClients.delete(res); }
	}
}

/** Broadcast an event to all connected SSE clients. */
function broadcast(data: unknown): void {
	const payload = `data: ${JSON.stringify(data)}\n\n`;
	for (const res of sseClients) {
		if (!res.writable) { sseClients.delete(res); continue; }
		try { res.write(payload); } catch { sseClients.delete(res); }
	}
}

async function handleChatApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	// GET /commands — list available slash commands
	if (subPath === "/commands" && req.method === "GET") {
		if (!_pi) { json(res, 503, { error: "Agent not ready" }); return; }
		const commands = _pi.getCommands();
		json(res, 200, { commands });
		return;
	}

	// POST /prompt — submit a prompt (handles slash commands)
	if (subPath === "/prompt" && req.method === "POST") {
		try {
			const body = JSON.parse(await readBody(req));
			if (!_pi) { json(res, 503, { error: "Agent not ready" }); return; }
			const prompt = body.prompt;
			if (!prompt || typeof prompt !== "string") {
				json(res, 400, { error: "Missing 'prompt' string in request body" });
				return;
			}

			// Route slash commands through event bus or expansion
			if (prompt.trim().startsWith("/")) {
				const commands = _pi.getCommands();
				const route = routeCommand(prompt.trim(), commands);

				if (route.action === "event-bus") {
					// Extension command — emit on event bus
					const parsed = parseCommand(prompt.trim())!;
					_pi.events.emit(route.eventName!, { args: parsed.args, source: "pi-mobile" });
					json(res, 200, { ok: true, dispatched: true, command: parsed.name, source: "extension" });
					return;
				}

				if (route.action === "expand-and-send") {
					// Skill or prompt template — expand and send as user message
					const parsed = parseCommand(prompt.trim())!;
					_pi.sendUserMessage(route.expandedText!);

					json(res, 200, { ok: true, dispatched: true, command: parsed.name, source: route.info?.source });
					return;
				}
			}

			// Regular prompt — no matching slash command, send as-is
			_pi.sendMessage(
				{
					customType: "mobile-prompt",
					content: `📱 **Mobile:** ${prompt}`,
					display: true,
				},
				{ triggerTurn: true },
			);
			json(res, 200, { ok: true, message: "Prompt submitted" });
		} catch {
			json(res, 400, { error: "Invalid JSON body" });
		}
		return;
	}

	// SSE stream — broadcast agent events to connected mobile clients
	if (subPath === "/events" && req.method === "GET") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.write(`data: ${JSON.stringify({ type: "connected", time: new Date().toISOString() })}\n\n`);

		// Register this SSE connection for broadcast
		sseClients.add(res);

		// Keepalive ping every 15s
		const keepalive = setInterval(() => {
			if (!res.writable) { clearInterval(keepalive); return; }
			try { res.write(": ping\n\n"); } catch { clearInterval(keepalive); sseClients.delete(res); }
		}, 15_000);

		req.on("close", () => {
			clearInterval(keepalive);
			sseClients.delete(res);
		});
		return;
	}

	json(res, 404, { error: "Not found" });
}

// ── API: Tasks (td) ──────────────────────────────────────────

async function runTd(args: string[]): Promise<{ ok: boolean; data?: string; error?: string }> {
	if (!_pi) return { ok: false, error: "Agent not ready" };
	try {
		const result = await _pi.exec("td", args, { timeout: 15_000 });
		const stdout = result.stdout?.trim() ?? "";
		const stderr = result.stderr?.trim() ?? "";
		if (result.code !== 0) return { ok: false, error: stderr || stdout || `Exit code ${result.code}` };
		return { ok: true, data: stdout };
	} catch (err: unknown) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

async function handleTdApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	// GET /issues — list issues as JSON
	if (subPath === "/issues" && req.method === "GET") {
		const result = await runTd(["list", "--json"]);
		if (!result.ok) { json(res, 500, { error: result.error }); return; }
		try {
			json(res, 200, { issues: JSON.parse(result.data!) });
		} catch {
			json(res, 200, { issues: [], raw: result.data });
		}
		return;
	}

	// GET /issues/:id — show single issue
	if (subPath.match(/^\/issues\/[a-z0-9-]+$/) && req.method === "GET") {
		const id = subPath.split("/")[2];
		const result = await runTd(["show", id, "--json"]);
		if (!result.ok) { json(res, 404, { error: result.error }); return; }
		try {
			json(res, 200, JSON.parse(result.data!));
		} catch {
			json(res, 200, { raw: result.data });
		}
		return;
	}

	// POST /issues — create issue
	if (subPath === "/issues" && req.method === "POST") {
		try {
			const body = JSON.parse(await readBody(req));
			const args = ["create", body.title || "Untitled"];
			if (body.type) args.push("--type", body.type);
			if (body.priority) args.push("--priority", body.priority);
			if (body.labels) {
				const labels = Array.isArray(body.labels) ? body.labels.join(",") : body.labels;
				args.push("--label", labels);
			}
			if (body.minor) args.push("--minor");
			const result = await runTd(args);
			if (!result.ok) { json(res, 500, { error: result.error }); return; }
			json(res, 201, { ok: true, output: result.data });
		} catch {
			json(res, 400, { error: "Invalid JSON body" });
		}
		return;
	}

	// PATCH /issues/:id — update issue (status transitions)
	if (subPath.match(/^\/issues\/[a-z0-9-]+$/) && req.method === "PATCH") {
		const id = subPath.split("/")[2];
		try {
			const body = JSON.parse(await readBody(req));
			let result;
			if (body.action === "start") result = await runTd(["start", id]);
			else if (body.action === "close") result = await runTd(["close", id]);
			else if (body.action === "reopen") result = await runTd(["reopen", id]);
			else if (body.priority) result = await runTd(["edit", id, "--priority", body.priority]);
			else { json(res, 400, { error: "Unknown action" }); return; }
			if (!result.ok) { json(res, 500, { error: result.error }); return; }
			json(res, 200, { ok: true, output: result.data });
		} catch {
			json(res, 400, { error: "Invalid JSON body" });
		}
		return;
	}

	json(res, 404, { error: "Not found" });
}

// ── API: CRM ─────────────────────────────────────────────────

async function handleCrmApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	if (!_pi) { json(res, 503, { error: "Agent not ready" }); return; }

	// GET /contacts — list contacts
	if ((subPath === "/contacts" || subPath === "") && req.method === "GET") {
		try {
			const result = await _pi.exec("pi-crm", ["contacts", "list", "--json"], { timeout: 10_000 });
			if (result.code === 0 && result.stdout) {
				json(res, 200, JSON.parse(result.stdout));
			} else {
				json(res, 200, { contacts: [] });
			}
		} catch {
			json(res, 200, { contacts: [] });
		}
		return;
	}

	// POST /contacts — create contact
	if (subPath === "/contacts" && req.method === "POST") {
		try {
			const body = JSON.parse(await readBody(req));
			const args = ["contacts", "create", body.name || "Unknown"];
			if (body.email) args.push("--email", body.email);
			if (body.company) args.push("--company", body.company);
			const result = await _pi.exec("pi-crm", args, { timeout: 10_000 });
			json(res, 201, { ok: result.code === 0, output: result.stdout?.trim() });
		} catch {
			json(res, 400, { error: "Invalid request" });
		}
		return;
	}

	json(res, 404, { error: "Not found" });
}

// ── API: Calendar ────────────────────────────────────────────

async function handleCalendarApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	if (!_pi) { json(res, 503, { error: "Agent not ready" }); return; }

	// GET /events — list upcoming events
	if ((subPath === "/events" || subPath === "") && req.method === "GET") {
		try {
			const result = await _pi.exec("pi-calendar", ["events", "list", "--json"], { timeout: 10_000 });
			if (result.code === 0 && result.stdout) {
				json(res, 200, JSON.parse(result.stdout));
			} else {
				json(res, 200, { events: [] });
			}
		} catch {
			json(res, 200, { events: [] });
		}
		return;
	}

	// POST /events — create event
	if (subPath === "/events" && req.method === "POST") {
		try {
			const body = JSON.parse(await readBody(req));
			const args = ["events", "create", body.title || "Untitled"];
			if (body.date) args.push("--date", body.date);
			if (body.time) args.push("--time", body.time);
			const result = await _pi.exec("pi-calendar", args, { timeout: 10_000 });
			json(res, 201, { ok: result.code === 0, output: result.stdout?.trim() });
		} catch {
			json(res, 400, { error: "Invalid request" });
		}
		return;
	}

	json(res, 404, { error: "Not found" });
}

// ── API: Cron ────────────────────────────────────────────────

async function handleCronApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	// GET /jobs — list all cron jobs
	if ((subPath === "/jobs" || subPath === "") && req.method === "GET") {
		if (!_pi) { json(res, 503, { error: "Agent not ready" }); return; }
		try {
			const result = await _pi.exec("pi-cron", ["list", "--json"], { timeout: 10_000 });
			if (result.code === 0 && result.stdout) {
				json(res, 200, JSON.parse(result.stdout));
			} else {
				// pi-cron may not be installed — return empty list
				json(res, 200, { jobs: [] });
			}
		} catch {
			json(res, 200, { jobs: [] });
		}
		return;
	}

	// POST /jobs/:name/toggle — enable/disable
	if (subPath.match(/^\/jobs\/[^/]+\/toggle$/) && req.method === "POST") {
		const name = decodeURIComponent(subPath.split("/")[2]);
		try {
			const body = JSON.parse(await readBody(req));
			if (!_pi) { json(res, 503, { error: "Agent not ready" }); return; }
			const action = body.enabled ? "enable" : "disable";
			const result = await _pi.exec("pi-cron", [action, name], { timeout: 10_000 });
			json(res, 200, { ok: result.code === 0, output: result.stdout?.trim() });
		} catch {
			json(res, 400, { error: "Invalid request" });
		}
		return;
	}

	// POST /jobs/:name/run — trigger manual run
	if (subPath.match(/^\/jobs\/[^/]+\/run$/) && req.method === "POST") {
		if (!_pi) { json(res, 503, { error: "Agent not ready" }); return; }
		const name = decodeURIComponent(subPath.split("/")[2]);
		try {
			const result = await _pi.exec("pi-cron", ["run", name], { timeout: 30_000 });
			json(res, 200, { ok: result.code === 0, output: result.stdout?.trim() });
		} catch {
			json(res, 500, { error: "Run failed" });
		}
		return;
	}

	json(res, 404, { error: "Not found" });
}

// ── API: Files ───────────────────────────────────────────────

let _cwd = process.cwd();

const SKIP_DIRS = new Set(["node_modules", ".git", ".todos", "dist", "build", ".next", ".nuxt", "__pycache__"]);

function safeResolvePath(requestedPath: string): string | null {
	const resolved = path.resolve(_cwd, requestedPath);
	// Prevent path traversal — must stay within cwd
	if (!resolved.startsWith(_cwd + path.sep) && resolved !== _cwd) return null;
	// Dereference symlinks to prevent sandbox escape
	try {
		const real = fs.realpathSync(resolved);
		if (!real.startsWith(_cwd + path.sep) && real !== _cwd) return null;
		return real;
	} catch {
		// Path doesn't exist yet (e.g. new file write) — allow if logical path is valid
		return resolved;
	}
}

async function handleFilesApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const filePath = url.searchParams.get("path") ?? "/";

	// GET /list?path=/ — list directory contents
	if ((subPath === "/list" || subPath === "") && req.method === "GET") {
		const resolved = safeResolvePath(filePath);
		if (!resolved) { json(res, 400, { error: "Invalid path" }); return; }

		try {
			const stat = fs.statSync(resolved);
			if (!stat.isDirectory()) { json(res, 400, { error: "Not a directory" }); return; }

			const entries = fs.readdirSync(resolved, { withFileTypes: true });
			const items = entries
				.filter(e => !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
				.map(e => {
					const fullPath = path.join(resolved, e.name);
					const relativePath = path.relative(_cwd, fullPath);
					try {
						const s = fs.statSync(fullPath);
						return {
							name: e.name,
							path: relativePath,
							type: e.isDirectory() ? "directory" : "file",
							size: e.isDirectory() ? 0 : s.size,
							modified: s.mtime.toISOString(),
						};
					} catch {
						return { name: e.name, path: relativePath, type: e.isDirectory() ? "directory" : "file", size: 0, modified: "" };
					}
				})
				.sort((a, b) => {
					if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
					return a.name.localeCompare(b.name);
				});

			json(res, 200, { path: path.relative(_cwd, resolved) || ".", items });
		} catch {
			json(res, 404, { error: "Directory not found" });
		}
		return;
	}

	// GET /read?path=src/index.ts — read file content
	if (subPath === "/read" && req.method === "GET") {
		const resolved = safeResolvePath(filePath);
		if (!resolved) { json(res, 400, { error: "Invalid path" }); return; }

		try {
			const stat = fs.statSync(resolved);
			if (stat.isDirectory()) { json(res, 400, { error: "Is a directory" }); return; }
			if (stat.size > 512 * 1024) { json(res, 400, { error: "File too large (max 512KB)" }); return; }
			const content = fs.readFileSync(resolved, "utf-8");
			json(res, 200, { path: path.relative(_cwd, resolved), content, size: stat.size });
		} catch {
			json(res, 404, { error: "File not found" });
		}
		return;
	}

	json(res, 404, { error: "Not found" });
}

// ── Route handlers ───────────────────────────────────────────

function handlePage(_req: IncomingMessage, res: ServerResponse, subPath: string): void {
	const p = subPath.replace(/\/+$/, "") || "/";

	switch (p) {
		case "/":
			send(res, 200, "text/html; charset=utf-8", APP_HTML);
			return;
		case "/manifest.json":
			send(res, 200, "application/manifest+json; charset=utf-8", MANIFEST_JSON);
			return;
		case "/sw.js":
			send(res, 200, "application/javascript; charset=utf-8", SW_JS);
			return;
		default:
			// Screen JS modules: /mobile/screens/chat.js → public/screens/chat.js
			if (p.startsWith("/screens/") && p.endsWith(".js")) {
				const screenName = p.slice("/screens/".length, -3);
				// Reject screen names with path traversal attempts
				if (screenName.includes("/") || screenName.startsWith("..")) {
					send(res, 404, "text/plain", "Not found");
					return;
				}
				const content = getScreenJs(screenName);
				if (content) {
					send(res, 200, "application/javascript; charset=utf-8", content);
					return;
				}
			}
			// SPA fallback
			send(res, 200, "text/html; charset=utf-8", APP_HTML);
			return;
	}
}

async function handleApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	const p = subPath.replace(/\/+$/, "") || "/";

	// Health check
	if (p === "/health") {
		json(res, 200, { status: "ok", version: "0.1.0", timestamp: new Date().toISOString() });
		return;
	}

	// Status API — aggregated agent health
	if (p === "/status") {
		const tools = _pi ? _pi.getAllTools() : [];
		const uptime = process.uptime();
		const mem = process.memoryUsage();
		json(res, 200, {
			agent: { name: "Pi Agent", status: _pi ? "healthy" : "down", version: "0.1.0" },
			system: {
				nodeVersion: process.version,
				platform: process.platform,
				arch: process.arch,
				uptimeSeconds: Math.round(uptime),
				memoryMB: Math.round(mem.rss / 1024 / 1024),
				heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
				heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
			},
			tools: { count: tools.length, names: tools.map(t => t.name).sort() },
			sseClients: sseClients.size,
			timestamp: new Date().toISOString(),
		});
		return;
	}

	// Chat API
	if (p.startsWith("/chat")) {
		await handleChatApi(req, res, p.slice("/chat".length) || "/");
		return;
	}

	// Tasks API — proxy to td CLI
	if (p.startsWith("/td")) {
		await handleTdApi(req, res, p.slice("/td".length) || "/");
		return;
	}

	// Files API — workspace file browser
	if (p.startsWith("/files")) {
		await handleFilesApi(req, res, p.slice("/files".length) || "/");
		return;
	}

	// CRM API — contact management proxy
	if (p.startsWith("/crm")) {
		await handleCrmApi(req, res, p.slice("/crm".length) || "/");
		return;
	}

	// Calendar API — event management proxy
	if (p.startsWith("/calendar")) {
		await handleCalendarApi(req, res, p.slice("/calendar".length) || "/");
		return;
	}

	// Skills API — list registered skills
	if (p === "/skills" && req.method === "GET") {
		const tools = _pi ? _pi.getAllTools() : [];
		const skills = tools.map(t => ({
			name: t.name,
			description: t.description ?? "",
		}));
		json(res, 200, { skills });
		return;
	}

	// Extensions API — list registered tools/extensions
	if (p === "/extensions" && req.method === "GET") {
		const tools = _pi ? _pi.getAllTools() : [];
		const grouped: Record<string, string[]> = {};
		for (const t of tools) {
			const prefix = t.name.includes("_") ? t.name.split("_")[0] : "core";
			if (!grouped[prefix]) grouped[prefix] = [];
			grouped[prefix].push(t.name);
		}
		const extensions = Object.entries(grouped).map(([name, toolNames]) => ({
			name,
			tools: toolNames,
			toolCount: toolNames.length,
		}));
		json(res, 200, { extensions });
		return;
	}

	// Cron API — job management
	if (p.startsWith("/cron")) {
		await handleCronApi(req, res, p.slice("/cron".length) || "/");
		return;
	}

	// Logs API — live log streaming
	if (p === "/logs/events" && req.method === "GET") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.write(`data: ${JSON.stringify({ type: "connected", time: new Date().toISOString() })}\n\n`);
		logClients.add(res);
		const keepalive = setInterval(() => {
			if (!res.writable) { clearInterval(keepalive); return; }
			try { res.write(": ping\n\n"); } catch { clearInterval(keepalive); logClients.delete(res); }
		}, 15_000);
		req.on("close", () => { clearInterval(keepalive); logClients.delete(res); });
		return;
	}

	json(res, 404, { error: "Not found" });
}

// ── Extension entry point ────────────────────────────────────

export default function (pi: ExtensionAPI) {
	_pi = pi;

	function mount(): void {
		pi.events.emit("web:mount", {
			name: "mobile",
			label: "Mobile",
			description: "PWA mobile app for Pi agents",
			prefix: "/mobile",
			handler: handlePage,
		});

		pi.events.emit("web:mount-api", {
			name: "mobile-api",
			label: "Mobile API",
			description: "Mobile app API endpoints",
			prefix: "/mobile",
			handler: handleApi,
		});
	}

	pi.events.on("web:ready", mount);
	pi.on("session_start", async (_event, ctx) => {
		_cwd = ctx.cwd;
	});

	// ── SSE event forwarding ──────────────────────────────
	// Register once — broadcast to all connected SSE clients.

	pi.on("agent_start", async () => {
		broadcast({ type: "agent_start", time: new Date().toISOString() });
	});

	pi.on("agent_end", async () => {
		broadcast({ type: "agent_end", time: new Date().toISOString() });
	});

	pi.on("turn_end", async (event) => {
		const msg = event.message as { role?: string; content?: unknown[] } | undefined;
		const content: unknown[] = [];
		if (msg?.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				const b = block as Record<string, unknown>;
				if (b.type === "text") {
					content.push({ type: "text", text: String(b.text ?? "").slice(0, 8192) });
				} else if (b.type === "thinking") {
					content.push({ type: "thinking", thinking: String(b.thinking ?? "").slice(0, 4096) });
				}
			}
		}
		broadcast({ type: "turn_end", turn: event.turnIndex, content, toolResults: event.toolResults.length });
	});

	pi.on("tool_call", async (event) => {
		broadcast({ type: "tool_start", toolName: event.toolName, toolCallId: event.toolCallId });
	});

	pi.on("tool_result", async (event) => {
		const content: unknown[] = [];
		for (const c of event.content) {
			const b = c as unknown as Record<string, unknown>;
			if (b.type === "text") {
				content.push({ type: "text", text: String(b.text ?? "").slice(0, 4096) });
			}
		}
		broadcast({ type: "tool_end", toolName: event.toolName, toolCallId: event.toolCallId, isError: event.isError, content });
	});

	// ── Command result forwarding ──────────────────────────────
	// When extensions send command_result via pi.sendMessage(), forward to SSE clients.
	// Only forward results intended for this extension (source matching).
	pi.events.on("command_result", (data: unknown) => {
		const d = data as { command?: string; message?: string; type?: string; source?: string };
		// Only forward if source is empty (TUI/channels) or matches pi-mobile
		if (d.source && d.source !== "pi-mobile") return;
		broadcast({ type: "command_result", command: d.command, message: d.message, notificationType: d.type, time: new Date().toISOString() });
	});

	// ── Log event forwarding ──────────────────────────────

	pi.on("tool_call", async (event) => {
		broadcastLog({ level: "info", source: "tool", msg: `→ ${event.toolName}`, time: new Date().toISOString() });
	});

	pi.on("tool_result", async (event) => {
		const level = event.isError ? "error" : "info";
		broadcastLog({ level, source: "tool", msg: `← ${event.toolName}${event.isError ? " (error)" : ""}`, time: new Date().toISOString() });
	});

	pi.on("session_shutdown", async () => {
		_pi = null;
		for (const res of sseClients) { try { res.end(); } catch {} }
		sseClients.clear();
		for (const res of logClients) { try { res.end(); } catch {} }
		logClients.clear();
	});
}
