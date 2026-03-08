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
 *   - Processes messages via the MAIN agent process — full TUI visibility
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

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import {
	DefaultRequestHandler,
	InMemoryTaskStore,
	InMemoryPushNotificationStore,
	DefaultPushNotificationSender,
	JsonRpcTransportHandler,
} from "@a2a-js/sdk/server";
import { loadConfig } from "./config.ts";
import { buildAgentCard, enrichAgentCard } from "./agent-card.ts";
import { PiAgentExecutor, type ProcessResult } from "./agent-executor.ts";
import { startServer, stopServer, isRunning, updateAgentCard, getAgentCard } from "./server.ts";
import { registerWithHub, setCredentialOnHub, discoverAgentsOnHub, getAgentFromHub, getCredentialFromHub } from "./hub.ts";
import { sendA2AMessage } from "./client.ts";
import { createLogger } from "./logger.ts";
import type { RemoteAgentSummary } from "./types.ts";

const DEFAULT_PORT = 3100;

function txt(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

/** Format duration in human-readable form. */
function fmtDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Extract text content from the last assistant message. */
function extractAssistantText(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m && "role" in m && m.role === "assistant" && Array.isArray(m.content)) {
			const textParts = m.content
				.filter((c: { type: string }) => c.type === "text")
				.map((c: { type: string; text?: string }) => c.text ?? "");
			if (textParts.length > 0) return textParts.join("\n");
		}
	}
	return "";
}

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let cwd = process.cwd();
	let cardEnriched = false;
	let firstTurnEnriched = false;
	let executor: PiAgentExecutor | null = null;
	/** Captured from session_start for use in async callbacks. */
	let sessionCtx: ExtensionContext | null = null;

	// ── Main-process message handling ─────────────────────────
	//
	// When an A2A message arrives, we inject it into the main conversation
	// via pi.sendMessage({ triggerTurn: true }). The agent processes it
	// with full tool/skill access — everything visible in the TUI.
	// On agent_end, we capture the response and send it back to the caller.

	/** Resolve function for the pending A2A request. */
	let pendingResolve: ((result: ProcessResult) => void) | null = null;
	let pendingStartTime = 0;

	/** Wait for agent to be idle before injecting an A2A message. */
	let agentBusy = false;
	let idleResolvers: (() => void)[] = [];

	function waitForIdle(): Promise<void> {
		if (!agentBusy) return Promise.resolve();
		return new Promise((resolve) => {
			idleResolvers.push(resolve);
		});
	}

	/**
	 * Process an incoming A2A message via the main agent.
	 * Called by the executor — blocks until the agent responds.
	 */
	async function processMessage(prompt: string, sender: string): Promise<ProcessResult> {
		const start = Date.now();

		// Wait for agent to finish any current turn
		await waitForIdle();

		return new Promise<ProcessResult>((resolve) => {
			pendingResolve = resolve;
			pendingStartTime = start;

			// Inject into the main conversation — triggers a full agent turn
			pi.sendMessage(
				{
					customType: "a2a-request",
					content:
						`📨 **A2A request from ${sender}**\n\n` +
						`> ${prompt.split("\n").join("\n> ")}\n\n` +
						`*Process this request. Your full response will be sent back to ${sender} via A2A.*`,
					display: true,
				},
				{ triggerTurn: true },
			);

			updateStatusLine();
		});
	}

	// Capture agent lifecycle for response extraction
	pi.on("agent_start", () => {
		agentBusy = true;
	});

	pi.on("agent_end", (event) => {
		agentBusy = false;

		// Notify any waiters that the agent is idle
		const resolvers = idleResolvers;
		idleResolvers = [];
		for (const r of resolvers) r();

		// If we're waiting for an A2A response, capture it
		if (pendingResolve) {
			const response = extractAssistantText(event.messages);
			const durationMs = Date.now() - pendingStartTime;
			const resolve = pendingResolve;
			pendingResolve = null;

			if (response) {
				// Show completion in chat
				pi.sendMessage(
					{
						customType: "a2a-response-sent",
						content: `📤 **A2A response sent** (${fmtDuration(durationMs)})`,
						display: true,
					},
					{ triggerTurn: false },
				);
				resolve({ ok: true, response, durationMs });
			} else {
				resolve({ ok: false, response: "", error: "Agent produced no text response", durationMs });
			}

			updateStatusLine();
		}
	});

	// ── TUI: status line ──────────────────────────────────────

	function updateStatusLine(): void {
		if (!sessionCtx || !executor) return;
		const theme = sessionCtx.ui.theme;
		if (executor.isBusy()) {
			const queued = executor.queueDepth();
			const queueLabel = queued > 0 ? ` +${queued} queued` : "";
			const dot = theme.fg("warning", "●");
			const label = theme.fg("dim", ` A2A processing${queueLabel}`);
			sessionCtx.ui.setStatus("a2a", dot + label);
		} else if (isRunning()) {
			const dot = theme.fg("success", "●");
			const label = theme.fg("dim", " A2A");
			sessionCtx.ui.setStatus("a2a", dot + label);
		} else {
			sessionCtx.ui.setStatus("a2a", undefined);
		}
	}

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
		sessionCtx = ctx;
		cardEnriched = false;
		firstTurnEnriched = false;

		// Clean restart — reset all async state from previous session
		agentBusy = false;
		const staleResolvers = idleResolvers;
		idleResolvers = [];
		for (const r of staleResolvers) r();
		if (pendingResolve) {
			pendingResolve({ ok: false, response: "", error: "Session restart", durationMs: Date.now() - pendingStartTime });
		}
		pendingResolve = null;
		if (executor) {
			executor.abortAll();
			executor = null;
		}
		if (isRunning()) {
			await stopServer(log);
		}

		const { config, warnings } = loadConfig(cwd);
		for (const w of warnings) log("config_warning", { message: w }, "WARN");
		const port = config.port ?? DEFAULT_PORT;
		const publicUrl = config.publicUrl ?? `http://localhost:${port}`;
		const agentCard = buildAgentCard(config, publicUrl);

		// Set up executor with main-process callback
		executor = new PiAgentExecutor(log, processMessage);
		const taskStore = new InMemoryTaskStore();
		const pushNotificationStore = new InMemoryPushNotificationStore();
		const pushNotificationSender = new DefaultPushNotificationSender(pushNotificationStore);

		const requestHandler = new DefaultRequestHandler(
			agentCard,
			taskStore,
			executor,
			undefined,
			pushNotificationStore,
			pushNotificationSender,
			undefined,
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

		// Show idle status in footer
		updateStatusLine();

		// Optional: register with A2A Hub
		if (config.hub && config.hub.apiKey && (config.hub.autoRegister !== false)) {
			const result = await registerWithHub(publicUrl, config.hub, log, config.apiKey);
			if (result) {
				ctx.ui.notify(`pi-a2a: Registered with hub (${result.status})`, "info");
			}
		}
	});

	// Re-enrich on first agent turn to catch late-registering extension tools
	pi.on("agent_start", () => {
		if (!firstTurnEnriched) {
			firstTurnEnriched = true;
			cardEnriched = false;
			enrichCard();
		}
	});

	pi.on("session_shutdown", async () => {
		cardEnriched = false;
		sessionCtx?.ui.setStatus("a2a", undefined);
		sessionCtx = null;
		// Reject pending A2A request if any
		if (pendingResolve) {
			pendingResolve({ ok: false, response: "", error: "Session shutdown", durationMs: Date.now() - pendingStartTime });
			pendingResolve = null;
		}
		if (executor) {
			executor.abortAll();
			executor = null;
		}
		if (isRunning()) {
			await stopServer(log);
		}
	});

	// ── Tools ─────────────────────────────────────────────────

	/** In-memory cache of discovered agents from the hub. */
	let discoveredAgents: RemoteAgentSummary[] = [];

	pi.registerTool({
		name: "a2a_discover",
		label: "A2A Discover",
		description:
			"Discover remote agents registered on the A2A Hub. " +
			"Returns a list of available agents with their names, descriptions, skills, and health status. " +
			"Use this before a2a_send to find agents you can communicate with.",
		parameters: Type.Object({
			q: Type.Optional(Type.String({ description: "Search query (optional — omit to list all agents)" })),
			category: Type.Optional(Type.Array(Type.String(), { description: "Filter by category slugs" })),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by tags" })),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			if (!config.hub?.apiKey) {
				return txt("Error: No hub configured. Set pi-a2a.hub in settings.json.");
			}

			const result = await discoverAgentsOnHub(config.hub, log, {
				q: params.q,
				category: params.category,
				tags: params.tags,
				limit: 50,
			});

			if (!result) {
				return txt("Error: Failed to query the hub. Check logs.");
			}

			discoveredAgents = result.agents;

			if (result.agents.length === 0) {
				return txt("No agents found on the hub.");
			}

			const lines = result.agents.map((a) =>
				`• **${a.name}** (id: ${a.id})\n  ${a.description}\n  URL: ${a.url} | Health: ${a.healthStatus} | Tags: ${a.tags.join(", ") || "none"}`
			);

			return txt(`Found ${result.total} agent(s) on the hub:\n\n${lines.join("\n\n")}`);
		},
	});

	pi.registerTool({
		name: "a2a_send",
		label: "A2A Send",
		description:
			"Send a message to a remote A2A agent. " +
			"Specify the agent by name (from a2a_discover results) or by agentId/URL. " +
			"The hub provides the agent's URL and credential automatically.",
		parameters: Type.Object({
			agent: Type.String({
				description: "Agent name, agent ID (UUID), or direct URL. Names are matched against discovered agents.",
			}),
			message: Type.String({ description: "Message to send to the remote agent" }),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			if (!config.hub?.apiKey) {
				return txt("Error: No hub configured. Set pi-a2a.hub in settings.json.");
			}

			// Resolve agent URL
			let agentUrl: string | null = null;
			let agentId: string | null = null;
			let agentName: string = params.agent;

			// Direct URL?
			if (params.agent.startsWith("http://") || params.agent.startsWith("https://")) {
				agentUrl = params.agent;
			} else {
				// Try to match from discovered agents cache
				const match = discoveredAgents.find((a) =>
					a.id === params.agent || a.name.toLowerCase() === params.agent.toLowerCase()
				);

				if (match) {
					agentUrl = match.url;
					agentId = match.id;
					agentName = match.name;
				} else {
					// Not cached — try as agentId via hub lookup
					const detail = await getAgentFromHub(params.agent, config.hub, log);
					if (detail) {
						agentUrl = (detail.agentCard as { url?: string }).url ?? null;
						agentId = detail.id;
						agentName = (detail.agentCard as { name?: string }).name ?? params.agent;
					}
				}
			}

			if (!agentUrl) {
				return txt(`Error: Could not resolve agent "${params.agent}". Run a2a_discover first, or provide a direct URL.`);
			}

			// Get credential from hub if we have an agentId
			let credential: string | null = null;
			if (agentId) {
				const cred = await getCredentialFromHub(agentId, config.hub, log);
				if (cred?.credential) {
					credential = cred.credential;
				}
			}

			// Send the message with sender identity
			const sendStart = Date.now();
			const result = await sendA2AMessage({
				url: agentUrl,
				message: params.message,
				credential,
				sender: { name: config.name ?? "Pi Agent", description: config.description },
			}, log);

			if (!result.ok) {
				return txt(`Error sending to ${agentName}: ${result.error}`);
			}

			const dur = fmtDuration(Date.now() - sendStart);
			return txt(`**Response from ${agentName}** (${dur}):\n\n${result.response}`);
		},
	});

	// ── Commands ──────────────────────────────────────────────

	pi.registerCommand("a2a", {
		description: "Manage the A2A protocol server. Usage: /a2a status | /a2a card | /a2a refresh | /a2a register | /a2a credential | /a2a discover [query]",
		handler: async (args, ctx) => {
			const action = args.trim();
			const { config } = loadConfig(cwd);
			const port = config.port ?? DEFAULT_PORT;
			const publicUrl = config.publicUrl ?? `http://localhost:${port}`;

			if (action === "status") {
				if (isRunning()) {
					const card = getAgentCard();
					const skillCount = card?.skills.length ?? 0;
					const queued = executor?.queueDepth() ?? 0;
					const busy = executor?.isBusy()
						? ` | Processing: 1 task${queued > 0 ? ` + ${queued} queued` : ""}`
						: "";
					ctx.ui.notify(
						`A2A server running on port ${port}\n` +
						`Agent Card: ${publicUrl}/.well-known/agent-card.json\n` +
						`Protocol: A2A v0.3.0 | Mode: inline (main process)${busy}\n` +
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

				const result = await registerWithHub(publicUrl, config.hub, log, config.apiKey);
				if (result) {
					ctx.ui.notify(`Registered with hub: agentId=${result.agentId}, status=${result.status}`, "info");
				} else {
					ctx.ui.notify("Hub registration failed — check logs", "warning");
				}
				return;
			}

			if (action === "credential") {
				if (!config.hub?.apiKey) {
					ctx.ui.notify("No hub config — set pi-a2a.hub.url and pi-a2a.hub.apiKey", "warning");
					return;
				}
				if (!config.apiKey) {
					ctx.ui.notify("No pi-a2a.apiKey configured — nothing to push to hub", "warning");
					return;
				}

				const reg = await registerWithHub(publicUrl, config.hub, log, config.apiKey);
				if (!reg) {
					ctx.ui.notify("Could not determine agentId — registration failed", "warning");
					return;
				}

				const result = await setCredentialOnHub(reg.agentId, config.apiKey, config.hub, log);
				if (result) {
					ctx.ui.notify(
						`Credential updated on hub: hasCredential=${result.hasCredential}, ` +
						`updatedAt=${result.credentialUpdatedAt ?? "n/a"}`,
						"info",
					);
				} else {
					ctx.ui.notify("Failed to update credential on hub — check logs", "warning");
				}
				return;
			}

			if (action === "discover" || action.startsWith("discover ")) {
				if (!config.hub?.apiKey) {
					ctx.ui.notify("No hub config — set pi-a2a.hub.url and pi-a2a.hub.apiKey", "warning");
					return;
				}

				const query = action === "discover" ? undefined : action.slice("discover ".length).trim() || undefined;
				const result = await discoverAgentsOnHub(config.hub, log, { q: query, limit: 50 });

				if (!result) {
					ctx.ui.notify("Failed to query the hub — check logs", "warning");
					return;
				}

				discoveredAgents = result.agents;

				if (result.agents.length === 0) {
					ctx.ui.notify("No agents found on the hub.", "info");
					return;
				}

				const lines = result.agents.map((a) =>
					`  ${a.name} (${a.id.slice(0, 8)}…) — ${a.description.slice(0, 60)}${a.description.length > 60 ? "…" : ""} [${a.healthStatus}]`
				);
				ctx.ui.notify(`Found ${result.total} agent(s):\n${lines.join("\n")}`, "info");
				return;
			}

			ctx.ui.notify("Usage: /a2a status | /a2a card | /a2a refresh | /a2a register | /a2a credential | /a2a discover [query]", "info");
		},
	});
}
