/**
 * pi-td — td task management extension for pi.
 *
 * Optionally serves the /tasks page and /api/td/* endpoints via pi-webserver.
 * Web UI can be toggled via settings: { "pi-td": { "webui": true } }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { badRequest, html, json, notFound, readBody, serverError } from "./http-helpers.ts";
import { getAllProjectIssues, getCrossProjectStats, getProjectTree } from "./cross-project.ts";
import { getCrossProjectConfig, loadTdSettings } from "./td-settings.ts";
import { registerTdTool } from "./tool.ts";

const TASKS_HTML = fs.readFileSync(
	path.resolve(import.meta.dirname, "./tasks.html"),
	"utf-8",
);

let sessionCwd = process.cwd();

type RouteHandler = (
	req: IncomingMessage,
	res: ServerResponse,
	subPath: string,
) => void | Promise<void>;

interface MountConfig {
	name: string;
	label?: string;
	description?: string;
	prefix: string;
	handler: RouteHandler;
	skipAuth?: boolean;
}

interface TdOkResult {
	ok: true;
	data: string;
}

interface TdErrorResult {
	ok: false;
	error: string;
	cmd: string;
}

type TdResult = TdOkResult | TdErrorResult;

async function runTd(pi: ExtensionAPI, args: string[], cwd?: string): Promise<TdResult> {
	const cmd = `td ${args.join(" ")}`;
	try {
		const opts: { timeout: number; cwd?: string } = { timeout: 30_000 };
		if (cwd) opts.cwd = cwd;
		const result = await pi.exec("td", args, opts);
		const stdout = result.stdout?.trim() ?? "";
		const stderr = result.stderr?.trim() || "";
		if (result.code !== 0) {
			return { ok: false, error: stderr || stdout || `Exit code ${result.code}`, cmd };
		}
		if (stdout.startsWith("ERROR:") || stdout.startsWith("Warning: cannot")) {
			return { ok: false, error: stdout, cmd };
		}
		return { ok: true, data: stdout };
	} catch (err: any) {
		return { ok: false, error: err.message ?? "Unknown error executing td", cmd };
	}
}

/** Validate that projectPath is within the cross-project root (prevents path traversal). */
function validateProjectPath(projectPath: string, res: ServerResponse): string | null {
	const config = getCrossProjectConfig(sessionCwd);
	if (!config) {
		badRequest(res, "Cross-project not configured");
		return null;
	}
	if (!projectPath || typeof projectPath !== "string") {
		badRequest(res, "projectPath is required");
		return null;
	}
	// Resolve symlinks to prevent escaping the root via symlink targets
	let resolved: string;
	let root: string;
	try {
		resolved = fs.realpathSync(path.resolve(projectPath));
		root = fs.realpathSync(path.resolve(config.rootDir));
	} catch {
		badRequest(res, "projectPath does not exist");
		return null;
	}
	if (!resolved.startsWith(root + path.sep) && resolved !== root) {
		badRequest(res, "projectPath is outside the cross-project root");
		return null;
	}
	return resolved;
}

function normalizePath(subPath: string): string {
	if (!subPath || subPath === "/") return "/";
	return subPath.endsWith("/") ? subPath.slice(0, -1) : subPath;
}

async function readJson(req: IncomingMessage, res: ServerResponse, limit = 65_536): Promise<any | null> {
	try {
		const body = await readBody(req);
		if (body.length > limit) {
			badRequest(res, "Request body too large");
			return null;
		}
		if (!body) return {};
		return JSON.parse(body);
	} catch (err: any) {
		badRequest(res, err?.message ?? "Invalid JSON");
		return null;
	}
}

