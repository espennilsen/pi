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

import { randomUUID } from "node:crypto";
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
import { PiAgentExecutor, type ProcessResult, type AsyncTaskResult } from "./agent-executor.ts";
import { startServer, stopServer, isRunning, updateAgentCard, getAgentCard } from "./server.ts";
import { registerWithHub, setCredentialOnHub, discoverAgentsOnHub, getAgentFromHub, getCredentialFromHub, reportTelemetryToHub, requestClarification, pollClarification, cancelClarification } from "./hub.ts";
import { sendA2AMessage, type SenderIdentity } from "./client.ts";
import { StaticAgentRegistry, extractSkills } from "./static-agents.ts";
import { createLogger } from "./logger.ts";
import type { HubConfig, RemoteAgentSummary, TelemetrySnapshot } from "./types.ts";

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

	// ── Powerbar segment ──────────────────────────────────────

	pi.events.emit("powerbar:register-segment", {
		id: "a2a",
		label: "A2A",
	});
	let telemetryInterval: ReturnType<typeof setInterval> | null = null;
	let hubAgentId: string | null = null;
	let staticRegistry: StaticAgentRegistry | null = null;
	/** This agent's own public A2A URL — included in pi:sender for reply routing. */
	let selfUrl: string | null = null;

	// ── Main-process message handling ─────────────────────────
	//
	// When an A2A message arrives, we inject it into the main conversation
	// via pi.sendMessage({ triggerTurn: true }). The agent processes it
	// with full tool/skill access — everything visible in the TUI.
	// On agent_end, we capture the response and send it back to the caller.

	/** Resolve function for the pending A2A request. */
	let pendingResolve: ((result: ProcessResult) => void) | null = null;
	let pendingStartTime = 0;
	/** Nonce embedded in the injected message to correlate with agent_end. */
	let pendingNonce: string | null = null;

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

		// Guard against concurrent invocations — singleton pendingResolve
		// would silently clobber the first task's resolver, causing it to hang.
		if (pendingResolve) {
			return { ok: false, response: "", error: "A2A request already in progress — concurrent invocation rejected", durationMs: 0 };
		}

		// Wait for agent to finish any current turn
		await waitForIdle();

		return new Promise<ProcessResult>((resolve) => {
			const nonce = randomUUID();
			pendingResolve = resolve;
			pendingStartTime = start;
			pendingNonce = nonce;

			// Inject into the main conversation — triggers a full agent turn.
			// The nonce in details lets agent_end correlate this turn's response.
			pi.sendMessage(
				{
					customType: "a2a-request",
					content:
						`📨 **A2A request from ${sender}**\n\n` +
						`> ${prompt.split("\n").join("\n> ")}\n\n` +
						`*Process this request. Your full response will be sent back to ${sender} via A2A.*`,
					display: true,
					details: { nonce },
				},
				{ triggerTurn: true },
			);

			updateStatusLine();
		});
	}

	// Capture agent lifecycle for response extraction + telemetry
	pi.on("agent_start", () => {
		agentBusy = true;
		lastTurnStartMs = Date.now();

		// Report "busy" to hub immediately
		if (hubAgentId) {
			const { config } = loadConfig(cwd);
			sendTelemetry(config).catch(() => {});
		}
	});

	pi.on("agent_end", (event) => {
		agentBusy = false;

		// Record turn duration for telemetry
		if (lastTurnStartMs > 0) {
			lastTurnDurationMs = Date.now() - lastTurnStartMs;
			lastTurnStatus = "completed";
			lastTurnStartMs = 0;
		}

		// Notify any waiters that the agent is idle
		const resolvers = idleResolvers;
		idleResolvers = [];
		for (const r of resolvers) r();

		// If we're waiting for an A2A response, capture it — but only if
		// this agent_end corresponds to our injected A2A turn (matched by nonce).
		// This prevents user-initiated turns from consuming the pending resolve.
		if (pendingResolve && pendingNonce) {
			const hasMatchingRequest = event.messages.some((m) =>
				"customType" in m &&
				m.customType === "a2a-request" &&
				(m as { details?: { nonce?: string } }).details?.nonce === pendingNonce
			);

			if (hasMatchingRequest) {
				const response = extractAssistantText(event.messages);
				const durationMs = Date.now() - pendingStartTime;
				const resolve = pendingResolve;
				pendingResolve = null;
				pendingNonce = null;

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
					lastTurnStatus = "failed";
					resolve({ ok: false, response: "", error: "Agent produced no text response", durationMs });
				}

				updateStatusLine();
			}
		}

		// Report "idle" to hub immediately
		if (hubAgentId) {
			const { config } = loadConfig(cwd);
			sendTelemetry(config).catch(() => {});
		}
	});

	// ── Outbound A2A request tracking ─────────────────────────
	/** Number of outbound a2a_send requests currently in flight. */
	let outboundPending = 0;
	/** Monotonic token incremented on each session_start. Stale closures bail out when mismatched. */
	let sessionToken = 0;

	// ── TUI: status line ──────────────────────────────────────

	function updateStatusLine(): void {
		if (!sessionCtx || !executor) return;
		const theme = sessionCtx.ui.theme;
		if (executor.isBusy()) {
			const queued = executor.queueDepth();
			const queueLabel = queued > 0 ? ` +${queued} queued` : "";
			const outLabel = outboundPending > 0 ? ` | ${outboundPending} outbound` : "";
			const dot = theme.fg("warning", "●");
			const label = theme.fg("dim", ` A2A processing${queueLabel}${outLabel}`);
			sessionCtx.ui.setStatus("a2a", dot + label);
		} else if (outboundPending > 0) {
			const dot = theme.fg("accent", "●");
			const label = theme.fg("dim", ` A2A ${outboundPending} outbound pending`);
			sessionCtx.ui.setStatus("a2a", dot + label);
		} else if (isRunning()) {
			const dot = theme.fg("success", "●");
			const label = theme.fg("dim", " A2A");
			sessionCtx.ui.setStatus("a2a", dot + label);
		} else {
			sessionCtx.ui.setStatus("a2a", undefined);
		}

		updatePowerbar();
	}

	function updatePowerbar(): void {
		if (!isRunning()) {
			pi.events.emit("powerbar:update", { id: "a2a", text: undefined });
			return;
		}

		const inbound = executor?.isBusy() ? 1 + (executor.queueDepth()) : 0;
		const outbound = outboundPending;

		const parts: string[] = ["A2A"];
		if (inbound > 0) parts.push(`▸${inbound}`);
		if (outbound > 0) parts.push(`◂${outbound}`);

		let color: string;
		if (inbound > 0) {
			color = "warning";
		} else if (outbound > 0) {
			color = "accent";
		} else {
			color = "success";
		}

		pi.events.emit("powerbar:update", {
			id: "a2a",
			text: parts.join(" "),
			icon: "●",
			color,
		});
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

	// ── Telemetry ────────────────────────────────────────────
	//
	// Report agent state to the hub so it can compute availability.
	// Uses pi's own isIdle() + hasPendingMessages() for ground truth
	// (covers ALL work — user turns, A2A turns, queued messages)
	// combined with the executor's A2A queue depth.

	let lastTurnStartMs = 0;
	let lastTurnDurationMs: number | undefined;
	let lastTurnStatus: "completed" | "failed" | undefined;

	/** Build a telemetry snapshot from pi's actual state + executor A2A queue. */
	function buildTelemetrySnapshot(): TelemetrySnapshot {
		const isActive = sessionCtx ? !sessionCtx.isIdle() : false;
		const snapshot: TelemetrySnapshot = {
			queueDepth: executor?.queueDepth() ?? 0,
			activeTasks: isActive ? 1 : 0,
			maxConcurrent: 1,
		};
		if (lastTurnDurationMs !== undefined) snapshot.lastTaskDurationMs = lastTurnDurationMs;
		if (lastTurnStatus !== undefined) snapshot.lastTaskStatus = lastTurnStatus;
		return snapshot;
	}

	/** Send a telemetry snapshot to the hub. Failures are logged but never thrown. */
	async function sendTelemetry(config: ReturnType<typeof loadConfig>["config"]): Promise<void> {
		if (!hubAgentId || !config.hub?.apiKey) return;
		const snapshot = buildTelemetrySnapshot();
		await reportTelemetryToHub(hubAgentId, snapshot, config.hub, log);
	}

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		sessionCtx = ctx;
		cardEnriched = false;
		firstTurnEnriched = false;

		// Clean restart — reset all async state from previous session
		outboundPending = 0;
		sessionToken++;
		credentialCache.clear();
		agentBusy = false;
		const staleResolvers = idleResolvers;
		idleResolvers = [];
		for (const r of staleResolvers) r();
		if (pendingResolve) {
			pendingResolve({ ok: false, response: "", error: "Session restart", durationMs: Date.now() - pendingStartTime });
		}
		pendingResolve = null;
		pendingNonce = null;
		if (telemetryInterval) {
			clearInterval(telemetryInterval);
			telemetryInterval = null;
		}
		hubAgentId = null;
		staticRegistry = null;
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
		selfUrl = publicUrl;
		const agentCard = buildAgentCard(config, publicUrl);

		// Set up executor with main-process callback
		executor = new PiAgentExecutor(log, processMessage);

		// When the executor finishes an A2A task, refresh TUI status and
		// send telemetry so the hub sees "idle" immediately — agent_end
		// fires before the executor clears activeTaskId, so this callback
		// is the earliest reliable point where executor.isBusy() is false.
		executor.onTaskFinished = () => {
			updateStatusLine();
			if (hubAgentId) {
				sendTelemetry(config).catch(() => {});
			}
		};

		// When a long-running task completes, send the result back to the sender
		// as a new A2A message. The initial HTTP response already returned a
		// "working" ACK — this delivers the actual content.
		// When a long-running task completes, send the result back to the sender
		// as a new A2A message. The initial HTTP response already returned a
		// "working" ACK — this delivers the actual content (or error).
		executor.onAsyncResult = (asyncResult: AsyncTaskResult) => {
			const { taskId, senderName, senderUrl, result } = asyncResult;

			// Build the message — include error info so the caller knows what happened
			const messageText = result.ok
				? result.response
				: `❌ Task failed: ${result.error ?? "Unknown error"}`;

			// Resolve sender's URL and credential using the same priority order as a2a_send:
			// 1. senderUrl from pi:sender metadata (most reliable — set by the actual caller)
			// 2. staticRegistry (locally configured agents)
			// 3. discoveredAgents (cached from hub discovery)
			// 4. Hub lookup by name (last resort)
			(async () => {
				let replyUrl: string | null = senderUrl ?? null;
				let credential: string | null = null;
				let agentId: string | null = null;

				if (!replyUrl) {
					// Try static agents
					const senderLower = senderName.toLowerCase();
					if (staticRegistry) {
						const staticMatch = staticRegistry.findByName(senderName);
						if (staticMatch) {
							replyUrl = staticMatch.config.url;
							credential = staticMatch.config.apiKey ?? null;
						}
					}

					// Try discovered hub agents
					if (!replyUrl) {
						const hubMatch = discoveredAgents.find((a) => a.name.toLowerCase() === senderLower);
						if (hubMatch) {
							replyUrl = hubMatch.url;
							agentId = hubMatch.id;
						}
					}

					// Try hub lookup by name
					if (!replyUrl && config.hub) {
						const detail = await getAgentFromHub(senderName, config.hub, log);
						if (detail) {
							replyUrl = (detail.agentCard as { url?: string }).url ?? null;
							agentId = detail.id;
						}
					}
				}

				if (!replyUrl) {
					log("async_result_no_sender", { taskId, sender: senderName }, "WARN");
					return;
				}

				// Get credential for hub agents
				if (!credential && agentId && config.hub?.apiKey) {
					credential = await getCachedCredential(agentId, config.hub);
				}

				const sendResult = await sendA2AMessage({
					url: replyUrl,
					message: messageText,
					credential,
					timeoutMs: config.sendTimeoutMs,
					sender: { name: config.name ?? "Pi Agent", description: config.description, url: selfUrl ?? undefined } as SenderIdentity,
				}, log);

				if (sendResult.ok) {
					log("async_result_sent", { taskId, sender: senderName, ok: result.ok, responseLength: messageText.length });
				} else {
					log("async_result_send_failed", { taskId, sender: senderName, error: sendResult.error }, "ERROR");
				}
			})().catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				log("async_result_send_error", { taskId, sender: senderName, error: msg }, "ERROR");
			});
		};

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

		// Initialize static agent registry and fetch agent cards
		staticRegistry = new StaticAgentRegistry(log);
		if (config.staticAgents?.length) {
			staticRegistry.configure(config.staticAgents);
			const refreshResult = await staticRegistry.refreshAll();
			if (refreshResult.succeeded > 0 || refreshResult.failed > 0) {
				const msg = `pi-a2a: Static agents: ${refreshResult.succeeded} card(s) fetched` +
					(refreshResult.failed > 0 ? `, ${refreshResult.failed} failed` : "");
				ctx.ui.notify(msg, refreshResult.failed > 0 ? "warning" : "info");
			}
		}

		// Optional: register with A2A Hub
		if (config.hub && config.hub.apiKey && (config.hub.autoRegister !== false)) {
			const result = await registerWithHub(publicUrl, config.hub, log);
			if (result) {
				hubAgentId = result.agentId;
				ctx.ui.notify(`pi-a2a: Registered with hub (${result.status})`, "info");

				// Always push credential via setCredential — registration may
				// have been a no-op (conflict/existing) and the credential may
				// have changed since last registration.
				if (config.apiKey) {
					await setCredentialOnHub(result.agentId, config.apiKey, config.hub, log);
				}

				// Periodic heartbeat (30s) — keeps hub from resetting
				// telemetry to unknown. Real-time updates come from
				// agent_start/agent_end hooks.
				telemetryInterval = setInterval(() => { sendTelemetry(config).catch(() => {}); }, 30_000);

				// Send initial telemetry report
				sendTelemetry(config).catch(() => {});
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
		pi.events.emit("powerbar:update", { id: "a2a", text: undefined });
		sessionCtx = null;
		// Reject pending A2A request if any
		if (pendingResolve) {
			pendingResolve({ ok: false, response: "", error: "Session shutdown", durationMs: Date.now() - pendingStartTime });
			pendingResolve = null;
			pendingNonce = null;
		}

		// Stop telemetry interval
		if (telemetryInterval) {
			clearInterval(telemetryInterval);
			telemetryInterval = null;
		}

		// Send final "idle" telemetry report before shutting down
		if (hubAgentId) {
			const { config } = loadConfig(cwd);
			if (config.hub?.apiKey) {
				const idleSnap: TelemetrySnapshot = {
					queueDepth: 0,
					activeTasks: 0,
					maxConcurrent: 1,
				};
				await reportTelemetryToHub(
					hubAgentId,
					idleSnap,
					config.hub,
					log,
				).catch(() => {});
			}
		}
		hubAgentId = null;
		staticRegistry = null;

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

	/** Credential cache: agentId → { credential, fetchedAt }. TTL = 1 hour. */
	const CREDENTIAL_TTL_MS = 60 * 60 * 1000; // 1 hour
	const credentialCache = new Map<string, { credential: string | null; fetchedAt: number }>();

	/** Get credential for an agent, using cache with 1h TTL. */
	async function getCachedCredential(
		agentId: string,
		hubConfig: HubConfig,
	): Promise<string | null> {
		const cached = credentialCache.get(agentId);
		if (cached && (Date.now() - cached.fetchedAt) < CREDENTIAL_TTL_MS) {
			log("credential_cache_hit", { agentId });
			return cached.credential;
		}

		log("credential_cache_miss", { agentId, expired: !!cached });
		const result = await getCredentialFromHub(agentId, hubConfig, log);
		const credential = result?.credential ?? null;
		credentialCache.set(agentId, { credential, fetchedAt: Date.now() });
		return credential;
	}

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
			const lines: string[] = [];
			let totalCount = 0;

			// Static agents (always shown, no hub needed)
			if (staticRegistry && staticRegistry.size > 0) {
				const statics = staticRegistry.getAll();
				const query = params.q?.toLowerCase();
				const tagFilter = params.tags?.map((t: string) => t.toLowerCase());
				const filtered = statics.filter((e) => {
					// Text search filter
					if (query) {
						const desc = e.config.description ?? (e.card?.description as string) ?? "";
						if (!e.config.name.toLowerCase().includes(query) && !desc.toLowerCase().includes(query)) {
							return false;
						}
					}
					// Tags filter — match against skill tags from cached agent card
					if (tagFilter?.length) {
						const skills = e.card ? extractSkills(e.card) : [];
						const allTags = skills.flatMap((s) => (s.tags ?? []).map((t) => t.toLowerCase()));
						if (!tagFilter.some((t: string) => allTags.includes(t))) {
							return false;
						}
					}
					return true;
				});

				for (const entry of filtered) {
					const name = entry.config.name;
					const desc = entry.config.description ?? (entry.card?.description as string) ?? "No description";
					const url = entry.config.url;
					const skills = entry.card ? extractSkills(entry.card) : [];
					const skillList = skills.length > 0 ? skills.map((s) => s.name).join(", ") : "unknown";
					const cardStatus = entry.card ? "✓ card cached" : entry.error ?? "card not fetched";
					lines.push(
						`• **${name}** 🔗 Static\n  ${desc}\n  URL: ${url} | ${cardStatus}\n  Skills: ${skillList}`,
					);
					totalCount++;
				}
			}

			// Hub agents (only if hub is configured)
			if (config.hub?.apiKey) {
				const result = await discoverAgentsOnHub(config.hub, log, {
					q: params.q,
					category: params.category,
					tags: params.tags,
					limit: 50,
				});

				if (result) {
					discoveredAgents = result.agents;
					const availabilityEmoji: Record<string, string> = {
						idle: "🟢",
						busy: "🟡",
						saturated: "🔴",
						unknown: "⚪",
					};

					for (const a of result.agents) {
						const emoji = availabilityEmoji[a.availability] ?? "⚪";
						const availLabel = a.availability.charAt(0).toUpperCase() + a.availability.slice(1);
						const avgResp = a.avgResponseMs != null ? ` | Avg Response: ${(a.avgResponseMs / 1000).toFixed(1)}s` : "";
						const lastSeen = a.lastSeenAt ? ` | Last seen: ${a.lastSeenAt}` : "";
						lines.push(
							`• **${a.name}** (id: ${a.id}) ${emoji} ${availLabel}\n  ${a.description}\n  URL: ${a.url} | Health: ${a.healthStatus}${avgResp}${lastSeen} | Tags: ${a.tags.join(", ") || "none"}`,
						);
						totalCount++;
					}
				} else {
					lines.push("⚠️ Hub unreachable — hub agents not listed. Only showing static agents.");
				}
			}

			if (totalCount === 0) {
				const msg = "No agents found. Configure static agents in settings.json under pi-a2a.staticAgents, or set up a hub.";
				const suffix = lines.length > 0 ? `\n\n${lines.join("\n\n")}` : "";
				return txt(`${msg}${suffix}`);
			}

			return txt(`Found ${totalCount} agent(s):\n\n${lines.join("\n\n")}`);
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

			// Resolve agent URL, credential, and display name.
			// Resolution order: direct URL → static agents → hub cache → hub lookup.
			let agentUrl: string | null = null;
			let agentId: string | null = null;
			let agentName: string = params.agent;
			let credential: string | null = null;
			let fromStatic = false;

			// 1. Direct URL
			if (params.agent.startsWith("http://") || params.agent.startsWith("https://")) {
				agentUrl = params.agent;
				// Check if URL matches a static agent (for name + credential)
				if (staticRegistry) {
					const match = staticRegistry.findByUrl(params.agent);
					if (match) {
						credential = match.config.apiKey ?? null;
						agentName = match.config.name;
						fromStatic = true;
					}
				}
			} else {
				// 2. Static agent by name
				if (staticRegistry) {
					const match = staticRegistry.findByName(params.agent);
					if (match) {
						agentUrl = match.config.url;
						credential = match.config.apiKey ?? null;
						agentName = match.config.name;
						fromStatic = true;
					}
				}

				// 3. Hub agents (only if not resolved from static)
				if (!agentUrl) {
					if (config.hub?.apiKey) {
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
				}
			}

			if (!agentUrl) {
				return txt(
					`Error: Could not resolve agent "${params.agent}". ` +
					`Run a2a_discover first, provide a direct URL, or configure static agents in settings.json.`,
				);
			}

			// Get credential from hub for hub agents (static agents already have their credential)
			if (!fromStatic && agentId && config.hub?.apiKey) {
				credential = await getCachedCredential(agentId, config.hub);
			}

			// Fire off the request in the background — don't block the agent
			const sendStart = Date.now();
			const resolvedName = agentName;
			const resolvedUrl = agentUrl;
			const resolvedAgentId = agentId;
			const hubConfig = config.hub;
			const myToken = sessionToken;
			outboundPending++;
			updateStatusLine();

			const resolvedFromStatic = fromStatic;
			const sendOpts = {
				url: resolvedUrl,
				message: params.message,
				credential,
				timeoutMs: config.sendTimeoutMs,
				sender: { name: config.name ?? "Pi Agent", description: config.description, url: selfUrl ?? undefined } as SenderIdentity,
			};

			(async () => {
				let result = await sendA2AMessage(sendOpts, log);

				// Retry once on 401 — evict cached credential, fetch fresh (hub agents only)
				if (result.unauthorized && !resolvedFromStatic && resolvedAgentId && hubConfig) {
					log("credential_retry", { agentId: resolvedAgentId });
					credentialCache.delete(resolvedAgentId);
					const freshCredential = await getCachedCredential(resolvedAgentId, hubConfig);
					sendOpts.credential = freshCredential;
					result = await sendA2AMessage(sendOpts, log);
				}

				return result;
			})().then((result) => {
				// Bail out if session restarted while we were waiting
				if (sessionToken !== myToken) return;

				outboundPending--;
				updateStatusLine();

				const dur = fmtDuration(Date.now() - sendStart);

				if (result.ok && result.working) {
					// ACK received — the remote agent is working on it.
					// The actual result will arrive later as a separate inbound A2A message.
					pi.sendMessage(
						{
							customType: "a2a-response-ack",
							content:
								`⏳ **${resolvedName}** acknowledged the request (${dur}) — working on it. Response will arrive when ready.`,
							display: true,
						},
						{ triggerTurn: false },
					);
				} else if (result.ok) {
					pi.sendMessage(
						{
							customType: "a2a-response-received",
							content:
								`📨 **A2A response from ${resolvedName}** (${dur}):\n\n${result.response}`,
							display: true,
						},
						{ triggerTurn: true },
					);
				} else {
					pi.sendMessage(
						{
							customType: "a2a-response-error",
							content:
								`❌ **A2A error from ${resolvedName}** (${dur}): ${result.error}`,
							display: true,
						},
						{ triggerTurn: true },
					);
				}
			}).catch((err: unknown) => {
				// Bail out if session restarted while we were waiting
				if (sessionToken !== myToken) return;

				outboundPending--;
				updateStatusLine();

				const msg = err instanceof Error ? err.message : String(err);
				const dur = fmtDuration(Date.now() - sendStart);
				pi.sendMessage(
					{
						customType: "a2a-response-error",
						content:
							`❌ **A2A error from ${resolvedName}** (${dur}): ${msg}`,
						display: true,
					},
					{ triggerTurn: true },
				);
			});

			return txt(`📤 Message sent to **${agentName}** — waiting for response in the background. You'll see it when it arrives.`);
		},
	});

	// ── Ask Owner (Human-in-the-Loop) ────────────────────────

	pi.registerTool({
		name: "ask_owner",
		label: "Ask Owner",
		description:
			"Ask your human owner a question via the A2A Hub when you need clarification, " +
			"a decision, or approval to proceed. The owner answers through the hub's web UI. " +
			"This tool blocks until the owner responds (or timeout/expiry). " +
			"Use sparingly — only when you genuinely cannot proceed without human input.",
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the owner (max 2000 chars)" }),
			context: Type.Optional(Type.Object({}, { additionalProperties: true, description: "Optional structured metadata to help the owner understand the context" })),
			priority: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("urgent")], { description: "Priority level. Default: normal" })),
			timeoutMinutes: Type.Optional(Type.Number({ description: "How long to wait for a response in minutes. Default: 60, max: 4320 (72 hours)" })),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;

			if (!hubConfig) {
				return txt("❌ No A2A Hub configured. Set `pi-a2a.hub.url` and `pi-a2a.hub.apiKey` in settings.json.");
			}
			if (!hubAgentId) {
				return txt("❌ Agent not registered with the hub. The agent must be registered before asking the owner for clarification.");
			}

			const question = params.question.slice(0, 2000);
			const timeoutMinutes = Math.min(Math.max(params.timeoutMinutes ?? 60, 1), 4320);
			const timeoutMs = timeoutMinutes * 60 * 1000;
			const pollIntervalMs = 15_000; // 15 seconds

			// Submit the clarification request
			const clarification = await requestClarification(
				hubAgentId,
				question,
				hubConfig,
				log,
				{
					context: params.context,
					priority: params.priority,
				},
			);

			if (!clarification) {
				return txt("❌ Failed to submit clarification request to the hub. Check hub connectivity and API key.");
			}

			const { clarificationId } = clarification;
			const expiryNote = clarification.expiresAt
				? ` (expires ${clarification.expiresAt})`
				: "";

			log("ask_owner_waiting", { clarificationId, question: question.slice(0, 100), timeoutMinutes });

			// Poll until answered, expired, cancelled, or timeout.
			// Capture hubAgentId now — session_start resets it to null,
			// and we need the original value for cancel/poll calls.
			// Safe to assert non-null: guarded by the hubAgentId check above.
			const capturedAgentId = hubAgentId!;
			const deadline = Date.now() + timeoutMs;
			const myToken = sessionToken;

			while (Date.now() < deadline) {
				// Abort if session restarted while we were waiting
				if (sessionToken !== myToken) {
					await cancelClarification(capturedAgentId, clarificationId, hubConfig, log);
					return txt("⚠️ Session restarted — clarification request cancelled.");
				}

				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

				// Check again after sleep
				if (sessionToken !== myToken) {
					await cancelClarification(capturedAgentId, clarificationId, hubConfig, log);
					return txt("⚠️ Session restarted — clarification request cancelled.");
				}

				const poll = await pollClarification(capturedAgentId, clarificationId, hubConfig, log);

				if (!poll) {
					// Network error — keep trying until timeout
					log("ask_owner_poll_error", { clarificationId }, "WARN");
					continue;
				}

				switch (poll.status) {
					case "answered":
						log("ask_owner_answered", { clarificationId, responseLength: poll.response?.length ?? 0 });
						return txt(`✅ **Owner responded:**\n\n${poll.response}`);

					case "expired":
						log("ask_owner_expired", { clarificationId });
						return txt(`⏰ Clarification request expired${expiryNote}. The owner did not respond in time. Proceed with your best judgment or try again.`);

					case "cancelled":
						log("ask_owner_cancelled", { clarificationId });
						return txt("🚫 Clarification request was cancelled. Proceed with your best judgment or try again.");

					case "pending":
						// Still waiting — continue polling
						break;
				}
			}

			// Timeout reached — cancel the pending request
			await cancelClarification(capturedAgentId, clarificationId, hubConfig, log);
			log("ask_owner_timeout", { clarificationId, timeoutMinutes });
			return txt(`⏰ Timed out after ${timeoutMinutes} minute(s) waiting for owner response. The clarification request has been cancelled. Proceed with your best judgment or try again with a longer timeout.`);
		},
	});

	// ── Commands ──────────────────────────────────────────────

	pi.registerCommand("a2a", {
		description: "Manage the A2A protocol server. Usage: /a2a status | /a2a card | /a2a refresh | /a2a register | /a2a credential | /a2a discover [query] | /a2a agents [refresh|name]",
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
					let statusMsg =
						`A2A server running on port ${port}\n` +
						`Agent Card: ${publicUrl}/.well-known/agent-card.json\n` +
						`Protocol: A2A v0.3.0 | Mode: inline (main process)${busy}\n` +
						`Skills: ${skillCount} | Streaming: ✓ | Push Notifications: ✓`;

					if (hubAgentId) {
						const snap = buildTelemetrySnapshot();
						const avgPart = snap.lastTaskDurationMs != null ? ` | last ${(snap.lastTaskDurationMs / 1000).toFixed(1)}s` : "";
						statusMsg += `\nHub: registered (agentId=${hubAgentId})\n` +
							`Telemetry: ${snap.activeTasks} active / ${snap.maxConcurrent} max | ${snap.queueDepth} queued${avgPart}`;
					} else if (config.hub?.apiKey) {
						statusMsg += "\nHub: configured but not registered";
					}

					if (staticRegistry && staticRegistry.size > 0) {
						const withCards = staticRegistry.getAll().filter((a) => a.card !== null).length;
						statusMsg += `\nStatic agents: ${staticRegistry.size} configured, ${withCards} card(s) cached`;
					}

					ctx.ui.notify(statusMsg, "info");
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

				const result = await registerWithHub(publicUrl, config.hub, log);
				if (result) {
					ctx.ui.notify(`Registered with hub: agentId=${result.agentId}, status=${result.status}`, "info");
					if (config.apiKey) {
						await setCredentialOnHub(result.agentId, config.apiKey, config.hub, log);
						ctx.ui.notify("Credential pushed to hub", "info");
					}
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

				// We need the agentId. Use registerWithHub which handles conflict
				// (returns existing agentId if already registered).
				const reg = await registerWithHub(publicUrl, config.hub, log);
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

			if (action === "agents" || action === "agents refresh" || action.startsWith("agents ")) {
				if (!staticRegistry || staticRegistry.size === 0) {
					ctx.ui.notify("No static agents configured. Add pi-a2a.staticAgents to settings.json.", "info");
					return;
				}

				// /a2a agents refresh — re-fetch all agent cards
				if (action === "agents refresh") {
					ctx.ui.notify("Refreshing static agent cards…", "info");
					const result = await staticRegistry.refreshAll();
					const lines = result.details.map((d) =>
						d.ok ? `  ✓ ${d.name} — ${d.skillCount} skill(s)` : `  ✗ ${d.name} — ${d.error}`,
					);
					ctx.ui.notify(
						`Static agent cards refreshed: ${result.succeeded} succeeded, ${result.failed} failed\n${lines.join("\n")}`,
						result.failed > 0 ? "warning" : "info",
					);
					return;
				}

				// /a2a agents <name> — show specific agent's full card
				if (action.startsWith("agents ") && action !== "agents refresh") {
					const name = action.slice("agents ".length).trim();
					const entry = staticRegistry.findByName(name);
					if (!entry) {
						ctx.ui.notify(`Static agent "${name}" not found.`, "warning");
						return;
					}
					if (!entry.card) {
						ctx.ui.notify(
							`Agent card for "${entry.config.name}" has not been fetched. Run /a2a agents refresh.`,
							"warning",
						);
						return;
					}
					ctx.ui.notify(
						`Agent Card for ${entry.config.name}:\n${JSON.stringify(entry.card, null, 2)}`,
						"info",
					);
					return;
				}

				// /a2a agents — list all static agents
				const agents = staticRegistry.getAll();
				const lines = agents.map((e) => {
					const skills = e.card ? extractSkills(e.card) : [];
					const cardInfo = e.card
						? `✓ card cached | ${skills.length} skill(s)`
						: e.error ?? "card not fetched";
					return `  ${e.config.name} — ${e.config.url}\n    ${cardInfo}`;
				});
				ctx.ui.notify(`Static agents (${agents.length}):\n${lines.join("\n")}`, "info");
				return;
			}

			ctx.ui.notify(
				"Usage: /a2a status | /a2a card | /a2a refresh | /a2a register | /a2a credential | /a2a discover [query] | /a2a agents [refresh|name]",
				"info",
			);
		},
	});
}
