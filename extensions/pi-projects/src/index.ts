/**
 * pi-projects — Project tracking dashboard extension for pi.
 *
 * Auto-discovers git repos in ~/Dev (and custom source directories),
 * shows git status (branch, dirty, ahead/behind), and provides a web dashboard.
 *
 * Provides:
 *   - `projects` tool for the LLM to list/scan/manage projects
 *   - Web dashboard at /projects via pi-webserver
 *   - /projects command for quick status in TUI
 *
 * Data is stored in a lightweight SQLite database for scan directories
 * and hidden projects. The actual project data is scanned live from disk.
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { resolveSettings } from "./settings.ts";
import { initProjectsDb, closeProjectsDb } from "./db.ts";
import { scanProjects } from "./scanner.ts";
import { registerProjectsTool } from "./tool.ts";
import { mountProjectsRoutes, unmountProjectsRoutes, setDevDir } from "./web.ts";

export default function (pi: ExtensionAPI) {
	let devDir = "";

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);
		devDir = settings.devDir;
		setDevDir(devDir);

		const agentDir = getAgentDir();
		const dbPath = path.isAbsolute(settings.dbPath)
			? settings.dbPath
			: path.join(agentDir, settings.dbPath);

		initProjectsDb(dbPath);

		// Mount web routes
		mountProjectsRoutes(pi.events);
	});

	// Re-mount when pi-webserver starts after us
	pi.events.on("web:ready", () => {
		mountProjectsRoutes(pi.events);
	});

	pi.on("session_shutdown", async () => {
		unmountProjectsRoutes(pi.events);
		closeProjectsDb();
	});

	// ── LLM tool ──────────────────────────────────────────────
	registerProjectsTool(pi, () => devDir);

	// ── Command: /projects ────────────────────────────────────

	pi.registerCommand("projects", {
		description: "Show project overview: /projects [search]",
		handler: async (args, ctx) => {
			try {
				const search = args?.trim().toLowerCase();
				let projects = await scanProjects(devDir);

				if (search) {
					projects = projects.filter(p =>
						p.name.toLowerCase().includes(search) ||
						(p.branch ?? "").toLowerCase().includes(search)
					);
				}

				const gitProjects = projects.filter(p => p.is_git);
				const dirty = gitProjects.filter(p => (p.dirty_count ?? 0) > 0);

				const lines = [
					`Projects: ${projects.length} total · ${gitProjects.length} git · ${dirty.length} dirty`,
				];

				if (dirty.length > 0) {
					lines.push("Dirty: " + dirty.map(p => `${p.name} (${p.dirty_count})`).join(", "));
				}

				ctx.ui.notify(lines.join("\n"), "info");
			} catch (e: any) {
				ctx.ui.notify(`pi-projects: ${e.message}`, "error");
			}
		},
	});
}