async function handleList(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const args = ["list", "--json"];
	const type = url.searchParams.get("type");
	const priority = url.searchParams.get("priority");
	const showAll = url.searchParams.get("all");
	if (type) args.push("--type", type);
	if (priority) args.push("--priority", priority);
	if (showAll) args.push("--all");
	const result = await runTd(pi, args);
	if (!result.ok) {
		serverError(res, result.error);
		return;
	}
	let issues: any[] = [];
	try {
		issues = JSON.parse(result.data) || [];
	} catch {
		issues = [];
	}
	await Promise.all(issues.map(async (issue: any) => {
		try {
			const detail = await runTd(pi, ["show", issue.id, "--json"]);
			if (detail.ok) {
				const parsed = JSON.parse(detail.data);
				issue.log_count = parsed.logs?.length ?? 0;
				issue.has_handoff = !!(
					parsed.handoff && (
						parsed.handoff.done?.length ||
						parsed.handoff.remaining?.length ||
						parsed.handoff.decisions?.length ||
						parsed.handoff.uncertain?.length
					)
				);
				issue.uncertain_items = parsed.handoff?.uncertain ?? [];
				issue.last_log = parsed.logs?.length ? parsed.logs[parsed.logs.length - 1] : null;
			}
		} catch {
			// best-effort enrichment
		}
	}));
	json(res, 200, issues);
}

async function handleDetail(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const id = url.searchParams.get("id");
	if (!id) {
		badRequest(res, "Missing id parameter");
		return;
	}
	const result = await runTd(pi, ["show", id, "--json"]);
	if (!result.ok) {
		json(res, 404, { error: result.error });
		return;
	}
	try {
		json(res, 200, JSON.parse(result.data));
	} catch (err: any) {
		serverError(res, err?.message ?? "Invalid td JSON output");
	}
}

async function handleCreate(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await readJson(req, res);
	if (!body) return;
	const { title, description, type, priority, labels, parent } = body;
	if (!title) {
		badRequest(res, "title is required");
		return;
	}
	const args = ["create", title];
	if (type) args.push("--type", type);
	if (priority) args.push("--priority", priority);
	if (description) args.push("--description", description);
	if (labels) args.push("--labels", labels);
	if (parent) args.push("--parent", parent);
	const result = await runTd(pi, args);
	if (!result.ok) {
		badRequest(res, result.error);
		return;
	}
	json(res, 201, { message: result.data });
}

async function handleUpdate(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await readJson(req, res);
	if (!body) return;
	const { id, status, title, priority, description, labels } = body;
	if (!id) {
		badRequest(res, "id is required");
		return;
	}
	const args = ["update", id];
	if (status) args.push("--status", status);
	if (title) args.push("--title", title);
	if (priority) args.push("--priority", priority);
	if (description) args.push("--description", description);
	if (labels) args.push("--labels", labels);
	if (args.length === 2) {
		badRequest(res, "Nothing to update");
		return;
	}
	const result = await runTd(pi, args);
	if (!result.ok) {
		badRequest(res, result.error);
		return;
	}
	json(res, 200, { message: result.data });
}

async function handleHandoff(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await readJson(req, res);
	if (!body) return;
	const { id, done, remaining, decisions, uncertain, note } = body;
	if (!id) {
		badRequest(res, "id is required");
		return;
	}
	const args = ["handoff", id];
	if (note) args.push("--note", note);
	if (Array.isArray(done)) for (const item of done) args.push("--done", item);
	if (Array.isArray(remaining)) for (const item of remaining) args.push("--remaining", item);
	if (Array.isArray(decisions)) for (const item of decisions) args.push("--decision", item);
	if (Array.isArray(uncertain)) for (const item of uncertain) args.push("--uncertain", item);
	const result = await runTd(pi, args);
	if (!result.ok) {
		badRequest(res, result.error);
		return;
	}
	json(res, 200, { message: result.data });
}

async function handleReview(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await readJson(req, res);
	if (!body) return;
	const { id, message } = body;
	if (!id) {
		badRequest(res, "id is required");
		return;
	}
	const args = ["review", id];
	if (message) args.push("--note", message);
	const result = await runTd(pi, args);
	if (!result.ok) {
		badRequest(res, result.error);
		return;
	}
	json(res, 200, { message: result.data });
}

async function handleApprove(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await readJson(req, res);
	if (!body) return;
	const { id, reason } = body;
	if (!id) {
		badRequest(res, "id is required");
		return;
	}
	const args = ["approve", id];
	if (reason) args.push("--reason", reason);
	let result = await runTd(pi, args);
	if (!result.ok && result.error.includes("cannot approve")) {
		const newSession = await runTd(pi, ["session", "--new"]);
		if (!newSession.ok) {
			badRequest(res, `Failed to create review session: ${newSession.error}`);
			return;
		}
		result = await runTd(pi, args);
	}
	if (!result.ok) {
		badRequest(res, result.error);
		return;
	}
	json(res, 200, { message: result.data });
}

