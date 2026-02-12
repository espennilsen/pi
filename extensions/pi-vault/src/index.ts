/**
 * pi-vault — Obsidian vault tool and health dashboard for pi.
 *
 * Provides:
 *   - `obsidian` tool — 16-action vault read/write/search/manage tool
 *   - /vault web page — Health dashboard (daily streak, projects, tasks, tags)
 *   - /api/vault/health — JSON health data endpoint
 *
 * Config in settings.json under "pi-vault":
 * {
 *   "pi-vault": {
 *     "vaultPath": "~/Library/CloudStorage/.../Obsidian/e9n",
 *     "vaultName": "e9n",
 *     "apiUrl": "http://127.0.0.1:27123",
 *     "apiKey": "your-obsidian-api-key"
 *   }
 * }
 *
 * Requires pi-webserver for the web dashboard. Tool works standalone.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveConfig } from "./api-client.ts";
import { registerObsidianTool } from "./tool.ts";
import { mountVaultRoutes, unmountVaultRoutes } from "./web.ts";
import { createLogger } from "./logger.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let mounted = false;
	let lastCwd = "";

	pi.on("session_start", async (_event, ctx) => {
		lastCwd = ctx.cwd;
		const config = resolveConfig(ctx.cwd);
		log("init", { vaultPath: config.vaultPath, vaultName: config.vaultName });

		// Register the tool (degrades gracefully if vault not found)
		registerObsidianTool(pi, config);

		// Mount web routes
		mountVaultRoutes(pi, config);
		mounted = true;
	});

	pi.events.on("web:ready", () => {
		// Re-mount if web server started after session
		if (!mounted) return;
		// Config already loaded at session_start, re-resolve in case cwd changed
		const config = resolveConfig(lastCwd || ".");
		mountVaultRoutes(pi, config);
	});

	pi.on("session_shutdown", async () => {
		unmountVaultRoutes(pi);
		mounted = false;
	});
}
