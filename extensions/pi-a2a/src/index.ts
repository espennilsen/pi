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
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import {
	DefaultRequestHandler,
	DefaultPushNotificationSender,
	JsonRpcTransportHandler,
} from "@a2a-js/sdk/server";
import { SQLiteTaskStore, SQLitePushNotificationStore } from "./task-store.ts";
import { loadConfig } from "./config.ts";
import { buildAgentCard, enrichAgentCard } from "./agent-card.ts";
import { PiAgentExecutor, type ProcessResult } from "./agent-executor.ts";
import { startServer, stopServer, isRunning, updateAgentCard, getAgentCard } from "./server.ts";
import { registerWithHub, setCredentialOnHub, discoverAgentsOnHub, getAgentFromHub, getCredentialFromHub, reportTelemetryToHub, requestClarification, pollClarification, cancelClarification, listAnsweredClarifications, acknowledgeClarification, type AnsweredClarification, createHubTask, getHubTask, listHubTasks, updateHubTask, transitionHubTask, deleteHubTask, getHubTaskHistory, getHubTaskBoard, reportHubTaskStatus, type HubTask, type PipelineState, type TaskPriority } from "./hub.ts";
import { sendA2AMessage, getRemoteTask, type SenderIdentity } from "./client.ts";
import { StaticAgentRegistry, extractSkills } from "./static-agents.ts";
import { createLogger } from "./logger.ts";
import { seedLoopMetadata, DEFAULT_MAX_HOPS } from "./supervisor.ts";
import type { HubConfig, PollerConfig, RemoteAgentSummary, TelemetrySnapshot } from "./types.ts";

const DEFAULT_PORT = 3100;

