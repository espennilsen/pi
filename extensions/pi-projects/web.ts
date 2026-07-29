/**
 * pi-projects — Web UI and REST API.
 *
 * Mounts on pi-webserver via event bus:
 *   Page: /projects       — Dashboard UI
 *   API:  /api/projects   — JSON endpoints
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scanProjects } from "./scanner.ts";
import { getProjectsStore } from "./store.ts";

const execFileAsync = promisify(execFile);

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
	const qIdx = subPath.indexOf("?");
	const p = (qIdx >= 0 ? subPath.slice(0, qIdx) : subPath).replace(/\/+$/, "") || "/";

	// Forward API subpaths (preserve full subPath including query string)
	if (p.startsWith("/api/projects")) {
		const apiPath = subPath.slice("/api/projects".length) || "/";
		return handleProjectsApi(req, res, apiPath);
	}

	if (p === "/") { htmlResponse(res, PROJECTS_HTML); return; }
	json(res, 404, { error: "Not found" });
}

// ── API handler ─────────────────────────────────────────────────

async function handleProjectsApi(req: IncomingMessage, res: ServerResponse, subPath: string): Promise<void> {
	const method = req.method ?? "GET";
	// Strip query string from subPath for route matching, parse query from req.url
	const qIdx = subPath.indexOf("?");
	const p = (qIdx >= 0 ? subPath.slice(0, qIdx) : subPath).replace(/\/+$/, "") || "/";
	const reqUrl = new URL(req.url ?? "/", "http://localhost");

	try {
		const store = getProjectsStore();

		// GET /api/projects — list all projects with git status
		if (method === "GET" && p === "/") {
			const projects = await scanProjects(devDir);
			json(res, 200, projects);
			return;
		}

		// GET /api/projects/detail?path=... — project detail (README, td tasks, package.json info)
		if (method === "GET" && p === "/detail") {
			const projectPath = reqUrl.searchParams.get("path");
			if (!projectPath) { json(res, 400, { error: "path query param required" }); return; }
			if (!fs.existsSync(projectPath)) { json(res, 404, { error: "Project path not found" }); return; }

			const detail: Record<string, any> = { path: projectPath };

			// Read README.md (case-insensitive search)
			try {
				const entries = fs.readdirSync(projectPath);
				const readmeFile = entries.find(e => /^readme\.md$/i.test(e));
				if (readmeFile) {
					const readmePath = path.join(projectPath, readmeFile);
					const content = fs.readFileSync(readmePath, "utf-8");
					// Truncate very large readmes for the UI
					detail.readme = content.length > 50000 ? content.slice(0, 50000) + "\n\n...(truncated)" : content;
				} else {
					detail.readme = null;
				}
			} catch { detail.readme = null; }

			// Read package.json for description, scripts, dependencies
			try {
				const pkgPath = path.join(projectPath, "package.json");
				if (fs.existsSync(pkgPath)) {
					const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
					detail.packageJson = {
						name: pkg.name,
						version: pkg.version,
						description: pkg.description,
						license: pkg.license,
						scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
						dependencies: pkg.dependencies ? Object.keys(pkg.dependencies).length : 0,
						devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0,
					};
				}
			} catch { /* ignore */ }

			// Get td tasks if .todos folder exists
			try {
				const todosDir = path.join(projectPath, ".todos");
				if (fs.existsSync(todosDir) && fs.statSync(todosDir).isDirectory()) {
					const result = await execFileAsync("td", ["list", "--json", "--limit", "50"], {
						cwd: projectPath,
						timeout: 10000,
					});
					detail.tasks = JSON.parse(result.stdout);
				} else {
					detail.tasks = null;
				}
			} catch {
				detail.tasks = null;
			}

			// Get recent git log (last 10 commits)
			try {
				const isGit = fs.existsSync(path.join(projectPath, ".git"));
				if (isGit) {
					const logResult = await execFileAsync("git", [
						"log", "--format=%h%x00%s%x00%aI%x00%an", "-10"
					], { cwd: projectPath, timeout: 5000 });
					detail.recentCommits = logResult.stdout.trim().split("\n").filter(Boolean).map(line => {
						const [hash, msg, date, author] = line.split("\0");
						return { hash, msg, date, author };
					});
				}
			} catch { /* ignore */ }

			json(res, 200, detail);
			return;
		}

		// GET /api/projects/sources — list scan directories
		if (method === "GET" && p === "/sources") {
			json(res, 200, await store.getProjectSources());
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
			const record = await store.addProjectSource(resolved, body.label);
			json(res, 200, record);
			return;
		}

		// DELETE /api/projects/sources — remove a scan directory
		if (method === "DELETE" && p === "/sources") {
			const body = JSON.parse(await readBody(req));
			if (!body.id) { json(res, 400, { error: "id is required" }); return; }
			json(res, 200, { ok: await store.removeProjectSource(body.id) });
			return;
		}

		// GET /api/projects/hidden — list hidden projects
		if (method === "GET" && p === "/hidden") {
			json(res, 200, await store.getHiddenProjects());
			return;
		}

		// POST /api/projects/hide — hide a project
		if (method === "POST" && p === "/hide") {
			const body = JSON.parse(await readBody(req));
			if (!body.path) { json(res, 400, { error: "path is required" }); return; }
			json(res, 200, await store.hideProject(body.path));
			return;
		}

		// POST /api/projects/unhide — restore a hidden project
		if (method === "POST" && p === "/unhide") {
			const body = JSON.parse(await readBody(req));
			if (!body.path) { json(res, 400, { error: "path is required" }); return; }
			json(res, 200, { ok: await store.unhideProject(body.path) });
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
