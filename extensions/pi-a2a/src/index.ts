/**
 * pi-a2a — Agent-to-Agent (A2A) protocol extension for pi.
 *
 * Self-contained A2A server — runs its own HTTP server, no dependency
 * on pi-webserver or any other extensions.
 *
 * Features:
 *   - Serves A2A Agent Card at /.well-known/agent.json
 *   - Handles A2A JSON-RPC 2.0 requests (message/send, tasks/get, tasks/cancel)
 *   - Processes messages via isolated `pi --mode rpc` subprocesses
 *   - Optional registration with an A2A Discovery Hub
 *
 * Configuration in settings.json under "pi-a2a":
 * {
 *   "pi-a2a": {
 *     "port": 3100,
 *     "name": "Pi Agent",
 *     "description": "Personal AI coding agent",
 *     "hub": {
 *       "url": "http://localhost:3001/api",
 *       "apiKey": "your-api-key",
 *       "categories": ["development-tools"],
 *       "tags": ["coding", "agent"]
 *     }
 *   }
 * }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { buildAgentCard } from "./agent-card.ts";
import { startServer, stopServer, isRunning } from "./server.ts";
import { registerWithHub } from "./hub.ts";
import { createLogger } from "./logger.ts";

const DEFAULT_PORT = 3100;

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let cwd = process.cwd();

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		const config = loadConfig(cwd);
		const port = config.port ?? DEFAULT_PORT;
		const publicUrl = config.publicUrl ?? `http://localhost:${port}`;
		const agentCard = buildAgentCard(config, publicUrl);

		// Start the A2A server
		try {
			await startServer({ port, agentCard, cwd, log });
			ctx.ui.notify(`pi-a2a: A2A server listening on port ${port}`, "info");
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`pi-a2a: Failed to start server — ${msg}`, "warning");
			return;
		}

		// Optional: register with A2A Hub
		if (config.hub && config.hub.apiKey && (config.hub.autoRegister !== false)) {
			const result = await registerWithHub(agentCard, config.hub, log);
			if (result) {
				ctx.ui.notify(`pi-a2a: Registered with hub (${result.status})`, "info");
			}
		}
	});

	pi.on("session_shutdown", async () => {
		if (isRunning()) {
			await stopServer(log);
		}
	});

	// ── Commands ──────────────────────────────────────────────

	pi.registerCommand("a2a", {
		description: "Manage the A2A protocol server. Usage: /a2a status | /a2a register",
		handler: async (args, ctx) => {
			const action = args.trim();
			const config = loadConfig(cwd);
			const port = config.port ?? DEFAULT_PORT;
			const publicUrl = config.publicUrl ?? `http://localhost:${port}`;

			if (action === "status") {
				if (isRunning()) {
					ctx.ui.notify(`A2A server running on port ${port}\nAgent Card: ${publicUrl}/.well-known/agent.json`, "info");
				} else {
					ctx.ui.notify("A2A server is not running", "info");
				}
				return;
			}

			if (action === "register") {
				if (!config.hub?.apiKey) {
					ctx.ui.notify("No hub config in settings.json — set pi-a2a.hub.url and pi-a2a.hub.apiKey", "warning");
					return;
				}

				const agentCard = buildAgentCard(config, publicUrl);
				const result = await registerWithHub(agentCard, config.hub, log);
				if (result) {
					ctx.ui.notify(`Registered with hub: agentId=${result.agentId}, status=${result.status}`, "info");
				} else {
					ctx.ui.notify("Hub registration failed — check logs", "warning");
				}
				return;
			}

			ctx.ui.notify("Usage: /a2a status | /a2a register", "info");
		},
	});
}
