/**
 * pi-calendar — Calendar tool, web dashboard, and reminders for pi.
 *
 * Provides:
 *   - `calendar` tool — list, create, update, delete, today, upcoming
 *   - /calendar web page — Weekly calendar UI with drag-to-create
 *   - /api/calendar — JSON CRUD endpoints
 *   - Reminders via pi-channels event bus
 *
 * Database backend is configurable:
 *   - Default: local SQLite via better-sqlite3 (db.ts)
 *   - Optional: shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Settings:
 *   "pi-calendar": {
 *     "dbPath": "db/calendar.db",   // SQLite file path (sqlite backend only)
 *     "useKysely": true              // Use pi-kysely shared DB instead of SQLite
 *   }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { setStore, isStoreReady, createSqliteStore, createKyselyStore } from "./store.ts";
import { registerCalendarTool } from "./tool.ts";
import { mountCalendarRoutes, unmountCalendarRoutes } from "./web.ts";
import { startReminders, stopReminders } from "./reminders.ts";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

const DEFAULT_DB_PATH = "db/calendar.db";

function expandHome(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

interface CalendarSettings {
	dbPath?: string;
	useKysely?: boolean;
}

function getSettings(cwd: string): CalendarSettings {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, any>;
	const project = sm.getProjectSettings() as Record<string, any>;
	return {
		...global?.["pi-calendar"],
		...project?.["pi-calendar"],
	};
}

function getDbPath(cwd: string, settings: CalendarSettings): string {
	const agentDir = getAgentDir();
	const configured = settings.dbPath;

	let dbPath: string;
	if (configured) {
		const expanded = expandHome(String(configured).trim());
		dbPath = path.isAbsolute(expanded) ? expanded : path.resolve(agentDir, expanded);
	} else {
		dbPath = path.join(agentDir, DEFAULT_DB_PATH);
	}

	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	return dbPath;
}

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	pi.on("session_start", async (_event, ctx) => {
		const settings = getSettings(ctx.cwd);

		if (settings.useKysely) {
			// ── Kysely backend ──────────────────────────────────
			// Handle both orderings: kysely may already be ready,
			// or it may start after us. Probe first, then listen.

			const initKysely = async () => {
				if (isStoreReady()) return; // already initialized
				try {
					const store = await createKyselyStore(pi.events as any);
					setStore(store);
					log("ready", { backend: "kysely" });
					mountCalendarRoutes(pi.events);
					startReminders(pi);
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
			const dbPath = getDbPath(ctx.cwd, settings);
			log("init", { backend: "sqlite", dbPath });
			const store = await createSqliteStore(dbPath);
			setStore(store);
			log("ready", { backend: "sqlite", dbPath });
			mountCalendarRoutes(pi.events);
			startReminders(pi);
		}
	});

	// Register the tool (available immediately)
	registerCalendarTool(pi);

	// Re-mount when pi-webserver starts after us (only if store is ready)
	pi.events.on("web:ready", () => {
		if (isStoreReady()) {
			mountCalendarRoutes(pi.events);
		}
	});

	pi.on("session_shutdown", async () => {
		stopReminders();
		unmountCalendarRoutes(pi.events);
	});
}