async function handleReject(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await readJson(req, res);
	if (!body) return;
	const { id, reason } = body;
	if (!id) {
		badRequest(res, "id is required");
		return;
	}
	const args = ["reject", id];
	if (reason) args.push("--reason", reason);
	let result = await runTd(pi, args);
	if (!result.ok && result.error.includes("cannot reject")) {
		const newSession = await runTd(pi, ["session", "--new"]);
		if (!newSession.ok) {
			badRequest(res, `Failed to create review session: ${newSession.error}`);
			return;
		}
		result = await runTd(pi, args);
	}
	if (!result.ok) {
		badRequest(res, result.error);
		return;
	}
	json(res, 200, { message: result.data });
}

async function handleLog(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await readJson(req, res);
	if (!body) return;
	const { id, message, type } = body;
	if (!id) {
		badRequest(res, "id is required");
		return;
	}
	if (!message) {
		badRequest(res, "message is required");
		return;
	}
	const args = ["log", "--issue", id];
	const validTypes = ["progress", "blocker", "decision", "hypothesis", "tried", "result"];
	if (type && validTypes.includes(type)) args.push("--type", type);
	args.push(message);
	const result = await runTd(pi, args);
	if (!result.ok) {
		badRequest(res, result.error);
		return;
	}
	json(res, 200, { message: result.data });
}

async function handleDelete(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await readJson(req, res);
	if (!body) return;
	const { id } = body;
	if (!id) {
		badRequest(res, "id is required");
		return;
	}
	const result = await runTd(pi, ["delete", id, "--force"]);
	if (!result.ok) {
		badRequest(res, result.error);
		return;
	}
	json(res, 200, { message: result.data });
}

