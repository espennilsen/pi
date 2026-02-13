/**
 * pi-personal-crm — Personal CRM extension for pi.
 *
 * Registers the CRM tool, /crm-web command, and injects system prompt context.
 * Data is stored in a configurable database backend.
 *
 * If the pi-webserver extension is installed, the CRM auto-mounts at /crm
 * on the shared web server. Otherwise, use /crm-web for a standalone server.
 *
 * Database backend is configurable:
 *   - Default: local SQLite via better-sqlite3 (db.ts)
 *   - Optional: shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Settings:
 *   "pi-personal-crm": {
 *     "dbPath": "db/crm.db",   // SQLite file path (sqlite backend only)
 *     "useKysely": true         // Use pi-kysely shared DB instead of SQLite
 *   }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { setCrmStore, createSqliteStore, createKyselyStore, isStoreReady } from "./store.ts";
import { registerCrmTool } from "./tool.ts";
import {
	startStandaloneServer,
	stopStandaloneServer,
	mountOnWebServer,
	isMountedOnWebServer,
} from "./web.ts";

const DEFAULT_DB_PATH = "db/crm.db";

function expandHome(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

interface CrmSettings {
	dbPath?: string;
	useKysely?: boolean;
}

function getSettings(cwd: string): CrmSettings {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, any>;
	const project = sm.getProjectSettings() as Record<string, any>;
	return {
		...global?.["pi-personal-crm"],
		...project?.["pi-personal-crm"],
	};
}

function getCrmDbPath(cwd: string, settings: CrmSettings): string {
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

	// Initialize DB on session start
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
					setCrmStore(store);
					log("ready", { backend: "kysely" });
					mountOnWebServer(pi.events);
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
			const dbPath = getCrmDbPath(ctx.cwd, settings);
			const store = await createSqliteStore(dbPath);
			setCrmStore(store);
			log("init", { backend: "sqlite", dbPath });
			mountOnWebServer(pi.events);
		}
	});

	// Register the CRM tool
	registerCrmTool(pi);

	// ── pi-webserver integration ────────────────────────────────
	// Re-mount when pi-webserver starts after us (only if store is ready).

	pi.events.on("web:ready", () => {
		if (isStoreReady()) {
			mountOnWebServer(pi.events);
		}
	});

	// ── /crm-web command — standalone server ────────────────────

	pi.registerCommand("crm-web", {
		description: "Start standalone CRM web UI (or stop if running)",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "stop", label: "stop — Stop the standalone server" },
				{ value: "status", label: "status — Show CRM web status" },
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const arg = args?.trim() ?? "";

			// /crm-web status
			if (arg === "status") {
				const lines: string[] = [];
				if (isMountedOnWebServer()) {
					lines.push("Mounted on pi-webserver at /crm");
				}
				if (lines.length === 0) {
					lines.push("CRM web UI is not running");
					lines.push("Use /crm-web [port] to start standalone, or install pi-webserver");
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			// /crm-web stop
			if (arg === "stop") {
				const was = stopStandaloneServer();
				ctx.ui.notify(
					was ? "CRM standalone server stopped" : "Standalone server is not running",
					"info",
				);
				return;
			}

			// /crm-web [port] — toggle or start on specific port
			const port = parseInt(arg || "4100") || 4100;
			const running = stopStandaloneServer();
			if (running && !arg) {
				ctx.ui.notify("CRM standalone server stopped", "info");
				return;
			}
			const url = startStandaloneServer(port);
			let msg = `CRM web UI: ${url}`;
			if (isMountedOnWebServer()) {
				msg += "\n(Also available via pi-webserver at /crm)";
			}
			ctx.ui.notify(msg, "info");
		},
	});

	// ── /crm-export command ─────────────────────────────────────

	pi.registerCommand("crm-export", {
		description: "Export CRM contacts as CSV to stdout",
		handler: async (_args, ctx) => {
			const { getCrmStore } = await import("./store.ts");
			const csv = await getCrmStore().exportContactsCsv();
			const lines = csv.split("\n");
			ctx.ui.notify(`Exported ${lines.length - 1} contacts`, "info");

			// Write to file
			const outPath = path.join(process.cwd(), "crm-contacts.csv");
			fs.writeFileSync(outPath, csv, "utf-8");
			ctx.ui.notify(`Saved to ${outPath}`, "info");
		},
	});

	// ── /crm-import command ─────────────────────────────────────

	pi.registerCommand("crm-import", {
		description: "Import contacts from a CSV file: /crm-import path/to/file.csv",
		handler: async (args, ctx) => {
			if (!args) {
				ctx.ui.notify("Usage: /crm-import path/to/file.csv", "error");
				return;
			}

			const filePath = path.resolve(args.trim());
			if (!fs.existsSync(filePath)) {
				ctx.ui.notify(`File not found: ${filePath}`, "error");
				return;
			}

			const { getCrmStore } = await import("./store.ts");
			const csv = fs.readFileSync(filePath, "utf-8");
			const result = await getCrmStore().importContactsCsv(csv);

			let msg = `Created: ${result.created}, Skipped: ${result.skipped}`;
			if (result.duplicates.length > 0) {
				msg += `, Duplicates: ${result.duplicates.length}`;
			}
			if (result.errors.length > 0) {
				msg += `, Errors: ${result.errors.length}`;
			}
			ctx.ui.notify(msg, result.errors.length > 0 ? "warning" : "info");
		},
	});

	// ── Cleanup ─────────────────────────────────────────────────

	pi.on("session_shutdown", async () => {
		stopStandaloneServer();
		// No need to explicitly unmount from pi-webserver — it shuts down too
	});
}
