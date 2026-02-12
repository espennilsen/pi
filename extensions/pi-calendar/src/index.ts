/**
 * pi-calendar — Calendar tool, web dashboard, and reminders for pi.
 *
 * Provides:
 *   - `calendar` tool — list, create, update, delete, today, upcoming
 *   - /calendar web page — Weekly calendar UI with drag-to-create
 *   - /api/calendar — JSON CRUD endpoints
 *   - Reminders via pi-channels event bus
 *
 * Data stored in $PI_AGENT_HOME/db/calendar.db (default: ~/.pi/agent/db/calendar.db).
 * Integrates with pi-webserver (web UI) and pi-channels (reminders).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { initDb } from "./db.ts";
import { registerCalendarTool } from "./tool.ts";
import { mountCalendarRoutes, unmountCalendarRoutes } from "./web.ts";
import { startReminders, stopReminders } from "./reminders.ts";

const DEFAULT_DB_PATH = "db/calendar.db";

function expandHome(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

function getDbPath(cwd: string): string {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, any>;
	const project = sm.getProjectSettings() as Record<string, any>;
	const configured = project?.["pi-calendar"]?.dbPath ?? global?.["pi-calendar"]?.dbPath;

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

	// Initialize DB and register tool on session start
	pi.on("session_start", async (_event, ctx) => {
		const dbPath = getDbPath(ctx.cwd);
		initDb(dbPath);
		log("init", { dbPath });

		// Mount web routes (no-op if pi-webserver isn't loaded yet)
		mountCalendarRoutes(pi.events);

		// Start reminder checker
		startReminders(pi);
	});

	// Register the tool (available immediately)
	registerCalendarTool(pi);

	// Re-mount when pi-webserver starts after us
	pi.events.on("web:ready", () => {
		mountCalendarRoutes(pi.events);
	});

	pi.on("session_shutdown", async () => {
		stopReminders();
		unmountCalendarRoutes(pi.events);
	});
}