async function handleApi(pi: ExtensionAPI, req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	const method = req.method ?? "GET";
	const pathKey = normalizePath(subPath);

	if (method === "GET" && pathKey === "/") {
		await handleList(pi, req, res);
		return;
	}
	if (method === "GET" && pathKey === "/detail") {
		await handleDetail(pi, req, res);
		return;
	}
	if (method === "POST" && pathKey === "/") {
		await handleCreate(pi, req, res);
		return;
	}
	if (method === "PATCH" && pathKey === "/") {
		await handleUpdate(pi, req, res);
		return;
	}
	if (method === "POST" && pathKey === "/handoff") {
		await handleHandoff(pi, req, res);
		return;
	}
	if (method === "POST" && pathKey === "/review") {
		await handleReview(pi, req, res);
		return;
	}
	if (method === "POST" && pathKey === "/approve") {
		await handleApprove(pi, req, res);
		return;
	}
	if (method === "POST" && pathKey === "/reject") {
		await handleReject(pi, req, res);
		return;
	}
	if (method === "POST" && pathKey === "/log") {
		await handleLog(pi, req, res);
		return;
	}
	if (method === "DELETE" && pathKey === "/") {
		await handleDelete(pi, req, res);
		return;
	}
	if (method === "GET" && pathKey === "/tree") {
		try {
			json(res, 200, getProjectTree(sessionCwd));
		} catch (err: any) {
			serverError(res, err?.message ?? "Failed to build tree");
		}
		return;
	}
	if (method === "GET" && pathKey === "/config") {
		const config = getCrossProjectConfig(sessionCwd);
		json(res, 200, {
			crossProjectEnabled: !!config,
			crossProjectDepth: config?.maxDepth ?? 1,
		});
		return;
	}
	if (method === "GET" && pathKey === "/global") {
		const config = getCrossProjectConfig(sessionCwd);
		if (!config) {
			notFound(res);
			return;
		}
		try {
			const url = new URL(req.url ?? "/", "http://localhost");
			const result = getAllProjectIssues({
				includeClosed: url.searchParams.get("all") === "1",
				status: url.searchParams.get("status") || undefined,
				priority: url.searchParams.get("priority") || undefined,
				type: url.searchParams.get("type") || undefined,
				project: url.searchParams.get("project") || undefined,
			}, config);
			json(res, 200, result);
		} catch (err: any) {
			serverError(res, err?.message ?? "Failed to read global issues");
		}
		return;
	}
	// ── Global detail (read from project's td) ─────────────
	if (method === "GET" && pathKey === "/global/detail") {
		const url = new URL(req.url ?? "/", "http://localhost");
		const id = url.searchParams.get("id");
		const projectPath = url.searchParams.get("projectPath");
		if (!id) { badRequest(res, "Missing id parameter"); return; }
		const resolved = validateProjectPath(projectPath ?? "", res);
		if (!resolved) return;
		const result = await runTd(pi, ["show", id, "--json"], resolved);
		if (!result.ok) { json(res, 404, { error: result.error }); return; }
		try { json(res, 200, JSON.parse(result.data)); }
		catch (err: any) { serverError(res, err?.message ?? "Invalid td JSON output"); }
		return;
	}

	// ── Global write endpoints ──────────────────────────────
	if (method === "PATCH" && pathKey === "/global") {
		const body = await readJson(req, res);
		if (!body) return;
		const resolved = validateProjectPath(body.projectPath, res);
		if (!resolved) return;
		const { id, status, title, priority, description, labels } = body;
		if (!id) { badRequest(res, "id is required"); return; }
		const args = ["update", id];
		if (status) args.push("--status", status);
		if (title) args.push("--title", title);
		if (priority) args.push("--priority", priority);
		if (description) args.push("--description", description);
		if (labels) args.push("--labels", labels);
		if (args.length === 2) { badRequest(res, "Nothing to update"); return; }
		const result = await runTd(pi, args, resolved);
		if (!result.ok) { badRequest(res, result.error); return; }
		json(res, 200, { message: result.data });
		return;
	}
	if (method === "POST" && pathKey === "/global") {
		const body = await readJson(req, res);
		if (!body) return;
		const resolved = validateProjectPath(body.projectPath, res);
		if (!resolved) return;
		const { title, description, type, priority, labels, parent } = body;
		if (!title) { badRequest(res, "title is required"); return; }
		const args = ["create", title];
		if (type) args.push("--type", type);
		if (priority) args.push("--priority", priority);
		if (description) args.push("--description", description);
		if (labels) args.push("--labels", labels);
		if (parent) args.push("--parent", parent);
		const result = await runTd(pi, args, resolved);
		if (!result.ok) { badRequest(res, result.error); return; }
		json(res, 201, { message: result.data });
		return;
	}
	if (method === "DELETE" && pathKey === "/global") {
		const body = await readJson(req, res);
		if (!body) return;
		const resolved = validateProjectPath(body.projectPath, res);
		if (!resolved) return;
		const { id } = body;
		if (!id) { badRequest(res, "id is required"); return; }
		const result = await runTd(pi, ["delete", id, "--force"], resolved);
		if (!result.ok) { badRequest(res, result.error); return; }
		json(res, 200, { message: result.data });
		return;
	}
	if (method === "POST" && pathKey === "/global/review") {
		const body = await readJson(req, res);
		if (!body) return;
		const resolved = validateProjectPath(body.projectPath, res);
		if (!resolved) return;
		const { id, message } = body;
		if (!id) { badRequest(res, "id is required"); return; }
		const args = ["review", id];
		if (message) args.push("--note", message);
		const result = await runTd(pi, args, resolved);
		if (!result.ok) { badRequest(res, result.error); return; }
		json(res, 200, { message: result.data });
		return;
	}
	if (method === "POST" && pathKey === "/global/approve") {
		const body = await readJson(req, res);
		if (!body) return;
		const resolved = validateProjectPath(body.projectPath, res);
		if (!resolved) return;
		const { id, reason } = body;
		if (!id) { badRequest(res, "id is required"); return; }
		const args = ["approve", id];
		if (reason) args.push("--reason", reason);
		let result = await runTd(pi, args, resolved);
		if (!result.ok && result.error.includes("cannot approve")) {
			const newSession = await runTd(pi, ["session", "--new"], resolved);
			if (!newSession.ok) { badRequest(res, `Failed to create review session: ${newSession.error}`); return; }
			result = await runTd(pi, args, resolved);
		}
		if (!result.ok) { badRequest(res, result.error); return; }
		json(res, 200, { message: result.data });
		return;
	}
	if (method === "POST" && pathKey === "/global/reject") {
		const body = await readJson(req, res);
		if (!body) return;
		const resolved = validateProjectPath(body.projectPath, res);
		if (!resolved) return;
		const { id, reason } = body;
		if (!id) { badRequest(res, "id is required"); return; }
		const args = ["reject", id];
		if (reason) args.push("--reason", reason);
		let result = await runTd(pi, args, resolved);
		if (!result.ok && result.error.includes("cannot reject")) {
			const newSession = await runTd(pi, ["session", "--new"], resolved);
			if (!newSession.ok) { badRequest(res, `Failed to create review session: ${newSession.error}`); return; }
			result = await runTd(pi, args, resolved);
		}
		if (!result.ok) { badRequest(res, result.error); return; }
		json(res, 200, { message: result.data });
		return;
	}
	if (method === "POST" && pathKey === "/global/log") {
		const body = await readJson(req, res);
		if (!body) return;
		const resolved = validateProjectPath(body.projectPath, res);
		if (!resolved) return;
		const { id, message, type } = body;
		if (!id) { badRequest(res, "id is required"); return; }
		if (!message) { badRequest(res, "message is required"); return; }
		const args = ["log", "--issue", id];
		const validTypes = ["progress", "blocker", "decision", "hypothesis", "tried", "result"];
		if (type && validTypes.includes(type)) args.push("--type", type);
		args.push(message);
		const result = await runTd(pi, args, resolved);
		if (!result.ok) { badRequest(res, result.error); return; }
		json(res, 200, { message: result.data });
		return;
	}
	if (method === "GET" && pathKey === "/global/stats") {
		const config = getCrossProjectConfig(sessionCwd);
		if (!config) {
			notFound(res);
			return;
		}
		try {
			json(res, 200, getCrossProjectStats(config));
		} catch (err: any) {
			serverError(res, err?.message ?? "Failed to read stats");
		}
		return;
	}

	notFound(res);
}

