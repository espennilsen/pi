/**
 * pi-projects — Web UI and REST API.
 *
 * Mounts on pi-webserver via event bus:
 *   Page: /projects       — Dashboard UI
 *   API:  /api/projects   — JSON endpoints
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scanProjects } from "./scanner.ts";
import { getProjectsDbApi } from "./db.ts";

// ── HTTP helpers ────────────────────────────────────────────────

function json(res: ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function htmlResponse(res: ServerResponse, content: string): void {
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
const PROJECTS_HTML = fs.readFileSync(path.join(uiDir, "projects.html"), "utf-8")
	.replace("{{CSS}}", fs.readFileSync(path.join(uiDir, "projects.css"), "utf-8"))
	.replace("{{JS}}", fs.readFileSync(path.join(uiDir, "projects.js"), "utf-8"));

// ── State ───────────────────────────────────────────────────────

let devDir = "";

export function setDevDir(dir: string): void {
	devDir = dir;
}

// ── Types ───────────────────────────────────────────────────────

type RouteHandler = (req: IncomingMessage, res: ServerResponse, subPath: string) => void | Promise<void>;

interface EventBus {
	emit(event: string, data: unknown): void;
}

// ── Page handler ────────────────────────────────────────────────

async function handleProjectsPage(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	if (req.method !== "GET") { json(res, 405, { error: "Method not allowed" }); return; }
	const p = subPath.replace(/\/+$/, "") || "/";

	// Forward API subpaths
	if (p.startsWith("/api/projects")) {
		const apiPath = p.slice("/api/projects".length) || "/";
		return handleProjectsApi(req, res, apiPath);
	}

	if (p === "/") { htmlResponse(res, PROJECTS_HTML); return; }
	json(res, 404, { error: "Not found" });
}

// ── API handler ─────────────────────────────────────────────────

async function handleProjectsApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	const method = req.method ?? "GET";
	const p = subPath.replace(/\/+$/, "") || "/";

	try {
		const dbApi = getProjectsDbApi();

		// GET /api/projects — list all projects with git status
		if (method === "GET" && p === "/") {
			const projects = await scanProjects(devDir);
			json(res, 200, projects);
			return;
		}

		// GET /api/projects/sources — list scan directories
		if (method === "GET" && p === "/sources") {
			json(res, 200, dbApi.getProjectSources());
			return;
		}

		// POST /api/projects/sources — add a scan directory
		if (method === "POST" && p === "/sources") {
			const body = JSON.parse(await readBody(req));
			if (!body.path) { json(res, 400, { error: "path is required" }); return; }
			const resolved = path.resolve(body.path);
			if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
				json(res, 400, { error: "Path does not exist or is not a directory" }); return;
			}
			const record = dbApi.addProjectSource(resolved, body.label);
			json(res, 200, record);
			return;
		}

		// DELETE /api/projects/sources — remove a scan directory
		if (method === "DELETE" && p === "/sources") {
			const body = JSON.parse(await readBody(req));
			if (!body.id) { json(res, 400, { error: "id is required" }); return; }
			json(res, 200, { ok: dbApi.removeProjectSource(body.id) });
			return;
		}

		// GET /api/projects/hidden — list hidden projects
		if (method === "GET" && p === "/hidden") {
			json(res, 200, dbApi.getHiddenProjects());
			return;
		}

		// POST /api/projects/hide — hide a project
		if (method === "POST" && p === "/hide") {
			const body = JSON.parse(await readBody(req));
			if (!body.path) { json(res, 400, { error: "path is required" }); return; }
			json(res, 200, dbApi.hideProject(body.path));
			return;
		}

		// POST /api/projects/unhide — restore a hidden project
		if (method === "POST" && p === "/unhide") {
			const body = JSON.parse(await readBody(req));
			if (!body.path) { json(res, 400, { error: "path is required" }); return; }
			json(res, 200, { ok: dbApi.unhideProject(body.path) });
			return;
		}

		json(res, 404, { error: "Not found" });
	} catch (err: any) {
		json(res, 500, { error: err.message });
	}
}

// ── Mount / unmount ─────────────────────────────────────────────

export function mountProjectsRoutes(bus: EventBus): void {
	bus.emit("web:mount", {
		name: "projects",
		label: "Projects",
		description: "Project tracking dashboard with git status",
		prefix: "/projects",
		handler: handleProjectsPage,
	});
	bus.emit("web:mount-api", {
		name: "projects-api",
		label: "Projects API",
		description: "Projects REST API",
		prefix: "/projects",
		handler: handleProjectsApi,
	});
}

export function unmountProjectsRoutes(bus: EventBus): void {
	bus.emit("web:unmount", { name: "projects" });
	bus.emit("web:unmount-api", { name: "projects-api" });
}