/** Sliding-window rate limiter for outbound response injection. */
class RateLimiter {
	private timestamps: number[] = [];
	constructor(private maxCalls: number, private windowMs: number) {}
	tryAcquire(): boolean {
		const now = Date.now();
		this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
		if (this.timestamps.length >= this.maxCalls) return false;
		this.timestamps.push(now);
		return true;
	}
	reset(): void { this.timestamps = []; }
}

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
	let pollerInterval: ReturnType<typeof setInterval> | null = null;
	let expiryInterval: ReturnType<typeof setInterval> | null = null;
	let hubAgentId: string | null = null;
	let staticRegistry: StaticAgentRegistry | null = null;
	/** Active SQLite task store — closed on session restart/shutdown. */
	let taskStore: SQLiteTaskStore | null = null;
	/** Active push notification store — shares DB with taskStore. */
	let pushNotificationStore: SQLitePushNotificationStore | null = null;
	/** Agent's canonical public URL (set on session_start, used for loop metadata). */
	let agentPublicUrl: string = "http://localhost:3100";
	/** Configured max hops (set on session_start, used for seeding outbound metadata). */
	let configuredMaxHops: number = DEFAULT_MAX_HOPS;
	/** Rate limiter for outbound response injection — 10 triggers per 60s window. */
	const responseLimiter = new RateLimiter(10, 60_000);

	// ── Main-process message handling ─────────────────────────
	//
	// When an A2A message arrives, we inject it into the main conversation
	// via pi.sendMessage({ triggerTurn: true }). The agent processes it
	// with full tool/skill access — everything visible in the TUI.
	// On agent_end, we capture the response and send it back to the caller.

	/** Resolve/reject functions for the pending A2A request. */
	let pendingResolve: ((result: ProcessResult) => void) | null = null;
	let pendingReject: ((error: Error) => void) | null = null;
	let pendingStartTime = 0;
	/** Nonce embedded in the injected message to correlate with agent_end. */
	let pendingNonce: string | null = null;

	/**
	 * Pending outbound input-required resolvers — keyed by nonce.
	 * When the outbound polling loop sees "input-required", it injects the
	 * question into the chat and parks here. agent_end resolves the matching
	 * nonce with the agent's answer, which is then sent as a follow-up.
	 */
	const pendingInputResolvers = new Map<string, { resolve: (text: string) => void; startTime: number }>();

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
	 * Get input from the local agent for an outbound input-required follow-up.
	 * Injects the remote agent's question into the chat, triggers a turn,
	 * and captures the response via agent_end (correlated by nonce).
	 */
	async function getInputFromAgent(agentName: string, question: string): Promise<string> {
		// Wait for agent to be idle
		await waitForIdle();

		const INPUT_ANSWER_TIMEOUT_MS = 300_000;
		let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
		let nonce: string | null = null;

		try {
			const answer = await Promise.race([
				new Promise<string>((resolve) => {
					nonce = randomUUID();
					pendingInputResolvers.set(nonce, { resolve, startTime: Date.now() });

					pi.sendMessage(
						{
							customType: "a2a-input-question",
							content:
								`❓ **${agentName} needs more information:**\n\n` +
								`> ${question.split("\n").join("\n> ")}\n\n` +
								`*Please answer this question. Your response will be sent back to ${agentName}.*`,
							display: true,
							details: { nonce },
						},
						{ triggerTurn: true },
					);
				}),
				new Promise<string>((_, reject) => {
					timeoutHandle = setTimeout(() => {
						if (nonce) {
							pendingInputResolvers.delete(nonce);
						}
						reject(new Error("Local agent failed to answer within 5 minutes"));
					}, INPUT_ANSWER_TIMEOUT_MS);
				}),
			]);
			return answer;
		} finally {
			if (nonce) pendingInputResolvers.delete(nonce);
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
		}
	}

	/**
	 * Abort a pending A2A request due to timeout or cancellation.
	 * Cleans up pendingResolve/pendingReject state so new tasks can proceed.
	 */
	function abortPendingRequest(reason: string): void {
		if (pendingReject) {
			const reject = pendingReject;
			pendingResolve = null;
			pendingReject = null;
			pendingNonce = null;
			reject(new Error(reason));
		}
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

		// Re-check after the await — another caller may have slipped through
		// while both were parked in waitForIdle().
		if (pendingResolve) {
			return { ok: false, response: "", error: "A2A request already in progress — concurrent invocation rejected", durationMs: 0 };
		}

		return new Promise<ProcessResult>((resolve, reject) => {
			const nonce = randomUUID();
			pendingResolve = resolve;
			pendingReject = reject;
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
				pendingReject = null;
				pendingNonce = null;

				if (response) {
					// Show completion in chat — result is saved to the task store,
					// callers retrieve it via tasks/get polling
					pi.sendMessage(
						{
							customType: "a2a-task-completed",
							content: `✅ **A2A task completed** (${fmtDuration(durationMs)}) — result saved to task store`,
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

		// Check for outbound input-required responses (a2a-input-question nonce matching)
		if (pendingInputResolvers.size > 0) {
			for (const [nonce, pending] of pendingInputResolvers) {
				const hasMatch = event.messages.some((m) =>
					"customType" in m &&
					m.customType === "a2a-input-question" &&
					(m as { details?: { nonce?: string } }).details?.nonce === nonce
				);

				if (hasMatch) {
					const response = extractAssistantText(event.messages);
					pendingInputResolvers.delete(nonce);
					pending.resolve(response || "(no response)");
					break; // Only one match per agent_end
				}
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
		responseLimiter.reset();
		credentialCache.clear();
		conversationContexts.clear();
		agentBusy = false;
		const staleResolvers = idleResolvers;
		idleResolvers = [];
		for (const r of staleResolvers) r();
		if (pendingResolve) {
			pendingResolve({ ok: false, response: "", error: "Session restart", durationMs: Date.now() - pendingStartTime });
		}
		pendingResolve = null;
		pendingReject = null;
		pendingNonce = null;
		// Resolve any pending outbound input-required questions with empty strings
		for (const [, pending] of pendingInputResolvers) {
			pending.resolve("");
		}
		pendingInputResolvers.clear();
		if (pollerInterval) {
			clearInterval(pollerInterval);
			pollerInterval = null;
		}
		pollerRunning = false;
		pollerSessionToken++;
		if (telemetryInterval) {
			clearInterval(telemetryInterval);
			telemetryInterval = null;
		}
		if (expiryInterval) {
			clearInterval(expiryInterval);
			expiryInterval = null;
		}
		hubAgentId = null;
		staticRegistry = null;
		if (executor) {
			executor.abortAll();
			executor = null;
		}
		pushNotificationStore = null;
		if (taskStore) {
			taskStore.close();
			taskStore = null;
		}
		if (isRunning()) {
			await stopServer(log);
		}

		const { config, warnings } = loadConfig(cwd);
		for (const w of warnings) log("config_warning", { message: w }, "WARN");
		const port = config.port ?? DEFAULT_PORT;
		const publicUrl = config.publicUrl ?? `http://localhost:${port}`;
		agentPublicUrl = publicUrl;
		configuredMaxHops = config.maxHops ?? DEFAULT_MAX_HOPS;
		const agentCard = buildAgentCard(config, publicUrl);

		// Initialize persistent task store (must be created before executor)
		const dbPath = join(getAgentDir(), "db", "a2a.db");
		taskStore = new SQLiteTaskStore(dbPath, log);

		// Set up executor — uses taskStore to persist results after background processing.
		// No onAsyncResult callback — results go into the store, callers poll via tasks/get.
		// Supervisor config provides agent identity and hop limit for loop control.
		const maxHops = config.maxHops ?? DEFAULT_MAX_HOPS;
		executor = new PiAgentExecutor(log, processMessage, taskStore, {
			agentId: publicUrl,
			defaultMaxHops: maxHops,
		}, config.taskTimeoutMs, config.inputRequiredTimeoutMs, config.maxInputRounds);

		// Set abort callback so executor can clean up pendingResolve on timeout
		executor.setAbortCallback(abortPendingRequest);

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
		pushNotificationStore = new SQLitePushNotificationStore(taskStore.getDb(), log);
		const pushNotificationSender = new DefaultPushNotificationSender(pushNotificationStore);

		// Set up task expiry interval
		const taskTtlMs = config.taskTtlMs ?? 86_400_000; // 24h default
		if (taskTtlMs > 0) {
			expiryInterval = setInterval(() => {
				if (!taskStore) return;
				const pruned = taskStore.pruneOlderThan(taskTtlMs);
				if (pruned > 0) {
					log("task_expiry_pruned", { pruned, taskTtlMs });
					// Clean up orphaned push notification configs for pruned tasks
					pushNotificationStore?.pruneOrphaned();
				}
			}, 300_000); // every 5 minutes
		}

		const requestHandler = new DefaultRequestHandler(
			agentCard,
			taskStore,
			executor,
			undefined,
			pushNotificationStore,
			pushNotificationSender,
			undefined,
		);

		// Wrap getTask to consult in-memory fallback statuses when DB write failed
		const originalGetTask = requestHandler.getTask.bind(requestHandler);
		requestHandler.getTask = async (params, context) => {
			const task = await originalGetTask(params, context);
			// If the task is still "working" but we have a fallback terminal state, patch it
			if (task?.status?.state === "working") {
				const fallback = executor?.getFallbackStatus(params.id);
				if (fallback) {
					const now = new Date().toISOString();
					task.status = {
						...task.status,
						state: fallback.state as "completed" | "failed",
						timestamp: now,
						message: {
							kind: "message",
							role: "agent",
							messageId: `fallback-${params.id}`,
							parts: [{ kind: "text", text: fallback.response || (fallback.state === "failed" ? "Task failed" : "Task completed") }],
						},
					};
					// For completed tasks, add the response as an artifact
					if (fallback.state === "completed" && fallback.response) {
						task.artifacts = [{
							artifactId: `fallback-artifact-${params.id}`,
							parts: [{ kind: "text", text: fallback.response }],
						}];
					}
				}
			}
			return task;
		};

		const rpcHandler = new JsonRpcTransportHandler(requestHandler);

		// Start the A2A server
		const bind = config.bind;
		const isLocalhost = !bind || bind === "127.0.0.1" || bind === "::1";
		if (!isLocalhost && !config.apiKey) {
		// Security: refuse to start when binding to external interfaces without authentication
		const msg = "Refusing to start A2A server: binding to external interface without apiKey. Set pi-a2a.apiKey in settings.json.";
		ctx.ui.notify(`pi-a2a: ERROR — ${msg}`, "warning");
		log("server_start_rejected", { bind, reason: "no_api_key_on_external_interface" }, "ERROR");
		// Clean up resources allocated before server start
		if (expiryInterval) { clearInterval(expiryInterval); expiryInterval = null; }
		executor = null;
		pushNotificationStore = null;
		taskStore.close(); taskStore = null;
		return;
		}
		try {
			await startServer({ port, bind, apiKey: config.apiKey, agentCard, rpcHandler, log });
			ctx.ui.notify(`pi-a2a: A2A server listening on ${bind ?? "127.0.0.1"}:${port}`, "info");
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			// Clean up resources allocated before server start
			if (expiryInterval) { clearInterval(expiryInterval); expiryInterval = null; }
			executor = null;
			pushNotificationStore = null;
			taskStore.close(); taskStore = null;
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

		// Start clarification response poller (if configured)
		startPoller(config);
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
			pendingReject = null;
			pendingNonce = null;
		}
		// Resolve any pending outbound input-required questions
		for (const [, pending] of pendingInputResolvers) {
			pending.resolve("");
		}
		pendingInputResolvers.clear();

		// Stop poller interval
		if (pollerInterval) {
			clearInterval(pollerInterval);
			pollerInterval = null;
		}

		// Stop telemetry interval
		if (telemetryInterval) {
			clearInterval(telemetryInterval);
			telemetryInterval = null;
		}

		// Stop expiry interval
		if (expiryInterval) {
			clearInterval(expiryInterval);
			expiryInterval = null;
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
		pushNotificationStore = null;
		if (taskStore) {
			taskStore.close();
			taskStore = null;
		}
		if (isRunning()) {
			await stopServer(log);
		}
	});

	// ── Clarification Response Poller ─────────────────────────
	//
	// Periodically checks the hub for owner responses to ask_owner questions.
	// When a response is found, spawns a fresh pi subprocess with the handoff
	// context + owner answer — completely independent of the current session.

	/** Guard against concurrent poll cycles. Paired with pollerSessionToken
	 *  so that a stale poll's finally block doesn't clear the guard for
	 *  a new session's active poll. */
	let pollerRunning = false;
	let pollerSessionToken = 0;

	/**
	 * Build a self-contained prompt for a fresh pi subprocess from an
	 * answered clarification. Includes full handoff context + owner response.
	 *
	 * Truncates response and handoff items to prevent OS spawn E2BIG/EINVAL errors.
	 */
	function buildClarificationPrompt(c: AnsweredClarification): string {
		const MAX_RESPONSE_LENGTH = 50_000; // ~50KB per field
		const MAX_HANDOFF_ITEM_LENGTH = 10_000; // ~10KB per handoff item

		const truncate = (text: string, maxLen: number): string => {
			if (text.length <= maxLen) return text;
			return text.slice(0, maxLen) + `\n\n[... truncated ${text.length - maxLen} characters]`;
		};

		const lines: string[] = [];

		lines.push("# Owner Response — Resume Work\n");
		lines.push("You are a fresh agent session spawned to handle an owner's response to a previous question.");
		lines.push("You have NO prior conversation context. Everything you need is below.\n");

		// Owner's Q&A
		lines.push("## Question Asked");
		lines.push(`> ${c.question}\n`);
		lines.push("## Owner's Response");
		lines.push(truncate(c.response, MAX_RESPONSE_LENGTH));
		lines.push("");

		// Handoff context
		if (c.handoff) {
			const h = c.handoff;

			if (h.project || h.branch || h.taskId) {
				lines.push("## Project Context");
				if (h.project) lines.push(`- **Project:** ${h.project}`);
				if (h.branch) lines.push(`- **Branch:** ${h.branch}`);
				if (h.taskId) lines.push(`- **Task:** ${h.taskId}`);
				lines.push("");
			}

			if (Array.isArray(h.done) && h.done.length > 0) {
				lines.push("## What's Been Done");
				for (const item of h.done) lines.push(`- ${truncate(item, MAX_HANDOFF_ITEM_LENGTH)}`);
				lines.push("");
			}

			if (Array.isArray(h.remaining) && h.remaining.length > 0) {
				lines.push("## What's Left");
				for (const item of h.remaining) lines.push(`- ${truncate(item, MAX_HANDOFF_ITEM_LENGTH)}`);
				lines.push("");
			}

			if (Array.isArray(h.decisions) && h.decisions.length > 0) {
				lines.push("## Key Decisions");
				for (const item of h.decisions) lines.push(`- ${truncate(item, MAX_HANDOFF_ITEM_LENGTH)}`);
				lines.push("");
			}

			if (Array.isArray(h.uncertain) && h.uncertain.length > 0) {
				lines.push("## Open Questions");
				for (const item of h.uncertain) lines.push(`- ${truncate(item, MAX_HANDOFF_ITEM_LENGTH)}`);
				lines.push("");
			}

			// Include any extra handoff fields not in the standard schema
			const standardKeys = new Set(["done", "remaining", "decisions", "uncertain", "project", "branch", "taskId"]);
			const extraKeys = Object.keys(h).filter((k) => !standardKeys.has(k));
			if (extraKeys.length > 0) {
				lines.push("## Additional Context");
				for (const key of extraKeys) {
					const val = typeof h[key] === "string" ? h[key] : JSON.stringify(h[key]);
					lines.push(`- **${key}:** ${truncate(val, MAX_HANDOFF_ITEM_LENGTH)}`);
				}
				lines.push("");
			}
		}

		// Additional context metadata
		if (c.context && Object.keys(c.context).length > 0) {
			lines.push("## Metadata");
			lines.push("```json");
			lines.push(JSON.stringify(c.context, null, 2));
			lines.push("```");
			lines.push("");
		}

		lines.push("## Instructions");
		lines.push("Use the owner's response and the handoff context above to continue the work.");
		lines.push("Start by reading the relevant files and understanding the current state, then proceed with the remaining tasks.");

		return lines.join("\n");
	}

	/**
	 * Spawn a fresh pi subprocess to handle an answered clarification.
	 * The subprocess runs in the project directory with configured extensions/skills.
	 */
	function spawnClarificationHandler(c: AnsweredClarification, pollerConfig: PollerConfig): void {
		const prompt = buildClarificationPrompt(c);

		// Determine working directory from handoff context.
		// Validate that the project path exists, is a directory, and is
		// under a safe root — the handoff data comes from the hub and must
		// not be trusted blindly. Restrict to HOME subtree to limit blast
		// radius even if the hub is compromised.
		let spawnCwd = cwd;
		const projectPath = c.handoff?.project as string | undefined;
		if (projectPath) {
			try {
				const resolved = resolve(projectPath);
				const home = process.env.HOME ?? "";
				const safeRoots = [home, cwd].filter(Boolean);
				const isSafe = safeRoots.some((root) =>
					resolved === root || resolved.startsWith(root + "/"),
				);

				if (!isSafe) {
					log("poller_rejected_project_path", { clarificationId: c.clarificationId, projectPath, reason: "outside allowed roots" }, "WARN");
				} else {
					const stat = statSync(resolved);
					if (stat.isDirectory()) {
						spawnCwd = resolved;
					} else {
						log("poller_invalid_project_path", { clarificationId: c.clarificationId, projectPath, reason: "not a directory" }, "WARN");
					}
				}
			} catch {
				log("poller_invalid_project_path", { clarificationId: c.clarificationId, projectPath, reason: "does not exist" }, "WARN");
			}
		}

		// Build pi command args
		const args: string[] = ["-p", prompt];

		// Disable extension/skill discovery — only load what's configured
		args.push("-ne", "-ns");

		// Add configured extensions
		if (pollerConfig.extensions?.length) {
			for (const ext of pollerConfig.extensions) {
				args.push("-e", ext);
			}
		}

		// Add configured skills
		if (pollerConfig.skills?.length) {
			for (const skill of pollerConfig.skills) {
				args.push("--skill", skill);
			}
		}

		// Model override
		if (pollerConfig.model) {
			args.push("--model", pollerConfig.model);
		}

		// Don't save session — these are ephemeral
		args.push("--no-session");

		log("poller_spawn", {
			clarificationId: c.clarificationId,
			cwd: spawnCwd,
			extensions: pollerConfig.extensions ?? [],
			skills: pollerConfig.skills ?? [],
			model: pollerConfig.model ?? "default",
			promptLength: prompt.length,
		});

		const child = spawn("pi", args, {
			cwd: spawnCwd,
			stdio: "ignore",
			detached: true,
			env: {
				...process.env,
				// Don't inherit cmux env — subprocess is independent
				CMUX_WORKSPACE_ID: undefined,
				CMUX_SURFACE_ID: undefined,
			},
		});

		child.on("error", (err) => {
			log("poller_spawn_error", { clarificationId: c.clarificationId, error: err.message }, "ERROR");
		});

		child.on("exit", (code) => {
			log("poller_spawn_exit", { clarificationId: c.clarificationId, exitCode: code });
		});

		// Detach — don't let the child keep this process alive
		child.unref();
	}

	/**
	 * Run one poll cycle: check hub for answered clarifications,
	 * spawn handlers, and acknowledge.
	 */
	async function pollForClarificationResponses(): Promise<void> {
		if (pollerRunning || !hubAgentId) return;
		pollerRunning = true;
		const myPollerToken = pollerSessionToken;

		// Snapshot hubAgentId — session_start can reset it to null between
		// any await points. Using a local const avoids stale references.
		const agentId = hubAgentId;

		try {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;
			const pollerConfig = config.poller;
			if (!hubConfig || !pollerConfig?.enabled) return;

			const answered = await listAnsweredClarifications(agentId, hubConfig, log);
			if (answered.length === 0) return;

			log("poller_found_answers", { count: answered.length });

			for (const c of answered) {
				// Acknowledge first — atomic, prevents double-processing
				const acked = await acknowledgeClarification(agentId, c.clarificationId, hubConfig, log);
				if (!acked) {
					log("poller_acknowledge_failed", { clarificationId: c.clarificationId }, "WARN");
					continue;
				}

				// Spawn a fresh pi subprocess — wrapped in try/catch because
				// spawn() can throw synchronously (e.g. ENOENT if pi binary
				// is missing). After acknowledge the item is consumed, so a
				// spawn failure means the work is lost. Log prominently.
				try {
					spawnClarificationHandler(c, pollerConfig);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					log("poller_spawn_failed_after_ack", {
						clarificationId: c.clarificationId,
						error: msg,
						question: c.question.slice(0, 100),
					}, "ERROR");
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log("poller_error", { error: msg }, "WARN");
		} finally {
			// Only clear the guard if this poll belongs to the current session.
			// A stale poll from a previous session must not reset the flag for
			// a new session's active poll.
			if (pollerSessionToken === myPollerToken) {
				pollerRunning = false;
			}
		}
	}

	/**
	 * Start the background poller if configured.
	 * Called from session_start after hub registration.
	 */
	function startPoller(config: ReturnType<typeof loadConfig>["config"]): void {
		if (pollerInterval) {
			clearInterval(pollerInterval);
			pollerInterval = null;
		}

		const pollerConfig = config.poller;
		if (!pollerConfig?.enabled || !config.hub?.apiKey) return;

		const intervalSec = Math.min(Math.max(pollerConfig.intervalSeconds ?? 60, 15), 600);
		const intervalMs = intervalSec * 1000;

		log("poller_started", { intervalSeconds: intervalSec, extensions: pollerConfig.extensions ?? [], skills: pollerConfig.skills ?? [] });

		// Run an initial poll immediately, then on interval
		pollForClarificationResponses().catch(() => {});
		pollerInterval = setInterval(() => {
			pollForClarificationResponses().catch(() => {});
		}, intervalMs);
	}

	// ── Tools ─────────────────────────────────────────────────

	/** In-memory cache of discovered agents from the hub. */
	let discoveredAgents: RemoteAgentSummary[] = [];

	/**
	 * Conversation context per remote agent — keyed by normalized agent URL.
	 * Tracks the last contextId and taskId so follow-up messages to the
	 * same agent automatically continue the conversation.
	 */
	const conversationContexts = new Map<string, { contextId: string; taskId?: string }>();

	/** Normalize an agent URL for use as conversation context key. */
	function normalizeAgentUrl(url: string): string {
		return url.replace(/\/+$/, "").toLowerCase();
	}

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
			"The hub provides the agent's URL and credential automatically. " +
			"Follow-up messages to the same agent automatically continue the previous conversation " +
			"(contextId/taskId are tracked per agent). Use newConversation to start fresh.",
		parameters: Type.Object({
			agent: Type.String({
				description: "Agent name, agent ID (UUID), or direct URL. Names are matched against discovered agents.",
			}),
			message: Type.String({ description: "Message to send to the remote agent" }),
			contextId: Type.Optional(Type.String({
				description: "Context ID to group related messages. Auto-filled from previous conversation with the same agent if omitted.",
			})),
			taskId: Type.Optional(Type.String({
				description: "Task ID to continue an existing task. Auto-filled from previous conversation with the same agent if omitted.",
			})),
			newConversation: Type.Optional(Type.Boolean({
				description: "Start a new conversation — ignore any stored contextId/taskId for this agent. Defaults to false.",
			})),
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

			// ── Resolve conversation context (contextId / taskId) ───
			// Auto-fill from previous conversation unless starting fresh.
			const agentKey = normalizeAgentUrl(agentUrl);
			let resolvedContextId = params.contextId;
			let resolvedTaskId = params.taskId;

			if (!params.newConversation && !resolvedContextId && !resolvedTaskId) {
				const prev = conversationContexts.get(agentKey);
				if (prev) {
					resolvedContextId = prev.contextId;
					resolvedTaskId = prev.taskId;
					log("conversation_context_reused", { agent: agentName, contextId: prev.contextId, taskId: prev.taskId });
				}
			}
			// Generate a fresh contextId for new conversations (or first contact)
			if (!resolvedContextId) {
				resolvedContextId = randomUUID();
			}
			if (params.newConversation) {
				resolvedTaskId = undefined;
			}

			// Resolve loop metadata: propagate from active inbound task, or seed fresh
			const activeLoop = executor?.getActiveLoopMetadata() ?? null;
			const outboundLoop = activeLoop
				? activeLoop  // Propagate inbound chain (already incremented by supervisor)
				: seedLoopMetadata(agentPublicUrl, configuredMaxHops);

			const resolvedFromStatic = fromStatic;
			const sendOpts = {
				url: resolvedUrl,
				message: params.message,
				credential,
				timeoutMs: config.sendTimeoutMs,
				sender: { name: config.name ?? "Pi Agent", description: config.description } as SenderIdentity,
				loopMetadata: outboundLoop,
				contextId: resolvedContextId,
				taskId: resolvedTaskId,
				// SDK auth handler retries on 401 — provide a callback to refresh the credential
				onRefreshCredential: (!resolvedFromStatic && resolvedAgentId && hubConfig)
					? async () => {
						log("credential_retry", { agentId: resolvedAgentId });
						credentialCache.delete(resolvedAgentId);
						return getCachedCredential(resolvedAgentId, hubConfig);
					}
					: undefined,
			};

			(async () => {
				try {
					const result = await sendA2AMessage(sendOpts, log);

					// Bail out if session restarted while we were waiting
					if (sessionToken !== myToken) return;

					// Store conversation context for follow-up messages
					if (result.ok) {
						conversationContexts.set(agentKey, {
							contextId: result.contextId ?? resolvedContextId!,
							taskId: result.taskId,
						});
					}

					// ── Immediate completion (remote responded inline) ──────
					if (result.ok && !result.working && result.response) {
						const dur = fmtDuration(Date.now() - sendStart);
						if (!responseLimiter.tryAcquire()) {
							log("rate_limit_response", { agent: resolvedName }, "WARN");
							pi.sendMessage({ customType: "a2a-rate-limited", content: `⚠️ Rate limited — response from **${resolvedName}** suppressed (too many responses in 60s)`, display: true }, { triggerTurn: false });
							return;
						}
						pi.sendMessage({ customType: "a2a-response-received", content: `📨 **A2A response from ${resolvedName}** (${dur}):\n\n${result.response}`, display: true }, { triggerTurn: true });
						return;
					}

					// ── Send error ──────────────────────────────────────────
					if (!result.ok) {
						const dur = fmtDuration(Date.now() - sendStart);
						pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A error from ${resolvedName}** (${dur}): ${result.error}`, display: true }, { triggerTurn: true });
						return;
					}

					// ── Working — poll for completion ───────────────────────
					const taskId = result.taskId;
					if (!taskId) {
						pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A error from ${resolvedName}**: No task ID returned for polling`, display: true }, { triggerTurn: true });
						return;
					}

					log("a2a_poll_start", { agent: resolvedName, taskId });
					const POLL_INTERVAL_MS = 5_000;
					const maxPollMs = config.sendTimeoutMs ?? 600_000; // 10 min default
					const pollDeadline = Date.now() + maxPollMs;
					const pollOpts = {
						url: resolvedUrl,
						taskId,
						credential,
						onRefreshCredential: sendOpts.onRefreshCredential,
					};
					const maxOutboundInputRounds = config.maxInputRounds ?? 5;
					let outboundInputRounds = 0;

					while (Date.now() < pollDeadline) {
						if (sessionToken !== myToken) return;
						await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
						if (sessionToken !== myToken) return;

						try {
							const poll = await getRemoteTask(pollOpts, log);

							if (poll.state === "completed") {
								const dur = fmtDuration(Date.now() - sendStart);
								if (!responseLimiter.tryAcquire()) {
									log("rate_limit_response", { agent: resolvedName, taskId }, "WARN");
									pi.sendMessage({ customType: "a2a-rate-limited", content: `⚠️ Rate limited — response from **${resolvedName}** suppressed`, display: true }, { triggerTurn: false });
									return;
								}
								pi.sendMessage({ customType: "a2a-response-received", content: `📨 **A2A response from ${resolvedName}** (${dur}):\n\n${poll.response ?? "(no content)"}`, display: true }, { triggerTurn: true });
								return;
							}

							if (poll.state === "failed") {
								const dur = fmtDuration(Date.now() - sendStart);
								pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A error from ${resolvedName}** (${dur}): ${poll.error ?? "Task failed"}`, display: true }, { triggerTurn: true });
								return;
							}

							if (poll.state === "canceled") {
								const dur = fmtDuration(Date.now() - sendStart);
								pi.sendMessage({ customType: "a2a-response-error", content: `🚫 **${resolvedName}** cancelled the task (${dur})`, display: true }, { triggerTurn: false });
								return;
							}

							if (poll.state === "input-required") {
								// Remote agent needs more information — ask the local agent
								outboundInputRounds++;
								if (outboundInputRounds > maxOutboundInputRounds) {
									const dur = fmtDuration(Date.now() - sendStart);
									log("a2a_poll_input_round_limit", { agent: resolvedName, taskId, rounds: outboundInputRounds, max: maxOutboundInputRounds }, "WARN");
									pi.sendMessage({ customType: "a2a-response-error", content: `⚠️ **${resolvedName}** asked for input too many times (${outboundInputRounds}/${maxOutboundInputRounds} rounds). Stopping. (${dur})`, display: true }, { triggerTurn: false });
									return;
								}

								const question = poll.response ?? "(agent needs more information)";
								log("a2a_poll_input_required", { agent: resolvedName, taskId, questionLength: question.length, round: outboundInputRounds });

								try {
									// Get the local agent's answer (injects question, captures response)
									const answer = await getInputFromAgent(resolvedName, question);

									if (sessionToken !== myToken) return;

									log("a2a_poll_input_followup", { agent: resolvedName, taskId, answerLength: answer.length });

									// Send the follow-up with the same taskId
									const followUpResult = await sendA2AMessage({
										...sendOpts,
										message: answer,
										taskId,
									}, log);

									if (!followUpResult.ok) {
										const dur = fmtDuration(Date.now() - sendStart);
										pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A follow-up to ${resolvedName} failed** (${dur}): ${followUpResult.error}`, display: true }, { triggerTurn: true });
										return;
									}
									// Follow-up sent — continue polling for completion
								} catch (inputErr) {
									const msg = inputErr instanceof Error ? inputErr.message : String(inputErr);
									log("a2a_poll_input_error", { agent: resolvedName, taskId, error: msg }, "ERROR");
									const dur = fmtDuration(Date.now() - sendStart);
									pi.sendMessage({ customType: "a2a-response-error", content: `❌ **Failed to answer ${resolvedName}'s question** (${dur}): ${msg}`, display: true }, { triggerTurn: true });
									return;
								}
								continue;
							}

							// Still working/submitted — continue polling
						} catch (pollErr) {
							const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
							log("a2a_poll_network_error", { agent: resolvedName, taskId, error: msg }, "WARN");
							// Continue polling — transient network errors are expected
						}
					}

					// Poll timeout
					const dur = fmtDuration(Date.now() - sendStart);
					pi.sendMessage({ customType: "a2a-response-error", content: `⏰ **${resolvedName}** did not complete within ${fmtDuration(maxPollMs)} (${dur}). Task ID: ${taskId}`, display: true }, { triggerTurn: false });
				} catch (err: unknown) {
					// Bail out if session restarted while we were waiting
					if (sessionToken !== myToken) return;

					const msg = err instanceof Error ? err.message : String(err);
					const dur = fmtDuration(Date.now() - sendStart);
					pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A error from ${resolvedName}** (${dur}): ${msg}`, display: true }, { triggerTurn: true });
				} finally {
					if (sessionToken === myToken) {
						outboundPending--;
						updateStatusLine();
					}
				}
			})();

			const contextNote = resolvedTaskId
				? ` (continuing task ${resolvedTaskId.slice(0, 8)}…)`
				: params.newConversation ? " (new conversation)" : "";
			return txt(`📤 Message sent to **${agentName}**${contextNote} — waiting for response in the background. You'll see it when it arrives.`);
		},
	});

	// ── Request Input (Multi-turn input-required) ───────────

	pi.registerTool({
		name: "a2a_request_input",
		label: "A2A Request Input",
		description:
			"Ask the remote A2A caller for more information during task processing. " +
			"This pauses the current task, sends a question back to the caller via " +
			"the input-required protocol state, and resumes when they respond. " +
			"Only works during inbound A2A task processing — not for user-initiated turns.",
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the caller" }),
			context: Type.Optional(Type.String({ description: "Additional context to help the caller understand what's needed" })),
		}),
		async execute(_toolCallId, params, signal) {
			if (!executor) {
				return txt("Error: A2A server not running.");
			}

			const activeTaskId = executor.getActiveTaskId();
			if (!activeTaskId) {
				return txt(
					"Error: Not processing an A2A task. " +
					"a2a_request_input can only be used during inbound A2A task processing.",
				);
			}

			const fullQuestion = params.context
				? `${params.question}\n\nContext: ${params.context}`
				: params.question;

			log("a2a_request_input_called", { taskId: activeTaskId, questionLength: fullQuestion.length });

			// Show in TUI that we're waiting for input
			pi.sendMessage(
				{
					customType: "a2a-input-required",
					content: `⏸️ **A2A task paused** — asking caller for more information:\n\n> ${fullQuestion.split("\n").join("\n> ")}`,
					display: true,
				},
				{ triggerTurn: false },
			);
			updateStatusLine();

			try {
				const answer = await executor.parkForInput(activeTaskId, fullQuestion, signal);

				log("a2a_request_input_answered", { taskId: activeTaskId, answerLength: answer.length });

				// Show in TUI that we received the answer
				pi.sendMessage(
					{
						customType: "a2a-input-received",
						content: `▶️ **A2A task resumed** — caller responded:\n\n> ${answer.split("\n").join("\n> ")}`,
						display: true,
					},
					{ triggerTurn: false },
				);

				return txt(answer);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				log("a2a_request_input_error", { taskId: activeTaskId, error: msg }, "ERROR");
				return txt(`Error waiting for input: ${msg}`);
			}
		},
	});

	// ── Ask Owner (Human-in-the-Loop) ────────────────────────

	pi.registerTool({
		name: "ask_owner",
		label: "Ask Owner",
		description:
			"Ask your human owner a question via the A2A Hub when you need clarification, " +
			"a decision, or approval to proceed. The owner answers through the hub's web UI. " +
			"This tool returns immediately — it does NOT block. When the owner responds, " +
			"a fresh pi subprocess is automatically spawned with your handoff context and " +
			"the owner's answer to continue the work. Include thorough handoff context " +
			"(done, remaining, decisions, project, branch, taskId) so the new session " +
			"can pick up where you left off.",
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the owner (max 2000 chars)" }),
			context: Type.Optional(Type.Object({}, { additionalProperties: true, description: "Optional structured metadata to help the owner understand the context" })),
			handoff: Type.Optional(Type.Object({
				done: Type.Optional(Type.Array(Type.String(), { description: "What has been completed so far" })),
				remaining: Type.Optional(Type.Array(Type.String(), { description: "What still needs to be done" })),
				decisions: Type.Optional(Type.Array(Type.String(), { description: "Key decisions made during this session" })),
				uncertain: Type.Optional(Type.Array(Type.String(), { description: "Open questions or areas of uncertainty" })),
				project: Type.Optional(Type.String({ description: "Project name or path for context" })),
				branch: Type.Optional(Type.String({ description: "Git branch being worked on" })),
				taskId: Type.Optional(Type.String({ description: "td task ID if applicable" })),
			}, { additionalProperties: true, description: "Structured handoff context so work can resume in a fresh session. Include what's done, what remains, key decisions, and open questions. This is critical — the new session has no prior context." })),
			priority: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("urgent")], { description: "Priority level. Default: normal" })),
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

			// Submit the clarification request — non-blocking
			const clarification = await requestClarification(
				hubAgentId,
				question,
				hubConfig,
				log,
				{
					context: params.context,
					handoff: params.handoff,
					priority: params.priority,
				},
			);

			if (!clarification) {
				return txt("❌ Failed to submit clarification request to the hub. Check hub connectivity and API key.");
			}

			const { clarificationId } = clarification;
			const expiryNote = clarification.expiresAt
				? ` Expires: ${clarification.expiresAt}.`
				: "";

			log("ask_owner_submitted", { clarificationId, question: question.slice(0, 100) });

			const pollerEnabled = config.poller?.enabled;
			const pollerNote = pollerEnabled
				? "The background poller will automatically spawn a fresh session when the owner responds."
				: "⚠️ The poller is not enabled — set `pi-a2a.poller.enabled: true` in settings.json to auto-process responses.";

			return txt(
				`📤 **Question submitted to owner** (id: ${clarificationId})\n\n` +
				`> ${question}\n\n` +
				`${pollerNote}${expiryNote}\n\n` +
				`You can continue with other work — this does not block.`,
			);
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
						`Skills: ${skillCount} | Streaming: ✓ | Push Notifications: ✓\n` +
						`Loop control: maxHops=${configuredMaxHops} | Agent ID: ${agentPublicUrl}`;

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

	// ── Hub Tasks (Pipeline CRUD) ───────────────────────────────────────────

	pi.registerTool({
		name: "hub_tasks",
		label: "Hub Tasks",
		description:
			"Manage pipeline tasks on the A2A Hub. Full CRUD for the Hub's build pipeline.\n" +
			"Actions:\n" +
			"  board      — Kanban board grouped by pipeline state\n" +
			"  list       — List tasks (filters: project, state, priority, assignedAgentId, page, limit, includeTerminal)\n" +
			"  get        — Get a single task by taskId\n" +
			"  create     — Create a task (title + project required; optional: description, repo, priority, assignedAgentId)\n" +
			"  update     — Update task fields (taskId required; any of: title, description, priority, assignedAgentId, externalTaskId, branch, prUrl, prNumber, blockedReason)\n" +
			"  transition — Move through pipeline (taskId + toState; optional note). States: queued→planning→building→reviewing→pr_ready→approved | blocked | cancelled\n" +
			"  delete     — Delete a task (taskId required)\n" +
			"  history    — State transition log for a task (taskId required)\n" +
			"  report     — Agent self-reports pipeline status (hubTaskId + toState; optional: externalTaskId, branch, prUrl, prNumber, blockedReason)",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("board"),
				Type.Literal("list"),
				Type.Literal("get"),
				Type.Literal("create"),
				Type.Literal("update"),
				Type.Literal("transition"),
				Type.Literal("delete"),
				Type.Literal("history"),
				Type.Literal("report"),
			], { description: "Action to perform" }),
			// Task identity
			taskId: Type.Optional(Type.String({ description: "Hub task ID (required for get/update/transition/delete/history)" })),
			hubTaskId: Type.Optional(Type.String({ description: "Hub task ID (for report action)" })),
			// Create / update fields
			title: Type.Optional(Type.String({ description: "Task title" })),
			description: Type.Optional(Type.String({ description: "Task description" })),
			project: Type.Optional(Type.String({ description: "Project name e.g. 'aivena', 'e9n.dev'" })),
			repo: Type.Optional(Type.String({ description: "Git repo URL" })),
			priority: Type.Optional(Type.Union([
				Type.Literal("low"), Type.Literal("normal"), Type.Literal("high"), Type.Literal("critical"),
			], { description: "Task priority (default: normal)" })),
			assignedAgentId: Type.Optional(Type.String({ description: "Agent ID to assign. Pass empty string to unassign." })),
			// Transition / report
			toState: Type.Optional(Type.Union([
				Type.Literal("queued"), Type.Literal("planning"), Type.Literal("building"),
				Type.Literal("reviewing"), Type.Literal("pr_ready"), Type.Literal("blocked"),
				Type.Literal("approved"), Type.Literal("cancelled"),
			], { description: "Target pipeline state" })),
			note: Type.Optional(Type.String({ description: "Transition note (e.g. review feedback)" })),
			// External references
			externalTaskId: Type.Optional(Type.String({ description: "td task ID on agent side e.g. td-abc123" })),
			branch: Type.Optional(Type.String({ description: "Git branch name" })),
			prUrl: Type.Optional(Type.String({ description: "Pull request URL" })),
			prNumber: Type.Optional(Type.Number({ description: "Pull request number" })),
			blockedReason: Type.Optional(Type.String({ description: "Reason for blocking" })),
			// List filters
			state: Type.Optional(Type.Union([
				Type.Literal("queued"), Type.Literal("planning"), Type.Literal("building"),
				Type.Literal("reviewing"), Type.Literal("pr_ready"), Type.Literal("blocked"),
				Type.Literal("approved"), Type.Literal("cancelled"),
			], { description: "Filter by state (for list)" })),
			page: Type.Optional(Type.Number({ description: "Page number for list (default: 1)" })),
			limit: Type.Optional(Type.Number({ description: "Results per page for list/history (default: 20/50)" })),
			includeTerminal: Type.Optional(Type.Boolean({ description: "Include approved/cancelled in list (default: false)" })),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;

			if (!hubConfig?.apiKey) {
				return txt("❌ No A2A Hub configured. Set `pi-a2a.hub.url` and `pi-a2a.hub.apiKey` in settings.json.");
			}

			switch (params.action) {

				case "board": {
					const board = await getHubTaskBoard(
						{ project: params.project, assignedAgentId: params.assignedAgentId },
						hubConfig, log,
					);
					if (!board) return txt("❌ Failed to fetch board — check hub connection.");
					const STAGES: PipelineState[] = ["queued", "planning", "building", "reviewing", "pr_ready", "blocked"];
					const EMOJI: Record<string, string> = {
						queued: "📋", planning: "📐", building: "🔨",
						reviewing: "👀", pr_ready: "🚀", blocked: "🚧",
					};
					const lines = [`# Hub Pipeline Board (${board.total} active tasks)\n`];
					if (board.projects.length) lines.push(`Projects: ${board.projects.join(", ")}\n`);
					for (const stage of STAGES) {
						const tasks: HubTask[] = (board.board[stage] as unknown as HubTask[]) ?? [];
						lines.push(`## ${EMOJI[stage]} ${stage.replace("_", " ")} (${tasks.length})`);
						if (tasks.length === 0) { lines.push("_none_\n"); continue; }
						for (const t of tasks) {
							const ext = t.externalTaskId ? ` [${t.externalTaskId}]` : "";
							const agent = t.assignedAgentId ? ` → agent:${t.assignedAgentId.slice(0, 8)}…` : "";
							const pr = t.prUrl ? ` PR#${t.prNumber}` : "";
							lines.push(`- **${t.id.slice(0, 8)}…** ${t.title} [${t.priority}]${ext}${agent}${pr}`);
							lines.push(`  id: ${t.id} | project: ${t.project}`);
						}
						lines.push("");
					}
					return txt(lines.join("\n"));
				}

				case "list": {
					const result = await listHubTasks({
						project: params.project,
						state: params.state as PipelineState | undefined,
						priority: params.priority as TaskPriority | undefined,
						assignedAgentId: params.assignedAgentId,
						page: params.page,
						limit: params.limit,
						includeTerminal: params.includeTerminal,
					}, hubConfig, log);
					if (!result) return txt("❌ Failed to list tasks.");
					if (result.tasks.length === 0) return txt("No tasks found.");
					const lines = [`# Hub Tasks (${result.total} total, page ${result.page})\n`];
					for (const t of result.tasks) {
						const ext = t.externalTaskId ? ` [${t.externalTaskId}]` : "";
						const agent = t.assignedAgentId ? ` → agent:${t.assignedAgentId.slice(0, 8)}…` : "";
						lines.push(`- **${t.id.slice(0, 8)}…** \`${t.state}\` [${t.priority}] ${t.title}${ext}${agent}`);
						lines.push(`  id: ${t.id} | project: ${t.project}`);
					}
					if (result.limit > 0 && result.total > result.page * result.limit) {
						lines.push(`\n_${result.total - result.page * result.limit} more — use page param to paginate_`);
					}
					return txt(lines.join("\n"));
				}

				case "get": {
					if (!params.taskId) return txt("❌ taskId required.");
					const task = await getHubTask(params.taskId, hubConfig, log);
					if (!task) return txt(`❌ Task not found: ${params.taskId}`);
					const lines = [
						`# Task: ${task.title}`,
						`**ID:** ${task.id}`,
						`**State:** ${task.state} | **Priority:** ${task.priority} | **Project:** ${task.project}`,
						task.description ? `**Description:** ${task.description}` : "",
						task.assignedAgentId ? `**Assigned:** ${task.assignedAgentId}` : "",
						task.externalTaskId ? `**External Task:** ${task.externalTaskId}` : "",
						task.branch ? `**Branch:** ${task.branch}` : "",
						task.prUrl ? `**PR:** [#${task.prNumber}](${task.prUrl})` : "",
						task.blockedReason ? `**Blocked:** ${task.blockedReason}` : "",
						task.repo ? `**Repo:** ${task.repo}` : "",
						`**Review:** ${task.reviewRound}/${task.maxReviewRounds} rounds`,
						`**Created:** ${task.createdAt} | **Updated:** ${task.updatedAt}`,
						task.startedAt ? `**Started:** ${task.startedAt}` : "",
						task.completedAt ? `**Completed:** ${task.completedAt}` : "",
					].filter(Boolean);
					return txt(lines.join("\n"));
				}

				case "create": {
					if (!params.title) return txt("❌ title required.");
					if (!params.project) return txt("❌ project required.");
					const task = await createHubTask({
						title: params.title,
						project: params.project,
						description: params.description,
						repo: params.repo,
						priority: params.priority as TaskPriority | undefined,
						assignedAgentId: params.assignedAgentId === "" ? undefined : params.assignedAgentId,
					}, hubConfig, log);
					if (!task) return txt("❌ Failed to create task.");
					return txt(`✅ Created\n**ID:** ${task.id}\n**Title:** ${task.title}\n**Project:** ${task.project} | **State:** ${task.state} | **Priority:** ${task.priority}`);
				}

				case "update": {
					if (!params.taskId) return txt("❌ taskId required.");
					const task = await updateHubTask({
						taskId: params.taskId,
						title: params.title,
						description: params.description,
						priority: params.priority as TaskPriority | undefined,
						assignedAgentId: params.assignedAgentId === "" ? null : params.assignedAgentId,
						externalTaskId: params.externalTaskId,
						branch: params.branch,
						prUrl: params.prUrl,
						prNumber: params.prNumber,
						blockedReason: params.blockedReason,
					}, hubConfig, log);
					if (!task) return txt(`❌ Failed to update: ${params.taskId}`);
					return txt(`✅ Updated\n**ID:** ${task.id}\n**Title:** ${task.title} | **State:** ${task.state} | **Priority:** ${task.priority}${task.externalTaskId ? `\n**External:** ${task.externalTaskId}` : ""}${task.branch ? `\n**Branch:** ${task.branch}` : ""}`);
				}

				case "transition": {
					if (!params.taskId) return txt("❌ taskId required.");
					if (!params.toState) return txt("❌ toState required.");
					const task = await transitionHubTask({
						taskId: params.taskId,
						toState: params.toState as PipelineState,
						note: params.note,
					}, hubConfig, log);
					if (!task) return txt(`❌ Failed to transition: ${params.taskId}`);
					return txt(`✅ Transitioned → **${task.state}**\n**ID:** ${task.id}\n**Title:** ${task.title}${params.note ? `\n**Note:** ${params.note}` : ""}`);
				}

				case "delete": {
					if (!params.taskId) return txt("❌ taskId required.");
					const result = await deleteHubTask(params.taskId, hubConfig, log);
					if (!result?.deleted) return txt(`❌ Failed to delete: ${params.taskId}`);
					return txt(`✅ Deleted: ${params.taskId}`);
				}

				case "history": {
					if (!params.taskId) return txt("❌ taskId required.");
					const result = await getHubTaskHistory(params.taskId, hubConfig, log, params.limit ?? 50);
					if (!result) return txt(`❌ Failed to fetch history: ${params.taskId}`);
					if (result.transitions.length === 0) return txt("No transitions recorded.");
					const lines = [`# History: ${params.taskId}\n`];
					for (const t of result.transitions) {
						const from = t.fromState ?? "(created)";
						const actor = t.actorAgentId
							? `agent:${t.actorAgentId.slice(0, 8)}…`
							: t.actorUserId ? `user:${t.actorUserId.slice(0, 8)}…` : "unknown";
						const note = t.note ? ` — ${t.note}` : "";
						lines.push(`- ${t.createdAt.slice(0, 19)} | ${from} → **${t.toState}** by ${actor}${note}`);
					}
					return txt(lines.join("\n"));
				}

				case "report": {
					if (!params.hubTaskId) return txt("❌ hubTaskId required.");
					if (!params.toState) return txt("❌ toState required.");
					const task = await reportHubTaskStatus({
						hubTaskId: params.hubTaskId,
						toState: params.toState as PipelineState,
						note: params.note,
						externalTaskId: params.externalTaskId,
						branch: params.branch,
						prUrl: params.prUrl,
						prNumber: params.prNumber,
						blockedReason: params.blockedReason,
					}, hubConfig, log);
					if (!task) return txt(`❌ Failed to report status: ${params.hubTaskId}`);
					return txt(`✅ Status reported → **${task.state}**\n**ID:** ${task.id}\n**Title:** ${task.title}${task.branch ? `\n**Branch:** ${task.branch}` : ""}${task.prUrl ? `\n**PR:** ${task.prUrl}` : ""}`);
				}

				default:
					return txt("Unknown action. Use: board, list, get, create, update, transition, delete, history, report");
			}
		},
	});
}
