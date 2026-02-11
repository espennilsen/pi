/**
 * pi-personal-crm — Personal CRM extension for pi.
 *
 * Registers the CRM tool, /crm-web command, and injects system prompt context.
 * Data is stored in ~/.pi/agent/crm/crm.db.
 *
 * If the pi-webserver extension is installed, the CRM auto-mounts at /crm
 * on the shared web server. Otherwise, use /crm-web for a standalone server.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { initDb, crmApi } from "./db.ts";
import { registerCrmTool } from "./tool.ts";
import {
	startStandaloneServer,
	stopStandaloneServer,
	mountOnWebServer,
	isMountedOnWebServer,
} from "./web.ts";

function getCrmDbPath(): string {
	const dir = path.join(os.homedir(), ".pi", "agent", "crm");
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, "crm.db");
}

export default function (pi: ExtensionAPI) {
	// Initialize DB on session start
	pi.on("session_start", async (_event, _ctx) => {
		const dbPath = getCrmDbPath();
		initDb(dbPath);
	});

	// Register the CRM tool
	registerCrmTool(pi, () => crmApi);

	// ── pi-webserver integration ────────────────────────────────
	// Auto-mount on the shared web server if pi-webserver is installed.
	// Uses the event bus so there's no hard dependency on pi-webserver.

	pi.events.on("web:ready", () => {
		mountOnWebServer(pi.events);
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
			const csv = crmApi.exportContactsCsv();
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

			const csv = fs.readFileSync(filePath, "utf-8");
			const result = crmApi.importContactsCsv(csv);

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