function mountRoutes(pi: ExtensionAPI): void {
	const webMount: MountConfig = {
		name: "td-webui",
		label: "Tasks",
		description: "td task dashboard",
		prefix: "/tasks",
		handler: (req, res, subPath) => {
			if (req.method !== "GET") {
				notFound(res);
				return;
			}
			const pathKey = normalizePath(subPath);
			if (pathKey === "/") {
				html(res, TASKS_HTML);
				return;
			}
			notFound(res);
		},
	};

	const apiMount: MountConfig = {
		name: "td-webui-api",
		label: "td API",
		description: "td API endpoints for the tasks dashboard",
		prefix: "/td",
		handler: (req, res, subPath) => handleApi(pi, req, res, subPath),
	};

	pi.events.emit("web:mount", webMount);
	pi.events.emit("web:mount-api", apiMount);
}

export default function (pi: ExtensionAPI) {
	// Register the td tool for LLM access
	registerTdTool(pi, () => sessionCwd);

	let webMounted = false;

	function mountWeb(): void {
		if (webMounted) return;
		mountRoutes(pi);
		webMounted = true;
	}

	function unmountWeb(): void {
		if (!webMounted) return;
		pi.events.emit("web:unmount", { name: "td-webui" });
		pi.events.emit("web:unmount-api", { name: "td-webui-api" });
		webMounted = false;
	}

	pi.on("session_start", async (_event, ctx) => {
		sessionCwd = ctx.cwd;
		const settings = loadTdSettings(ctx.cwd);
		if (settings.webui) {
			mountWeb();
		}
	});

	pi.on("session_switch", async (_event, ctx) => {
		sessionCwd = ctx.cwd;
	});

	pi.on("session_fork", async (_event, ctx) => {
		sessionCwd = ctx.cwd;
	});

	pi.events.on("web:ready", () => {
		const settings = loadTdSettings(sessionCwd);
		if (settings.webui) {
			mountWeb();
		}
	});

	pi.on("session_shutdown", async () => {
		unmountWeb();
	});
}
