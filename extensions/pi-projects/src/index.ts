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
 * Data is stored in a lightweight database for scan directories
 * and hidden projects. The actual project data is scanned live from disk.
 *
 * Database backend is configurable:
 *   - Default: local SQLite via better-sqlite3 (db.ts)
 *   - Optional: shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Settings:
 *   "pi-projects": {
 *     "devDir": "~/Dev",              // Root directory to scan for projects
 *     "dbPath": "projects/projects.db", // SQLite file path (sqlite backend only)
 *     "useKysely": true               // Use pi-kysely shared DB instead of SQLite
 *   }
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { resolveSettings } from "./settings.ts";
import { closeProjectsDb } from "./db.ts";
import { setProjectsStore, isStoreReady, createSqliteStore, createKyselyStore } from "./store.ts";
import { scanProjects } from "./scanner.ts";
import { registerProjectsTool } from "./tool.ts";
import { mountProjectsRoutes, unmountProjectsRoutes, setDevDir } from "./web.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let devDir = "";

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);
		devDir = settings.devDir;
		setDevDir(devDir);

		if (settings.useKysely) {
			// ── Kysely backend ──────────────────────────────────
			// Handle both orderings: kysely may already be ready,
			// or it may start after us. Probe first, then listen.

			const initKysely = async () => {
				if (isStoreReady()) return; // already initialized
				try {
					const store = await createKyselyStore(pi.events as any);
					setProjectsStore(store);
					log("ready", { backend: "kysely" });
					mountProjectsRoutes(pi.events);
				} catch (err: any) {
					log("error", { backend: "kysely", error: err.message }, "ERROR");
				}
			};

			// Listen for future kysely:ready events
			pi.events.on("kysely:ready", initKysely);

			// Probe: check if pi-kysely is already available
			log("init", { backend: "kysely", status: "probing for kysely" });
			let kyselyAlreadyReady = false;
			pi.events.emit("kysely:info", {
				reply: () => { kyselyAlreadyReady = true; },
			});
			if (kyselyAlreadyReady) {
				log("init", { backend: "kysely", status: "kysely already available" });
				await initKysely();
			} else {
				log("init", { backend: "kysely", status: "waiting for kysely:ready" });
			}
		} else {
			// ── SQLite backend (default) ────────────────────────
			const agentDir = getAgentDir();
			const dbPath = path.isAbsolute(settings.dbPath)
				? settings.dbPath
				: path.join(agentDir, settings.dbPath);

			const store = await createSqliteStore(dbPath);
			setProjectsStore(store);
			log("init", { backend: "sqlite", devDir, dbPath });

			// Mount web routes
			mountProjectsRoutes(pi.events);
		}
	});

	// Re-mount when pi-webserver starts after us
	pi.events.on("web:ready", () => {
		if (!isStoreReady()) return;
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
