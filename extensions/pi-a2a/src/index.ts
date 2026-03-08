/**
 * pi-a2a — Agent-to-Agent (A2A) protocol extension for pi.
 *
 * Self-contained A2A server using @a2a-js/sdk for protocol handling.
 * Runs its own HTTP server, no dependency on pi-webserver or other extensions.
 *
 * Features:
 *   - Full A2A v0.3.0 protocol compliance via @a2a-js/sdk
 *   - Serves A2A Agent Card at /.well-known/agent-card.json
 *   - Handles A2A JSON-RPC 2.0 requests via SDK's DefaultRequestHandler
 *   - Proper task lifecycle: submitted → working → completed/failed
 *   - SSE streaming support for real-time task updates
 *   - Push notification support for async task updates
 *   - Processes messages via isolated `pi --mode rpc` subprocesses
 *   - Dynamically enriches the Agent Card with registered extension tools
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
import {
	DefaultRequestHandler,
	InMemoryTaskStore,
	InMemoryPushNotificationStore,
	DefaultPushNotificationSender,
	JsonRpcTransportHandler,
} from "@a2a-js/sdk/server";
import { loadConfig } from "./config.ts";
import { buildAgentCard, enrichAgentCard } from "./agent-card.ts";
import { PiAgentExecutor } from "./agent-executor.ts";
import { startServer, stopServer, isRunning, updateAgentCard, getAgentCard } from "./server.ts";
import { registerWithHub } from "./hub.ts";
import { createLogger } from "./logger.ts";

const DEFAULT_PORT = 3100;

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let cwd = process.cwd();
	let cardEnriched = false;
	let executor: PiAgentExecutor | null = null;

	/**
	 * Enrich the agent card with dynamically discovered tools.
	 */
	function enrichCard(): void {
		if (cardEnriched) return;
		const currentCard = getAgentCard();
		if (!currentCard) return;

		const tools = pi.getAllTools();
		const enriched = enrichAgentCard(currentCard, tools);
		updateAgentCard(enriched);
		cardEnriched = true;

		const newSkillCount = enriched.skills.length - currentCard.skills.length;
		if (newSkillCount > 0) {
			log("agent_card_enriched", { newSkills: newSkillCount, totalSkills: enriched.skills.length });
		}
	}

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		cardEnriched = false;
		const config = loadConfig(cwd);
		const port = config.port ?? DEFAULT_PORT;
		const publicUrl = config.publicUrl ?? `http://localhost:${port}`;
		const agentCard = buildAgentCard(config, publicUrl);

		// Set up SDK components with full capability support
		executor = new PiAgentExecutor(cwd, log);
		const taskStore = new InMemoryTaskStore();
		const pushNotificationStore = new InMemoryPushNotificationStore();
		const pushNotificationSender = new DefaultPushNotificationSender(pushNotificationStore);

		const requestHandler = new DefaultRequestHandler(
			agentCard,
			taskStore,
			executor,
			undefined,                // eventBusManager — use SDK default
			pushNotificationStore,
			pushNotificationSender,
			undefined,                // extendedAgentCard — not configured yet
		);
		const rpcHandler = new JsonRpcTransportHandler(requestHandler);

		// Start the A2A server
		const bind = config.bind;
		const isLocalhost = !bind || bind === "127.0.0.1" || bind === "::1";
		if (!isLocalhost && !config.apiKey) {
			ctx.ui.notify("pi-a2a: WARNING — binding to external interface without apiKey. Set pi-a2a.apiKey in settings.json.", "warning");
		}
		try {
			await startServer({ port, bind, apiKey: config.apiKey, agentCard, rpcHandler, log });
			ctx.ui.notify(`pi-a2a: A2A server listening on ${bind ?? "127.0.0.1"}:${port}`, "info");
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`pi-a2a: Failed to start server — ${msg}`, "warning");
			return;
		}

		// Deferred enrichment
		queueMicrotask(() => enrichCard());

		// Optional: register with A2A Hub
		if (config.hub && config.hub.apiKey && (config.hub.autoRegister !== false)) {
			const result = await registerWithHub(agentCard, config.hub, log);
			if (result) {
				ctx.ui.notify(`pi-a2a: Registered with hub (${result.status})`, "info");
			}
		}
	});

	// Enrich on first agent turn (catches stragglers)
	pi.on("agent_start", () => {
		enrichCard();
	});

	pi.on("session_shutdown", async () => {
		cardEnriched = false;
		executor = null;
		if (isRunning()) {
			await stopServer(log);
		}
	});

	// ── Commands ──────────────────────────────────────────────

	pi.registerCommand("a2a", {
		description: "Manage the A2A protocol server. Usage: /a2a status | /a2a card | /a2a refresh | /a2a register",
		handler: async (args, ctx) => {
			const action = args.trim();
			const config = loadConfig(cwd);
			const port = config.port ?? DEFAULT_PORT;
			const publicUrl = config.publicUrl ?? `http://localhost:${port}`;

			if (action === "status") {
				if (isRunning()) {
					const card = getAgentCard();
					const skillCount = card?.skills.length ?? 0;
					ctx.ui.notify(
						`A2A server running on port ${port}\n` +
						`Agent Card: ${publicUrl}/.well-known/agent-card.json\n` +
						`Protocol: A2A v0.3.0 | Transport: JSON-RPC\n` +
						`Skills: ${skillCount} | Streaming: ✓ | Push Notifications: ✓`,
						"info",
					);
				} else {
					ctx.ui.notify("A2A server is not running", "info");
				}
				return;
			}

			if (action === "card") {
				const card = getAgentCard();
				if (card) {
					ctx.ui.notify(JSON.stringify(card, null, 2), "info");
				} else {
					ctx.ui.notify("No agent card — server is not running", "warning");
				}
				return;
			}

			if (action === "refresh") {
				cardEnriched = false;
				enrichCard();
				const card = getAgentCard();
				ctx.ui.notify(`Agent card refreshed — ${card?.skills.length ?? 0} skills`, "info");
				return;
			}

			if (action === "register") {
				if (!config.hub?.apiKey) {
					ctx.ui.notify("No hub config in settings.json — set pi-a2a.hub.url and pi-a2a.hub.apiKey", "warning");
					return;
				}

				const agentCard = getAgentCard() ?? buildAgentCard(config, publicUrl);
				const result = await registerWithHub(agentCard, config.hub, log);
				if (result) {
					ctx.ui.notify(`Registered with hub: agentId=${result.agentId}, status=${result.status}`, "info");
				} else {
					ctx.ui.notify("Hub registration failed — check logs", "warning");
				}
				return;
			}

			ctx.ui.notify("Usage: /a2a status | /a2a card | /a2a refresh | /a2a register", "info");
		},
	});
}
