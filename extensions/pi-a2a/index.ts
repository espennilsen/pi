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

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
	A2AError,
	DefaultRequestHandler,
	DefaultPushNotificationSender,
	JsonRpcTransportHandler,
} from "@a2a-js/sdk/server";
import { SQLiteTaskStore, SQLitePushNotificationStore } from "./task-store.ts";
import { loadConfig } from "./config.ts";
import { buildAgentCard, enrichAgentCard } from "./agent-card.ts";
import { getInboundSupportedModes } from "./inbound-auth.ts";
import { PiAgentExecutor, type ProcessResult } from "./agent-executor.ts";
import { startServer, stopServer, isRunning, updateAgentCard, getAgentCard } from "./server.ts";
import { registerWithHub, deregisterFromHub, setCredentialOnHub, discoverAgentsOnHub, getAgentFromHub, getCredentialFromHub, reportTelemetryToHub, requestClarification, pollClarification, cancelClarification, listAnsweredClarifications, acknowledgeClarification, type AnsweredClarification, createHubTask, getHubTask, listHubTasks, updateHubTask, transitionHubTask, deleteHubTask, getHubTaskHistory, getHubTaskBoard, reportHubTaskStatus, claimHubTask, heartbeatHubTask, HubRpcError, registerPushEndpoint, sendPushEvent, sendTaskStateChanged, sendTaskProgress, sendTaskError, sendHeartbeat, selectAgent, listStrategies, getProject, listProjects, createProject, updateProject, connectToPipelineStream, listenToSSEStream, type HubTask, type PipelineState, type TaskPriority } from "./hub.ts";
import { sendA2AMessage, getRemoteTask, type SenderIdentity } from "./client.ts";
import { StaticAgentRegistry, extractSkills, type CachedStaticAgent } from "./static-agents.ts";
import { createLogger, type LogFn } from "./logger.ts";
import { resolvePeerMetadata } from "./peer-metadata.ts";
import { selectPeerAuth } from "./auth-selector.ts";
import { buildOutboundAuthContext, type OutboundAuthContext } from "./outbound-auth.ts";
import { LegacyApiKeyProvider, OAuthClientCredentialsProvider, type TokenProvider } from "./token-provider.ts";
import { seedLoopMetadata, DEFAULT_MAX_HOPS } from "./supervisor.ts";
import { findFreePort } from "./port-finder.ts";
import type { HubConfig, PollerConfig, RemoteAgentSummary, TelemetrySnapshot, ToolCallRecord, TaskCostInfo, PushEventType, PipelineStreamEvent, LongRunningTasksConfig } from "./types.ts";
import { LongRunningTaskStore, type LongRunningTask, type ResumeRequest } from "./long-running-task-store.ts";
import {
	buildIdleTelemetrySnapshot,
	buildRecentToolCallsSnapshot,
	createSerializedAsyncRunner,
	drainRecentToolCalls,
	resetToolTelemetryState,
} from "./tool-telemetry.ts";

const DEFAULT_PORT = 3100;
const DEFAULT_DYNAMIC_RANGE_START = 27100;
const DEFAULT_DYNAMIC_RANGE_END = 27199;

/** Get interface IP by name, or primary non-loopback IPv4 if not specified. */
function getInterfaceIP(interfaceName?: string): string | null {
	const nets = networkInterfaces();

	// If interface specified, use it
	if (interfaceName) {
		const netsForInterface = nets[interfaceName];
		if (netsForInterface) {
			for (const net of netsForInterface) {
				if (net.family === "IPv4" && !net.internal) {
					return net.address;
				}
			}
		}
		// Check if it's already an IP address
		if (interfaceName.includes(".")) {
			return interfaceName;
		}
		return null; // interface not found
	}

	// Default: find first non-loopback IPv4
	for (const name of Object.keys(nets)) {
		for (const net of nets[name]!) {
			if (net.family === "IPv4" && !net.internal) {
				return net.address;
			}
		}
	}
	return null;
}

/** Build publicUrl and bind address from local config and port. Returns {publicUrl, bind}. */
function buildServerConfig(local: any, port: number, log: LogFn): { publicUrl: string; bind: string } {
	// Explicit publicUrl override
	if (local?.publicUrl) {
		return {
			publicUrl: local.publicUrl as string,
			bind: local.bind as string ?? "127.0.0.1",
		};
	}

	// bindInterface specified: bind to that interface's IP, advertise it
	if (local?.bindInterface) {
		const interfaceIP = getInterfaceIP(local.bindInterface as string);
		if (interfaceIP) {
			return {
				publicUrl: `http://${interfaceIP}:${port}`,
				bind: interfaceIP,
			};
		}
		// Interface not found, fall back to primary
		log("interface_not_found", { bindInterface: local.bindInterface }, "WARN");
	}

	// bind: "0.0.0.0" or "::": auto-detect primary IP for advertising
	const bind = local?.bind as string ?? "127.0.0.1";
	const isExternal = bind === "0.0.0.0" || bind === "::";
	if (isExternal) {
		const primaryIP = getInterfaceIP();
		return {
			publicUrl: primaryIP ? `http://${primaryIP}:${port}` : `http://localhost:${port}`,
			bind,
		};
	}

	// Default: localhost
	return {
		publicUrl: `http://localhost:${port}`,
		bind,
	};
}

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

	/**
	 * Active A2A task context — captured when processMessage is called and
	 * cleared after onTaskResultSaved fires. This is separate from pendingResolve
	 * because agent_end clears pendingResolve/pendingNonce before the executor's
	 * onTaskResultSaved callback fires.
	 */
	let activeA2aTask: { nonce: string; startTime: number; taskId?: string; toolCallCountStart: number; contextTokensStart: number } | null = null;
	/** Monotonic count of completed tool calls in the current session. */
	let totalCompletedToolCalls = 0;

	// ── Powerbar segment ──────────────────────────────────────

	pi.events.emit("powerbar:register-segment", {
		id: "a2a",
		label: "A2A",
	});
	let telemetryInterval: ReturnType<typeof setInterval> | null = null;
	let pollerInterval: ReturnType<typeof setInterval> | null = null;
	let expiryInterval: ReturnType<typeof setInterval> | null = null;
	let longRunningTaskPollerInterval: ReturnType<typeof setInterval> | null = null;
	let hubAgentId: string | null = null;
	/** Stable instance ID for this extension process, used by hub lease telemetry. */
	const hubInstanceId = randomUUID();
	let staticRegistry: StaticAgentRegistry | null = null;
	/** Active SQLite task store — closed on session restart/shutdown. */
	let taskStore: SQLiteTaskStore | null = null;
	/** Active long-running task store — survives Pi restarts. */
	let longRunningTaskStore: LongRunningTaskStore | null = null;
	/** Active push notification store — shares DB with taskStore. */
	let pushNotificationStore: SQLitePushNotificationStore | null = null;
	/** Agent's canonical public URL (set on session_start, used for loop metadata). */
	let agentPublicUrl: string = "http://localhost:3100";
	/** Resolved port (fixed or from dynamic discovery). */
	let agentPort: number = DEFAULT_PORT;
	/** Configured max hops (set on session_start, used for seeding outbound metadata). */
	let configuredMaxHops: number = DEFAULT_MAX_HOPS;
	/** Rate limiter for outbound response injection — 10 triggers per 60s window. */
	const responseLimiter = new RateLimiter(10, 60_000);
	/** Reuse token caches for repeated OAuth sends by the same peer and client. */
	const oauthProviders = new Map<string, OAuthClientCredentialsProvider>();

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

	/** Current session ID — persists across agent_end/agent_start cycles, changes on session restart. */
	let currentSessionId: string = randomUUID();

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

			// Capture active A2A task context for onTaskResultSaved callback
			const toolCallCountStart = recentToolCalls.length;
			const usageAtStart = sessionCtx?.getContextUsage();
			const contextTokensStart = usageAtStart?.tokens ?? 0;
			activeA2aTask = { nonce, startTime: start, toolCallCountStart, contextTokensStart };

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
				const now = Date.now();
				const durationMs = now - pendingStartTime;
				const resolve = pendingResolve;
				pendingResolve = null;
				pendingReject = null;
				pendingNonce = null;
				// Note: activeA2aTask is NOT cleared here — it's cleared by
				// onTaskResultSaved after the task result is saved to the store.

				// Compute cost attribution for this A2A task
				if (activeA2aTask) {
					const toolCallsDuringTask = Math.max(0, totalCompletedToolCalls - activeA2aTask.toolCallCountStart);
					const usageNow = sessionCtx?.getContextUsage();
					const contextTokensNow = usageNow?.tokens ?? 0;
					const tokensDuringTask = Math.max(0, contextTokensNow - activeA2aTask.contextTokensStart);
					const costDurationMs = Math.max(0, now - activeA2aTask.startTime);
					lastTaskCostInfo = computeTaskCost(toolCallsDuringTask, tokensDuringTask, costDurationMs);
					log("a2a_task_cost_computed", {
						nonce: activeA2aTask.nonce.slice(0, 8),
						toolCalls: toolCallsDuringTask,
						tokens: tokensDuringTask,
						cost: lastTaskCostInfo?.estimatedCostUsd,
						durationMs: costDurationMs,
					});
				}

				if (response) {
					resolve({ ok: true, response, durationMs });
				} else {
					lastTurnStatus = "failed";
					resolve({ ok: false, response: "", error: "Agent produced no text response", durationMs });
				}

				updateStatusLine();
			} else if (activeA2aTask?.nonce === pendingNonce) {
				const usageNow = sessionCtx?.getContextUsage();
				activeA2aTask.toolCallCountStart = totalCompletedToolCalls;
				activeA2aTask.contextTokensStart = usageNow?.tokens ?? 0;
				activeA2aTask.startTime = Date.now();
				log("a2a_task_cost_rebased", { nonce: activeA2aTask.nonce.slice(0, 8) });
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

	// ── Tool execution tracking for hub telemetry ———————————————
	pi.on("tool_execution_start", async (event) => {
		toolCallsInProgress.set(event.toolCallId, {
			startTime: Date.now(),
			toolName: event.toolName,
		});
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		const pending = toolCallsInProgress.get(event.toolCallId);
		if (!pending) return;
		toolCallsInProgress.delete(event.toolCallId);

		const durationMs = Date.now() - pending.startTime;

		let errorText: string | null = null;
		if (event.isError && event.result?.content?.[0]?.type === "text") {
			const text = event.result.content[0].text;
			errorText = text.length > 200 ? text.slice(0, 200) + "..." : text;
		}

		const usage = ctx.getContextUsage();

		const record: ToolCallRecord = {
			toolName: event.toolName,
			durationMs,
			isError: event.isError,
			errorText,
			modelId: sessionCtx?.model?.id,
			// @ts-expect-error provider is not on the Model type in the installed version
			modelProvider: sessionCtx?.model?.provider?.name ?? (sessionCtx?.model as any)?.provider?.name,
			modelContextWindow: sessionCtx?.model?.contextWindow,
			sessionId: (sessionCtx?.sessionManager as any)?.getSessionId?.(),
			contextTokens: usage?.tokens ?? null,
			contextPercent: usage?.percent ?? null,
			timestamp: Date.now(),
		};

		recentToolCalls.push(record);
		totalCompletedToolCalls += 1;
		if (recentToolCalls.length > MAX_RECENT_TOOL_CALLS) {
			recentToolCalls.shift();
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

	// ── Tool telemetry ———————————————————————
	/** Max completed tool calls retained in the ring buffer. */
	const MAX_RECENT_TOOL_CALLS = 20;
	interface ToolCallInProgress {
		/** Unix timestamp (ms) when the tool started. */
		startTime: number;
		/** Tool name at start time. */
		toolName: string;
	}
	/** Active tool calls keyed by toolCallId. */
	let toolCallsInProgress = new Map<string, ToolCallInProgress>();
	/** Completed tool calls ready for the next telemetry snapshot. */
	let recentToolCalls: ToolCallRecord[] = [];

	// ── Cost attribution ——————————————————————
	/** Cost info from the last completed/failed A2A task. */
	let lastTaskCostInfo: TaskCostInfo | null = null;

	/**
	 * Compute cost attribution for a completed A2A task.
	 * Uses session context usage, tool call count, and model metadata.
	 * Returns null if sessionCtx is not available.
	 */
	function computeTaskCost(toolCallCount: number, tokensDuringTask: number, durationMs: number): TaskCostInfo | null {
		if (!sessionCtx) return null;
		const contextWindow = sessionCtx.model?.contextWindow ?? 0;
		const inputTokens = Math.max(0, contextWindow > 0 ? Math.min(tokensDuringTask, contextWindow) : tokensDuringTask);
		// Approximate output tokens from the observed context delta. The context API
		// does not expose separate input/output counts, so keep this conservative.
		const outputTokens = Math.round(inputTokens * 0.25);

		const pricing = readModelPricingPerMillionTokens(sessionCtx.model as unknown as Record<string, unknown> | undefined);
		const estimatedCostUsd = pricing
			? (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
			: 0;

		return {
			inputTokens,
			outputTokens,
			estimatedCostUsd: Math.round(estimatedCostUsd * 10_000) / 10_000,
			toolCallCount,
			durationMs,
		};
	}

	function readModelPricingPerMillionTokens(model: Record<string, unknown> | undefined): { input: number; output: number } | null {
		if (!model) return null;
		const pricing = (model.pricing ?? model.cost ?? model.costs) as Record<string, unknown> | undefined;
		if (!pricing || typeof pricing !== "object") return null;

		const input = readNumber(pricing, ["inputPerMillion", "input_per_million", "promptPerMillion", "prompt_per_million"])
			?? readNumber(pricing, ["inputPerToken", "input_per_token", "promptPerToken", "prompt_per_token"], 1_000_000);
		const output = readNumber(pricing, ["outputPerMillion", "output_per_million", "completionPerMillion", "completion_per_million"])
			?? readNumber(pricing, ["outputPerToken", "output_per_token", "completionPerToken", "completion_per_token"], 1_000_000);

		return input !== undefined && output !== undefined ? { input, output } : null;
	}

	function readNumber(record: Record<string, unknown>, keys: string[], multiplier = 1): number | undefined {
		for (const key of keys) {
			const value = record[key];
			if (typeof value === "number" && Number.isFinite(value)) return value * multiplier;
		}
		return undefined;
	}

	const runSerializedTelemetrySend = createSerializedAsyncRunner();

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
		const toolCallSnapshot = buildRecentToolCallsSnapshot(recentToolCalls);
		if (toolCallSnapshot !== undefined) snapshot.recentToolCalls = toolCallSnapshot;
		if (lastTaskCostInfo) snapshot.costInfo = lastTaskCostInfo;
		return snapshot;
	}

	/** Send a telemetry snapshot to the hub. Failures are logged but never thrown. */
	async function sendTelemetry(config: ReturnType<typeof loadConfig>["config"]): Promise<void> {
		if (!hubAgentId || !config.hub?.apiKey) return;
		// Capture sessionToken to prevent stale telemetry sends after session rollover
		const telemetrySendSession = sessionToken;
		await runSerializedTelemetrySend(async () => {
			if (sessionToken !== telemetrySendSession) return;
			if (!hubAgentId) return;
			const snapshot = buildTelemetrySnapshot();
			const sentCount = snapshot.recentToolCalls?.length ?? 0;
			const result = await reportTelemetryToHub(hubAgentId, snapshot, config.hub!, log, hubInstanceId);
			if (result && sentCount > 0) {
				drainRecentToolCalls(recentToolCalls, sentCount);
			}
		});
	}

	/** Persist hub registration state for lease tools, deregistration, and telemetry. */
	function activateHubRegistration(agentId: string, config: ReturnType<typeof loadConfig>["config"]): void {
		hubAgentId = agentId;
		executor?.setHubAgentId(agentId);
		if (!telemetryInterval) {
			telemetryInterval = setInterval(() => { sendTelemetry(config).catch(() => {}); }, 30_000);
		}
		sendTelemetry(config).catch(() => {});
	}

	const sseConnections = new Map<string, { abort: () => void }>();

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		sessionCtx = ctx;
		cardEnriched = false;
		firstTurnEnriched = false;
		// Generate new session ID for this session
		currentSessionId = randomUUID();

		// Clean restart — reset all async state from previous session
		outboundPending = 0;
		sessionToken++;
		responseLimiter.reset();
		credentialCache.clear();
		conversationContexts.clear();
		agentBusy = false;
		resetToolTelemetryState(toolCallsInProgress, recentToolCalls);
		totalCompletedToolCalls = 0;
		lastTaskCostInfo = null;
		// Abort any active SSE subscriptions from previous session
		for (const [, conn] of sseConnections) {
			conn.abort();
		}
		sseConnections.clear();
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
		if (longRunningTaskPollerInterval) {
			clearInterval(longRunningTaskPollerInterval);
			longRunningTaskPollerInterval = null;
		}
		const oldHubAgentId = hubAgentId;
		hubAgentId = null;
		staticRegistry = null;
		// Clear active A2A task context BEFORE aborting executor to prevent
		// stale onTaskResultSaved callbacks from firing in the new session
		activeA2aTask = null;
		if (executor) {
			executor.abortAll();
			executor = null;
		}
		pushNotificationStore = null;
		if (taskStore) {
			taskStore.close();
			taskStore = null;
		}
		if (longRunningTaskStore) {
			longRunningTaskStore.close();
			longRunningTaskStore = null;
		}
		if (isRunning()) {
			await stopServer(log);
		}

		const { config, warnings } = loadConfig(cwd);
		for (const w of warnings) log("config_warning", { message: w }, "WARN");
		agentPort = config.local?.port ?? DEFAULT_PORT;
		// Resolve the intended bind address so findFreePort checks the right interface
		let bindHost = "127.0.0.1";
		if (config.local?.publicUrl) {
			bindHost = config.local?.bind ?? "127.0.0.1";
		} else if (config.local?.bindInterface) {
			const interfaceIP = getInterfaceIP(config.local.bindInterface);
			if (interfaceIP) {
				bindHost = interfaceIP;
			} else if (config.local?.bind) {
				bindHost = config.local.bind;
			}
		} else if (config.local?.bind) {
			bindHost = config.local.bind;
		}
		// If port is not explicitly configured, find a free one on the bind address
		if (config.local?.port == null) {
			const rangeStart = config.local?.portRange?.[0] ?? DEFAULT_DYNAMIC_RANGE_START;
			const rangeEnd = config.local?.portRange?.[1] ?? DEFAULT_DYNAMIC_RANGE_END;
			const free = await findFreePort(rangeStart, rangeEnd, bindHost);
			if (free !== null) {
				agentPort = free;
				log("dynamic_port_assigned", { port: free, range: [rangeStart, rangeEnd], bindHost });
			} else {
				log("dynamic_port_range_exhausted", { range: [rangeStart, rangeEnd], fallback: agentPort, bindHost }, "WARN");
			}
		}
		const serverConfig = buildServerConfig(config.local, agentPort, log);
		const publicUrl = serverConfig.publicUrl;
		agentPublicUrl = publicUrl;
		configuredMaxHops = config.maxHops ?? DEFAULT_MAX_HOPS;
		// This HTTP server has neither a TLS peer verifier nor a configured JWT verifier.
		// Do not advertise configured modern intent until a verifier-backed HTTPS runtime exists.
		const configuredUnenforceableInboundModes = config.local?.auth?.supportedAuthModes?.filter((mode) => mode === "oauth2" || mode === "oauth2+mtls") ?? [];
		if (configuredUnenforceableInboundModes.length > 0) {
			const message = `Configured inbound auth modes are unavailable in this HTTP runtime: ${configuredUnenforceableInboundModes.join(", ")}`;
			ctx.ui.notify(`pi-a2a: WARNING — ${message}`, "warning");
			log("a2a_auth_inbound_modes_unenforceable", { modes: configuredUnenforceableInboundModes, reason: "tls_or_oauth_verifier_unavailable" }, "WARN");
		}
		const inboundAuthModes = getInboundSupportedModes(config.local).filter((mode) => mode === "legacy-api-key");
		const agentCard = buildAgentCard(config, publicUrl, inboundAuthModes);

		// Deregister previous instance from hub (before re-registering)
		if (oldHubAgentId && config.hub?.apiKey) {
			deregisterFromHub(oldHubAgentId, config.hub, log).catch(() => {});
		}

		// Initialize persistent task store (must be created before executor)
		const dbPath = join(getAgentDir(), "db", "a2a.db");
		taskStore = new SQLiteTaskStore(dbPath, log);

		// Initialize long-running task store
		const longRunningDbPath = join(getAgentDir(), "db", "a2a-long-running.db");
		longRunningTaskStore = new LongRunningTaskStore(longRunningDbPath, log);

		// Set up executor — uses taskStore to persist results after background processing.
		// No onAsyncResult callback — results go into the store, callers poll via tasks/get.
		// Supervisor config provides agent identity and hop limit for loop control.
		const maxHops = config.maxHops ?? DEFAULT_MAX_HOPS;
		executor = new PiAgentExecutor(log, processMessage, taskStore, {
			agentId: publicUrl,
			defaultMaxHops: maxHops,
		}, config.taskTimeoutMs, config.inputRequiredTimeoutMs, config.maxInputRounds, config.hub);

		// Set abort callback so executor can clean up pendingResolve on timeout
		executor.setAbortCallback(abortPendingRequest);

		// When the executor finishes an A2A task, refresh TUI status and
		// send telemetry so the hub sees "idle" immediately — agent_end
		// fires before the executor clears activeTaskId, so this callback
		// is the earliest reliable point where executor.isBusy() is false.
		// Capture sessionToken to prevent stale callbacks after restart
		const taskFinishedSession = sessionToken;
		executor.onTaskFinished = () => {
			if (sessionToken !== taskFinishedSession) return;
			updateStatusLine();
			if (hubAgentId) {
				sendTelemetry(config).catch(() => {});
			}
			// Process resume queue after task finishes
			processResumeQueue(config).catch(() => {});
		};

		// Show completion message after task result is saved to the store.
		// This fires AFTER saveTaskResult() completes, ensuring the message
		// accurately reflects that the result is persisted.
		// Uses activeA2aTask context (not pendingResolve/pendingNonce) because
		// agent_end clears those before this callback fires.
		// Capture sessionToken to prevent stale callbacks from affecting new session
		const resultSavedSession = sessionToken;
		executor.onTaskResultSaved = (taskId: string, success: boolean) => {
			// Bail out if session restarted while callback was pending
			if (sessionToken !== resultSavedSession) return;
			if (activeA2aTask) {
				const durationMs = Date.now() - activeA2aTask.startTime;
				const status = success ? "completed" : "failed";
				const emoji = success ? "✅" : "❌";
				pi.sendMessage(
					{
						customType: "a2a-task-completed",
						content: `${emoji} **A2A task ${status}** (${fmtDuration(durationMs)}) — result saved to task store (task: ${taskId.slice(0, 8)}…)`,
						display: true,
					},
					{ triggerTurn: false },
				);
				// Update activeA2aTask with taskId for better logging
				activeA2aTask.taskId = taskId;
				// Clear activeA2aTask after message is sent
				activeA2aTask = null;
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

		// Restore long-running tasks from previous session
		restoreLongRunningTasks(config);

		// Start long-running task poller if enabled
		startLongRunningTaskPoller(config);

		// Wrap getTask to consult in-memory fallback statuses when DB write failed
		const originalGetTask = requestHandler.getTask.bind(requestHandler);
		requestHandler.getTask = async (params, context) => {
			try {
				const task = await originalGetTask(params, context);
				// If the task is still "working" but we have a fallback terminal state, patch it
				if (task?.status?.state === "working") {
					const fallback = executor?.getFallbackStatus(params.id);
					if (fallback) {
						const now = new Date().toISOString();
						task.status = {
							...task.status,
							state: fallback.state as "completed" | "failed" | "canceled",
							timestamp: now,
							message: {
								kind: "message",
								role: "agent",
								messageId: `fallback-${params.id}`,
								parts: [{ kind: "text", text: fallback.response || (fallback.state === "failed" ? "Task failed" : fallback.state === "canceled" ? "Task canceled" : "Task completed") }],
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
			} catch (e) {
				// If the task was never persisted to the DB (e.g. empty-message save failed),
				// originalGetTask throws "task not found". Check the fallback map.
				if (e instanceof A2AError && e.code === -32001) {
					const fallback = executor?.getFallbackStatus(params.id);
					if (fallback) {
						const now = new Date().toISOString();
						return {
							kind: "task",
							id: params.id,
							contextId: params.id,
							status: {
								state: fallback.state as "completed" | "failed" | "canceled",
								timestamp: now,
								message: {
									kind: "message",
									role: "agent",
									messageId: `fallback-${params.id}`,
									parts: [{ kind: "text", text: fallback.response || (fallback.state === "failed" ? "Task failed" : fallback.state === "canceled" ? "Task canceled" : "Task completed") }],
								},
							},
							...(fallback.state === "completed" && fallback.response ? {
								artifacts: [{
									artifactId: `fallback-artifact-${params.id}`,
									parts: [{ kind: "text", text: fallback.response }],
								}],
							} : {}),
						};
					}
				}
				throw e;
			}
		};

		const rpcHandler = new JsonRpcTransportHandler(requestHandler);

		// A2A does not require callers to provide a skill identifier. Therefore a
		// skill-scoped inbound legacy prohibition cannot be enforced for every
		// request; refuse startup rather than silently exposing the skill to legacy.
		const configuredInboundModes = config.local?.auth?.supportedAuthModes ?? [];
		const oauthOnlyInbound = configuredInboundModes.includes("oauth2") && !configuredInboundModes.includes("legacy-api-key");
		const startupAuthRejection = configuredInboundModes.includes("oauth2+mtls")
			? "Refusing to start A2A server: OAuth 2.0 + mTLS requires certificate-bound transport, which this runtime cannot enforce."
			: oauthOnlyInbound
				? "Refusing to start A2A server: OAuth-only inbound authentication requires an OAuth token verifier, which this runtime does not provide."
				: config.local?.auth?.modernOnlySkills?.length
					? "Refusing to start A2A server: local.auth.modernOnlySkills requires mandatory inbound skill identity, which this transport cannot enforce."
					: undefined;
		if (startupAuthRejection) {
			const msg = startupAuthRejection;
			ctx.ui.notify(`pi-a2a: ERROR — ${msg}`, "warning");
			log("server_start_rejected", { reason: configuredInboundModes.includes("oauth2+mtls") ? "mtls_transport_unavailable" : oauthOnlyInbound ? "oauth_verifier_unavailable" : "modern_only_skill_identity_unenforceable" }, "ERROR");
			if (longRunningTaskPollerInterval) { clearInterval(longRunningTaskPollerInterval); longRunningTaskPollerInterval = null; }
			if (longRunningTaskStore) { longRunningTaskStore.close(); longRunningTaskStore = null; }
			if (expiryInterval) { clearInterval(expiryInterval); expiryInterval = null; }
			executor = null;
			pushNotificationStore = null;
			taskStore.close(); taskStore = null;
			return;
		}

		// Start the A2A server
		let bind = serverConfig.bind;
		const isLocalhost = !bind || bind === "127.0.0.1" || bind === "::1";
		const hasApiKey = !!config.local?.apiKey;
		const autoGenDisabled = config.local?.requireApiKey !== true;
		if (!isLocalhost && !hasApiKey && autoGenDisabled) {
		// Security: refuse to start when binding to external interfaces without authentication
		// and auto-generation is disabled (requireApiKey is not true).
		const msg = "Refusing to start A2A server: binding to external interface without apiKey and requireApiKey is not enabled. Set pi-a2a.local.apiKey or pi-a2a.local.requireApiKey in settings.json.";
		ctx.ui.notify(`pi-a2a: ERROR — ${msg}`, "warning");
		log("server_start_rejected", { bind, reason: "no_api_key_external_no_autogen" }, "ERROR");
		// Clean up resources allocated before server start
		if (longRunningTaskPollerInterval) { clearInterval(longRunningTaskPollerInterval); longRunningTaskPollerInterval = null; }
		if (longRunningTaskStore) { longRunningTaskStore.close(); longRunningTaskStore = null; }
		if (expiryInterval) { clearInterval(expiryInterval); expiryInterval = null; }
		executor = null;
		pushNotificationStore = null;
		taskStore.close(); taskStore = null;
		return;
		}
		try {
			// Try to start server, retrying next port on EADDRINUSE
			while (true) {
				try {
					await startServer({ port: agentPort, bind, apiKey: config.local?.apiKey, auth: config.local?.auth, supportedAuthModes: inboundAuthModes, agentCard, rpcHandler, log });
					break;
				} catch (e: unknown) {
					const code = (e as NodeJS.ErrnoException).code;
					if (code === "EADDRINUSE" && config.local?.portRange) {
						const [start, end] = config.local.portRange;
						if (agentPort < end) {
							agentPort++;
							log("server_port_retry", { port: agentPort, reason: "EADDRINUSE" }, "WARN");
							// Rebuild server config with new port
							const newConfig = buildServerConfig(config.local, agentPort, log);
							bind = newConfig.bind;
							continue;
						}
					}
					throw e;
				}
			}
			ctx.ui.notify(`pi-a2a: A2A server listening on ${bind}:${agentPort}`, "info");
			// Rebuild publicUrl/agentCard with final port (may have changed via EADDRINUSE retry)
			const serverConfigFinal = buildServerConfig(config.local, agentPort, log);
			const publicUrl = serverConfigFinal.publicUrl;
			agentPublicUrl = publicUrl;
			updateAgentCard(buildAgentCard(config, publicUrl, inboundAuthModes));
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			// Clean up resources allocated before server start
			if (longRunningTaskPollerInterval) { clearInterval(longRunningTaskPollerInterval); longRunningTaskPollerInterval = null; }
			if (longRunningTaskStore) { longRunningTaskStore.close(); longRunningTaskStore = null; }
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
			const result = await registerWithHub(agentPublicUrl, config.hub, log);
			if (result) {
				activateHubRegistration(result.agentId, config);
				ctx.ui.notify(`pi-a2a: Registered with hub (${result.status})`, "info");

				// Always push credential via setCredential — registration may
				// have been a no-op (conflict/existing) and the credential may
				// have changed since last registration.
				if (config.local?.apiKey) {
					await setCredentialOnHub(result.agentId, config.local.apiKey, config.hub, log);
				}
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
		// Abort any active SSE subscriptions
		for (const [, conn] of sseConnections) {
			conn.abort();
		}
		sseConnections.clear();
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

		// Stop long-running task poller interval
		if (longRunningTaskPollerInterval) {
			clearInterval(longRunningTaskPollerInterval);
			longRunningTaskPollerInterval = null;
		}

		// Close long-running task store
		if (longRunningTaskStore) {
			longRunningTaskStore.close();
			longRunningTaskStore = null;
		}

		// Send final "idle" telemetry report before shutting down
		if (hubAgentId) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;
			if (hubConfig?.apiKey) {
				// Capture sessionToken to prevent stale telemetry sends after session rollover
				const telemetrySendSession = sessionToken;
				await runSerializedTelemetrySend(async () => {
					if (sessionToken !== telemetrySendSession) return;
					if (!hubAgentId) return;
					const idleSnap = buildIdleTelemetrySnapshot(recentToolCalls);
					const sentCount = idleSnap.recentToolCalls?.length ?? 0;
					const result = await reportTelemetryToHub(
						hubAgentId,
						idleSnap,
						hubConfig,
						log,
						hubInstanceId,
					).catch(() => false);
					if (result && sentCount > 0) {
						drainRecentToolCalls(recentToolCalls, sentCount);
					}
				});
			}
		}
		resetToolTelemetryState(toolCallsInProgress, recentToolCalls);
		totalCompletedToolCalls = 0;
		lastTaskCostInfo = null;
		// Deregister this instance from the hub
		if (hubAgentId) {
			const { config } = loadConfig(cwd);
			if (config.hub?.apiKey) {
				deregisterFromHub(hubAgentId, config.hub, log).catch(() => {});
			}
		}
		hubAgentId = null;
		staticRegistry = null;

		// Clear active A2A task context BEFORE aborting executor to prevent
		// stale onTaskResultSaved callbacks from firing after shutdown
		activeA2aTask = null;
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

	// ── Long-Running Task Support ─────────────────────────────────

	/**
	 * Restore long-running tasks from disk on session start.
	 * Re-queues resume requests for completed tasks.
	 */
	async function restoreLongRunningTasks(config: ReturnType<typeof loadConfig>["config"]): Promise<void> {
		if (!config.longRunningTasks?.enabled || !longRunningTaskStore) return;

		// Get all tasks (including terminal states) for restoration
		const allTasks = longRunningTaskStore.getPendingTasks();
		// Also get completed/failed tasks that may need resume
		const completedTasks = longRunningTaskStore.getByState('completed' as any);
		const failedTasks = longRunningTaskStore.getByState('failed' as any);
		const tasksToRestore = [...allTasks, ...completedTasks, ...failedTasks];

		if (tasksToRestore.length === 0) return;

		log("long_running_tasks_restored", { count: tasksToRestore.length });

		// Queue resume requests for completed/failed tasks
		for (const task of tasksToRestore) {
			if (task.state === 'completed' || task.state === 'failed') {
				const resumeRequest: ResumeRequest = {
					taskId: task.taskId,
					contextId: task.contextId,
					priority: 'normal',
					enqueuedAt: Date.now(),
					retryCount: 0,
				};
				longRunningTaskStore.enqueueResume(resumeRequest);
			}
		}

		// Process any queued resumes immediately if agent is idle
		await processResumeQueue(config);
	}

	/**
	 * Start polling for completed long-running tasks.
	 * Checks hub for task status updates and queues resume requests.
	 */
	function startLongRunningTaskPoller(config: ReturnType<typeof loadConfig>["config"]): void {
		if (!config.longRunningTasks?.enabled || !config.hub?.apiKey) return;

		const pollerConfig = config.longRunningTasks;
		const intervalMs = pollerConfig.pollingIntervalMs ?? 300_000; // 5 minutes default

		log("long_running_task_poller_started", { intervalMs });

		// Run initial poll immediately
		pollForCompletedLongRunningTasks(config).catch(() => {});

		longRunningTaskPollerInterval = setInterval(() => {
			pollForCompletedLongRunningTasks(config).catch(() => {});
		}, intervalMs);
	}

	/**
	 * Poll hub for completed long-running tasks and queue resume requests.
	 */
	async function pollForCompletedLongRunningTasks(config: ReturnType<typeof loadConfig>["config"]): Promise<void> {
		if (!longRunningTaskStore || !config.hub?.apiKey) return;

		const pendingTasks = longRunningTaskStore.getPendingTasks();
		if (pendingTasks.length === 0) return;

		for (const task of pendingTasks) {
			try {
				// Check task status on hub
				const hubTask = await getHubTask(task.taskId, config.hub, log);
				if (hubTask) {
					// Map hub pipeline state to LongRunningTask state
					const mappedState = mapHubStateToLongRunningState(hubTask.state);

					// Task state changed - update and queue resume if terminal state
					const updatedTask: LongRunningTask = {
						...task,
						state: mappedState,
						lastUpdatedAt: Date.now(),
					};
					longRunningTaskStore.save(updatedTask);

					// Queue resume for terminal states
					if (mappedState === 'completed' || mappedState === 'failed') {
						const resumeRequest: ResumeRequest = {
							taskId: task.taskId,
							contextId: task.contextId,
							priority: 'normal',
							enqueuedAt: Date.now(),
							retryCount: 0,
						};
						longRunningTaskStore.enqueueResume(resumeRequest);
						log("long_running_task_completed", { taskId: task.taskId, state: mappedState });

						// Trigger resume processing immediately
						await processResumeQueue(config);
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				log("long_running_task_poll_error", { taskId: task.taskId, error: msg }, "WARN");
			}
		}
	}

	/**
	 * Map hub pipeline state to LongRunningTask state.
	 */
	function mapHubStateToLongRunningState(hubState: string): LongRunningTask['state'] {
		// Terminal states
		if (hubState === 'approved' || hubState === 'pr_ready') return 'completed';
		if (hubState === 'cancelled') return 'failed';
		// Non-terminal states
		if (hubState === 'queued' || hubState === 'planning') return 'submitted';
		if (hubState === 'building') return 'working';
		if (hubState === 'reviewing') return 'working';
		if (hubState === 'blocked') return 'working';
		// Default to working for unknown states
		return 'working';
	}

	/**
	 * Process the resume queue - deliver completed task responses when agent is idle.
	 * Processes one request per call to avoid flooding.
	 */
	async function processResumeQueue(config: ReturnType<typeof loadConfig>["config"]): Promise<void> {
		if (!longRunningTaskStore || agentBusy) return;

		const request = longRunningTaskStore.dequeueResume();
		if (!request) return;

		try {
			// Load task state
			const task = longRunningTaskStore.load(request.taskId);
			if (!task) {
				log("resume_queue_task_not_found", { taskId: request.taskId });
				return;
			}

			// Check if this task belongs to current session
			if (task.sessionId !== currentSessionId) {
				log("resume_queue_stale_session", { taskId: request.taskId, taskSession: task.sessionId, currentSession: currentSessionId });
				// Task belongs to old session - skip it
				return;
			}

			// Inject completion message into chat
			const status = task.state === 'completed' ? 'completed' : 'failed';
			const emoji = task.state === 'completed' ? '✅' : '❌';
			const content = task.response || task.error || 'No response';

			pi.sendMessage(
				{
					customType: "a2a-long-running-task-completed",
					content: `${emoji} **Long-running A2A task ${status}** (task: ${task.taskId.slice(0, 8)}…)\n\n${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`,
					display: true,
				},
				{ triggerTurn: false },
			);

			log("resume_queue_processed", { taskId: request.taskId, state: task.state });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log("resume_queue_error", { taskId: request.taskId, error: msg }, "ERROR");

			// Retry logic
			if (request.retryCount < (config.longRunningTasks?.resumeRetryAttempts ?? 3)) {
				const retryRequest: ResumeRequest = {
					...request,
					retryCount: request.retryCount + 1,
					enqueuedAt: Date.now(),
				};
				longRunningTaskStore.enqueueResume(retryRequest);
				log("resume_queue_retry_scheduled", { taskId: request.taskId, retryCount: retryRequest.retryCount });
			}
		}
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
			skillId: Type.Optional(Type.String({
				description: "Requested remote skill ID. Required when the skill is governed by modernOnlySkills.",
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
			let staticEntry: CachedStaticAgent | undefined;
			let hubPeerDetail: Awaited<ReturnType<typeof getAgentFromHub>> | null = null;

			// 1. Direct URL
			if (params.agent.startsWith("http://") || params.agent.startsWith("https://")) {
				agentUrl = params.agent;
				// Check if URL matches a static agent (for name + credential)
				if (staticRegistry) {
					const match = staticRegistry.findByUrl(params.agent);
					if (match) {
						staticEntry = match;
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
						staticEntry = match;
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
								hubPeerDetail = detail;
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

			// Resolve peer capabilities and all secret-bearing outbound auth before
			// starting the background request. This deliberately fails closed: no
			// request is sent when the peer and local policy have no usable mode.
			const localAuth = config.local?.auth;
			let peer = await resolvePeerMetadata({
				agentId: agentId ?? agentUrl,
				endpoint: agentUrl,
				hubAgentId: !fromStatic ? agentId ?? undefined : undefined,
				staticAgent: staticEntry?.config,
				cachedCard: staticEntry?.card,
			}, {
				getHubAgent: async (id) => {
					const detail = hubPeerDetail ?? await getAgentFromHub(id, config.hub!, log);
					return detail ? { id: detail.id, auth: detail.auth } : null;
				},
				fetchAgentCard: async (endpoint) => {
					const base = endpoint.replace(/\/+$/, "");
					for (const path of ["/.well-known/agent-card.json", "/.well-known/agent.json"]) {
						try {
							const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
							if (response.ok) return await response.json() as Record<string, unknown>;
						} catch { /* Discovery is uncredentialed and failure is handled by selection. */ }
					}
					return null;
				},
			});
			// Older static/Hub peers did not publish Agent Card auth metadata. A
			// configured legacy credential is the existing explicit signal for those
			// peers; retain that behavior without guessing a modern mechanism.
			if (peer.supportedAuthModes.length === 0 && credential) {
				peer = { ...peer, supportedAuthModes: ["legacy-api-key"] };
				log("a2a_auth_legacy_metadata_fallback", { peerId: peer.agentId, taskId: params.taskId, operation: "a2a_send", metadataSource: peer.source, mode: "legacy-api-key" }, "WARN");
			}
			const selection = selectPeerAuth({ peer, local: localAuth, skillId: params.skillId });
			if (!selection.selectedAuthMode) {
				log("a2a_auth_selection_denied", { peerId: peer.agentId, taskId: params.taskId, operation: "a2a_send", metadataSource: peer.source, mode: null, reason: selection.denial?.reason }, "WARN");
				return txt(`Error: No supported outbound authentication mode for ${agentName} (${selection.denial?.reason ?? "selection denied"}). No request was sent.`);
			}
			log("a2a_auth_selected", { peerId: peer.agentId, taskId: params.taskId, operation: "a2a_send", metadataSource: selection.source, mode: selection.selectedAuthMode });
			if (selection.selectedAuthMode === "legacy-api-key") {
				log("a2a_auth_legacy_selected", { peerId: peer.agentId, taskId: params.taskId, operation: "a2a_send", metadataSource: selection.source, mode: selection.selectedAuthMode }, "WARN");
			}

			let provider: TokenProvider;
			if (selection.selectedAuthMode === "legacy-api-key") {
				provider = new LegacyApiKeyProvider(credential ?? undefined);
			} else {
				const oauth2 = localAuth?.oauth2;
				if (!oauth2?.clientId || !oauth2.clientSecret) {
					return txt(`Error: ${agentName} requires OAuth 2.0, but local.auth.oauth2 clientId/clientSecret are not configured. No request was sent.`);
				}
				const providerKey = JSON.stringify([
					peer.agentId,
					createHash("sha256").update(`${oauth2.clientId}\0${oauth2.clientSecret}`).digest("hex"),
					oauth2.trustedTokenEndpointOrigins,
				]);
				const oauthProvider = oauthProviders.get(providerKey) ?? new OAuthClientCredentialsProvider({
					clientId: oauth2.clientId,
					clientSecret: oauth2.clientSecret,
					trustedTokenEndpointOrigins: oauth2.trustedTokenEndpointOrigins,
				});
				oauthProviders.set(providerKey, oauthProvider);
				provider = oauthProvider;
			}

			let authContext: OutboundAuthContext;
			try {
				authContext = await buildOutboundAuthContext({ peer, selection, provider, localAuth });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				log("a2a_auth_context_failed", { peerId: peer.agentId, taskId: params.taskId, operation: "a2a_send", metadataSource: selection.source, mode: selection.selectedAuthMode, error: message }, "WARN");
				return txt(`Error: Could not authenticate to ${agentName}: ${message}. No request was sent.`);
			}
			// Fire off the request in the background — don't block the agent
			const sendStart = Date.now();
			const resolvedName = agentName;
			const resolvedUrl = agentUrl;
			const resolvedAgentId = agentId;
			const hubConfig = config.hub;
			const myToken = sessionToken;
			// NOTE: outboundPending is incremented AFTER the anti-pattern check so
			// that a blocked send doesn't leak the counter (the IIFE's finally block
			// that decrements it is never launched when we return early).

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

			// ── Anti-pattern check: sending back to the inbound caller ──
			// If an agent calls a2a_send to the agent that sent it the current
			// inbound task, the remote end receives a new task and its loop-guard
			// will fire (cycle detection: caller already in visitedAgents).
			// Warn loudly so the agent knows to respond directly instead.
			if (activeLoop && executor?.getActiveTaskId()) {
				const visited = activeLoop.visitedAgents;
				// visitedAgents = [...chain, thisAgent]. Direct caller = visited[length-2].
				const callerUrl = visited.length >= 2 ? visited[visited.length - 2] : null;
				if (callerUrl && normalizeAgentUrl(resolvedUrl) === normalizeAgentUrl(callerUrl)) {
					log("a2a_send_reply_to_caller", {
						agent: resolvedName,
						callerUrl,
						taskId: executor.getActiveTaskId(),
					}, "WARN");
					// Block the send and return a clear tool error — the LLM must see
					// the failure reason before the outbound request goes out.
					// (If we only warn without blocking, the send fires immediately
					// with triggerTurn:false and hits the remote cycle-detector anyway.)
					return txt(
						`⚠️ **A2A anti-pattern blocked**: \`a2a_send\` to **${resolvedName}** was cancelled. ` +
						`That agent sent you the current inbound task — do not call \`a2a_send\` back to it. ` +
						`Complete your turn and the result will be stored automatically for the caller to retrieve. ` +
						`Use \`a2a_request_input\` if you need to ask the caller a question.`,
					);
				}
			}

			// Increment now — after all early-return guards — so a blocked send
			// doesn't permanently inflate the pending count.
			outboundPending++;
			updateStatusLine();

			const resolvedFromStatic = fromStatic;
			const refreshAuthContext = async (): Promise<string | null> => {
				if (selection.selectedAuthMode === "legacy-api-key") {
					// Retain the Hub credential refresh behavior for legacy peers.
					if (resolvedFromStatic || !resolvedAgentId || !hubConfig) return null;
					log("credential_retry", { agentId: resolvedAgentId });
					log("a2a_auth_token_refresh", { peerId: peer.agentId, taskId: resolvedTaskId, operation: "a2a_send", metadataSource: selection.source, mode: selection.selectedAuthMode });
					credentialCache.delete(resolvedAgentId);
					credential = await getCachedCredential(resolvedAgentId, hubConfig);
					provider = new LegacyApiKeyProvider(credential ?? undefined);
					authContext = await buildOutboundAuthContext({ peer, selection, provider, localAuth });
					return authContext.headers.Authorization.slice("Bearer ".length);
				}
				// A 401 may mean a revoked OAuth token. Evict the provider cache before
				// rebuilding the context, so the SDK retry uses a newly fetched token.
				log("a2a_auth_token_refresh", { peerId: peer.agentId, taskId: resolvedTaskId, operation: "a2a_send", metadataSource: selection.source, mode: selection.selectedAuthMode });
				provider.invalidate?.(peer, selection);
				authContext = await buildOutboundAuthContext({ peer, selection, provider, localAuth });
				return authContext.headers.Authorization.slice("Bearer ".length);
			};
			const usesNegotiatedAuthContext = selection.selectedAuthMode !== "legacy-api-key";
			const sendOpts = {
				url: resolvedUrl,
				message: params.message,
				// Preserve the legacy client path (including Hub key refresh); modern
				// OAuth modes always use the negotiated auth context.
				authContext: usesNegotiatedAuthContext ? authContext : undefined,
				credential: usesNegotiatedAuthContext ? undefined : credential,
				timeoutMs: config.sendTimeoutMs,
				sender: { name: config.name ?? "Pi Agent", description: config.description } as SenderIdentity,
				loopMetadata: outboundLoop,
				contextId: resolvedContextId,
				taskId: resolvedTaskId,
				onRefreshCredential: refreshAuthContext,
			};

			// Was this a2a_send initiated during an active inbound task processing?
			// If so, suppress triggerTurn on response delivery to prevent the agent
			// from initiating a new forward hop back to the original caller.
			// The inbound task result is already stored in the TaskStore by the time
			// this async IIFE completes — triggering a new turn would cause the agent
			// to re-invoke the sender, which trips the loop-guard cycle detector.
			// Use loose != (catches both null and undefined) so that when executor
			// is null, executor?.getActiveTaskId() returns undefined, which != null
			// is false — correctly treating a missing executor as no active task.
			const wasSubcall = executor?.getActiveTaskId() != null;

			(async () => {
				try {
					let result = await sendA2AMessage(sendOpts, log);

					// Bail out if session restarted while we were waiting
					if (sessionToken !== myToken) return;

					// ── Auto-retry on terminal task error ──────────────────
					// When the remote task is already completed/failed/cancelled,
					// the hub rejects follow-up messages with JSON-RPC -32600
					// ("Task ... is in a terminal state and cannot be modified").
					// Recover automatically by starting a fresh task (same contextId,
					// no stale taskId) so the user doesn't need newConversation=true.
					if (!result.ok && result.error && /terminal state/i.test(result.error) && resolvedTaskId) {
						log("a2a_terminal_task_retry", { agent: agentName, oldTaskId: resolvedTaskId });
						// Clear the stale taskId from the context store immediately
						conversationContexts.set(agentKey, { contextId: resolvedContextId! });
						// Retry as a new task (keep contextId for conversation continuity)
						result = await sendA2AMessage({
							...sendOpts,
							authContext: usesNegotiatedAuthContext ? authContext : undefined,
							credential: usesNegotiatedAuthContext ? undefined : credential,
							taskId: undefined,
						}, log);
						if (sessionToken !== myToken) return;
					}

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
						pi.sendMessage({ customType: "a2a-response-received", content: `📨 **A2A response from ${resolvedName}** (${dur}):\n\n${result.response}`, display: true }, { triggerTurn: !wasSubcall });
						return;
					}

					// ── Send error ──────────────────────────────────────────
					if (!result.ok) {
						const dur = fmtDuration(Date.now() - sendStart);
						pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A error from ${resolvedName}** (${dur}): ${result.error}`, display: true }, { triggerTurn: !wasSubcall });
						return;
					}

					// ── Working — poll for completion ───────────────────────
					const taskId = result.taskId;
					if (!taskId) {
						pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A error from ${resolvedName}**: No task ID returned for polling`, display: true }, { triggerTurn: !wasSubcall });
						return;
					}

					log("a2a_poll_start", { agent: resolvedName, taskId });
					const POLL_INTERVAL_MS = 5_000;
					const maxPollMs = config.sendTimeoutMs ?? 600_000; // 10 min default
					const pollDeadline = Date.now() + maxPollMs;
					const pollOpts = {
						url: resolvedUrl,
						taskId,
						authContext: usesNegotiatedAuthContext ? authContext : undefined,
						credential: usesNegotiatedAuthContext ? undefined : credential,
						onRefreshCredential: refreshAuthContext,
					};
					const maxOutboundInputRounds = config.maxInputRounds ?? 5;
					let outboundInputRounds = 0;

					while (Date.now() < pollDeadline) {
						if (sessionToken !== myToken) return;
						await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
						if (sessionToken !== myToken) return;

						try {
							const poll = await getRemoteTask(pollOpts, log);
							// The retry callback may have rebuilt OAuth/Hub auth. Carry its
							// refreshed credential/context into the next poll.
							if (usesNegotiatedAuthContext) pollOpts.authContext = authContext;
							else pollOpts.credential = credential;

							if (poll.state === "completed") {
								const dur = fmtDuration(Date.now() - sendStart);
								if (!responseLimiter.tryAcquire()) {
									log("rate_limit_response", { agent: resolvedName, taskId }, "WARN");
									pi.sendMessage({ customType: "a2a-rate-limited", content: `⚠️ Rate limited — response from **${resolvedName}** suppressed`, display: true }, { triggerTurn: false });
									return;
								}
								pi.sendMessage({ customType: "a2a-response-received", content: `📨 **A2A response from ${resolvedName}** (${dur}):\n\n${poll.response ?? "(no content)"}`, display: true }, { triggerTurn: !wasSubcall });
								return;
							}

							if (poll.state === "failed") {
								const dur = fmtDuration(Date.now() - sendStart);
								pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A error from ${resolvedName}** (${dur}): ${poll.error ?? "Task failed"}`, display: true }, { triggerTurn: !wasSubcall });
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
										authContext: usesNegotiatedAuthContext ? authContext : undefined,
										credential: usesNegotiatedAuthContext ? undefined : credential,
										message: answer,
										taskId,
									}, log);

									if (!followUpResult.ok) {
										const dur = fmtDuration(Date.now() - sendStart);
										pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A follow-up to ${resolvedName} failed** (${dur}): ${followUpResult.error}`, display: true }, { triggerTurn: !wasSubcall });
										return;
									}
									// Follow-up sent — continue polling for completion
								} catch (inputErr) {
									const msg = inputErr instanceof Error ? inputErr.message : String(inputErr);
									log("a2a_poll_input_error", { agent: resolvedName, taskId, error: msg }, "ERROR");
									const dur = fmtDuration(Date.now() - sendStart);
									pi.sendMessage({ customType: "a2a-response-error", content: `❌ **Failed to answer ${resolvedName}'s question** (${dur}): ${msg}`, display: true }, { triggerTurn: !wasSubcall });
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
					pi.sendMessage({ customType: "a2a-response-error", content: `❌ **A2A error from ${resolvedName}** (${dur}): ${msg}`, display: true }, { triggerTurn: !wasSubcall });
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
					context: params.context as Record<string, unknown>,
					handoff: params.handoff as Record<string, unknown>,
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
		description: "Manage the A2A protocol server. Usage: /a2a status | /a2a card | /a2a refresh | /a2a register | /a2a credential | /a2a apikey | /a2a discover [query] | /a2a agents [refresh|name]",
		handler: async (args, ctx) => {
			const action = args.trim();
			const { config } = loadConfig(cwd);
			const port = agentPort;
			const serverConfigCmd = buildServerConfig(config.local, agentPort, log);
			const publicUrl = serverConfigCmd.publicUrl;

			if (action === "status") {
				if (isRunning()) {
					const card = getAgentCard();
					const skillCount = card?.skills.length ?? 0;
					const queued = executor?.queueDepth() ?? 0;
					const busy = executor?.isBusy()
						? ` | Processing: 1 task${queued > 0 ? ` + ${queued} queued` : ""}`
						: "";
					let statusMsg =
						`A2A server running on port ${agentPort}\n` +
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

				const result = await registerWithHub(agentPublicUrl, config.hub, log);
				if (result) {
					activateHubRegistration(result.agentId, config);
					ctx.ui.notify(`Registered with hub: agentId=${result.agentId}, instanceId=${hubInstanceId}, status=${result.status}`, "info");
					if (config.local?.apiKey) {
						await setCredentialOnHub(result.agentId, config.local.apiKey, config.hub, log);
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
				if (!config.local?.apiKey) {
					ctx.ui.notify("No pi-a2a.local.apiKey configured — nothing to push to hub", "warning");
					return;
				}

				// We need the agentId. Use registerWithHub which handles conflict
				// (returns existing agentId if already registered).
				const reg = await registerWithHub(agentPublicUrl, config.hub, log);
				if (!reg) {
					ctx.ui.notify("Could not determine agentId — registration failed", "warning");
					return;
				}

				activateHubRegistration(reg.agentId, config);
				const result = await setCredentialOnHub(reg.agentId, config.local.apiKey, config.hub, log);
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

			if (action === "apikey") {
				if (!config.local?.apiKey) {
					ctx.ui.notify("No effective pi-a2a local API key is configured", "warning");
					return;
				}
				ctx.ui.notify(`pi-a2a local API key: ${config.local.apiKey}`, "info");
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
				"Usage: /a2a status | /a2a card | /a2a refresh | /a2a register | /a2a credential | /a2a apikey | /a2a discover [query] | /a2a agents [refresh|name]",
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
			"  claim      — Atomically claim a task (taskId optional; project/projectId optional; leaseDurationSeconds optional, default 900, range 1-86400; uses the current agent instance)\n" +
			"  heartbeat  — Renew a claimed lease (taskId required; leaseDurationSeconds optional, default 900, range 1-86400; uses the current agent instance)\n" +
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
				Type.Literal("claim"),
				Type.Literal("heartbeat"),
				Type.Literal("delete"),
				Type.Literal("history"),
				Type.Literal("report"),
			], { description: "Action to perform" }),
			// Task identity
			taskId: Type.Optional(Type.String({ description: "Hub task ID (required for get/update/transition/heartbeat/delete/history)" })),
			hubTaskId: Type.Optional(Type.String({ description: "Hub task ID (for report action)" })),
			// Create / update fields
			title: Type.Optional(Type.String({ description: "Task title" })),
			description: Type.Optional(Type.String({ description: "Task description" })),
			project: Type.Optional(Type.String({ description: "Project name e.g. 'aivena', 'e9n.dev'" })),
			projectId: Type.Optional(Type.String({ description: "Project identifier for claim operations" })),
			repo: Type.Optional(Type.String({ description: "Git repo URL" })),
			leaseDurationSeconds: Type.Optional(Type.Number({
				description: "Lease duration in seconds for claim/heartbeat (default 900, min 1, max 86400)",
				minimum: 1,
				maximum: 86_400,
				default: 900,
			})),
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

				case "claim": {
					if (!hubAgentId) return txt("❌ No hub agent ID yet. Register with the hub first.");
					try {
						const result = await claimHubTask({
							agentId: hubAgentId,
							instanceId: hubInstanceId,
							taskId: params.taskId,
							projectId: params.projectId ?? params.project,
							leaseDurationSeconds: params.leaseDurationSeconds,
						}, hubConfig, log);
						if (!result.claimed || !result.task) {
							return txt("No eligible task could be claimed.");
						}
						const lease = result.task.leaseExpiresAt ? `\n**Lease:** ${result.task.leaseExpiresAt}` : "";
						return txt(`✅ Claimed\n**ID:** ${result.task.id}\n**Title:** ${result.task.title}\n**Project:** ${result.task.project ?? result.task.projectId ?? "—"}${lease}`);
					} catch (err) {
						if (err instanceof HubRpcError) {
							return txt(`❌ Claim failed (${err.code}): ${err.message}`);
						}
						throw err;
					}
				}

				case "heartbeat": {
					if (!hubAgentId) return txt("❌ No hub agent ID yet. Register with the hub first.");
					if (!params.taskId) return txt("❌ taskId required.");
					try {
						const result = await heartbeatHubTask({
							agentId: hubAgentId,
							instanceId: hubInstanceId,
							taskId: params.taskId,
							leaseDurationSeconds: params.leaseDurationSeconds,
						}, hubConfig, log);
						const lease = result.task.leaseExpiresAt ? `\n**Lease:** ${result.task.leaseExpiresAt}` : "";
						return txt(`✅ Lease renewed\n**ID:** ${result.task.id}\n**Title:** ${result.task.title}${lease}`);
					} catch (err) {
						if (err instanceof HubRpcError) {
							return txt(`❌ Heartbeat failed (${err.code}): ${err.message}`);
						}
						throw err;
					}
				}

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
							lines.push(`- **${t.id?.slice(0, 8) ?? '?'}…** ${t.title} [${t.priority}]${ext}${agent}${pr}`);
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
						lines.push(`- **${t.id?.slice(0, 8) ?? '?'}…** \`${t.state}\` [${t.priority}] ${t.title}${ext}${agent}`);
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
					return txt("Unknown action. Use: board, list, get, create, update, transition, claim, heartbeat, delete, history, report");
			}
		},
	});


	// ── Orchestrator (Smart Routing) ───────────────────────────────────────────

	pi.registerTool({
		name: "orchestrator_select_agent",
		label: "Orchestrator Select Agent",
		description:
			"Select the best agent for a task using skill-weighted, workload-first, round-robin, or historical strategy. " +
			"Returns the selected agent ID. Use this before dispatching tasks to remote agents.",
		parameters: Type.Object({
			projectId: Type.String({ description: "Project name for scoping agent eligibility" }),
			taskTags: Type.Optional(Type.Array(Type.String(), { description: "Task tags for skill matching" })),
			taskType: Type.Optional(Type.String({ description: "Task type for skill matching" })),
			strategy: Type.Optional(Type.Union([
				Type.Literal("skill-weighted"),
				Type.Literal("workload-first"),
				Type.Literal("round-robin"),
				Type.Literal("historical"),
			], { description: "Selection strategy (default: skill-weighted)" })),
			eligibleAgentIds: Type.Optional(Type.Array(Type.String(), { description: "Restrict selection to specific agents" })),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;

			if (!hubConfig?.apiKey) {
				return txt("❌ No A2A Hub configured. Set `pi-a2a.hub.url` and `pi-a2a.hub.apiKey` in settings.json.");
			}

			const result = await selectAgent(params, hubConfig, log);
			if (!result) {
				return txt("❌ Failed to select agent — check hub connection and project configuration.");
			}

			return txt(`✅ Selected agent: **${result.agentId}**\nProject: ${params.projectId}\nStrategy: ${params.strategy ?? "skill-weighted (default)"}`);
		},
	});

	pi.registerTool({
		name: "orchestrator_list_strategies",
		label: "Orchestrator List Strategies",
		description:
			"List available agent selection strategies with their descriptions and scoring weights. " +
			"Use this to understand which strategy is best for your use case.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;

			if (!hubConfig?.apiKey) {
				return txt("❌ No A2A Hub configured. Set `pi-a2a.hub.url` and `pi-a2a.hub.apiKey` in settings.json.");
			}

			const strategies = await listStrategies(hubConfig, log);
			if (!strategies || strategies.length === 0) {
				return txt("❌ Failed to fetch strategies or none available.");
			}

			const lines = ["# Agent Selection Strategies\n"];
			for (const s of strategies) {
				lines.push(`## ${s.name}`);
				lines.push(s.description);
				if (s.weights) {
					const weights = Object.entries(s.weights)
						.map(([k, v]) => `${k}: ${v * 100}%`)
						.join(", ");
					lines.push(`**Weights:** ${weights}\n`);
				}
				lines.push("");
			}
			return txt(lines.join("\n"));
		},
	});

	// ── Projects (Project Settings) ───────────────────────────────────────────

	pi.registerTool({
		name: "projects_get",
		label: "Projects Get",
		description:
			"Get project settings including orchestrator config, auto-approve policy, and eligible agents. " +
			"Returns full project configuration for the specified project name.",
		parameters: Type.Object({
			project: Type.String({ description: "Project name (e.g. 'aivena', 'e9n.dev')" }),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;

			if (!hubConfig?.apiKey) {
				return txt("❌ No A2A Hub configured. Set `pi-a2a.hub.url` and `pi-a2a.hub.apiKey` in settings.json.");
			}

			const result = await getProject(params, hubConfig, log);
			if (!result) {
				return txt(`❌ Project not found: ${params.project}`);
			}

			const lines = [
				`# Project: ${result.project}`,
				result.displayName ? `**Display Name:** ${result.displayName}` : "",
				`**Auto Approve:** ${result.autoApprove ? "✓ Enabled" : "✗ Disabled"}`,
				`**Input Policy:** ${result.inputRequiredPolicy ?? "block"}`,
				"",
				"## Orchestrator Config",
				`**Max Concurrent:** ${result.maxConcurrent ?? 10}`,
				`**Stall Timeout:** ${result.stallTimeoutMs ?? 300000}ms (${(result.stallTimeoutMs ?? 300000) / 1000 / 60}m)`,
				`**Turn Timeout:** ${result.turnTimeoutMs ?? 3600000}ms (${(result.turnTimeoutMs ?? 3600000) / 1000 / 60 / 60}h)`,
				`**Max Retry Backoff:** ${result.maxRetryBackoffMs ?? 300000}ms (${(result.maxRetryBackoffMs ?? 300000) / 60000}m)`,
				`**Poll Interval:** ${result.pollIntervalMs ?? 30000}ms (${(result.pollIntervalMs ?? 30000) / 1000}s)`,
				result.eligibleAgents && result.eligibleAgents.length > 0
					? `\n**Eligible Agents:** ${result.eligibleAgents.join(", ")}`
					: "\n**Eligible Agents:** All agents",
				"",
				`**Created:** ${result.createdAt}`,
				`**Updated:** ${result.updatedAt}`,
			].filter(Boolean);
			return txt(lines.join("\n"));
		},
	});

	pi.registerTool({
		name: "projects_list",
		label: "Projects List",
		description:
			"List all projects with their settings. Supports pagination via page and limit parameters.",
		parameters: Type.Object({
			page: Type.Optional(Type.Number({ description: "Page number (default: 1)" })),
			limit: Type.Optional(Type.Number({ description: "Results per page (default: 20)" })),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;

			if (!hubConfig?.apiKey) {
				return txt("❌ No A2A Hub configured. Set `pi-a2a.hub.url` and `pi-a2a.hub.apiKey` in settings.json.");
			}

			const result = await listProjects(params, hubConfig, log);
			if (!result || result.projects.length === 0) {
				return txt("No projects found.");
			}

			const lines = [`# Projects (${result.total} total, page ${result.page})\n`];
			for (const p of result.projects) {
				const agents = p.eligibleAgents?.length ?? 0;
				lines.push(`- **${p.project}**${p.displayName ? ` (${p.displayName})` : ""}`);
				lines.push(`  Auto-approve: ${p.autoApprove ? "✓" : "✗"} | Max concurrent: ${p.maxConcurrent ?? 10} | Eligible agents: ${agents || "all"}`);
			}
			if (result.limit > 0 && result.total > result.page * result.limit) {
				lines.push(`\n_${result.total - result.page * result.limit} more — use page param to paginate_`);
			}
			return txt(lines.join("\n"));
		},
	});

	pi.registerTool({
		name: "projects_create",
		label: "Projects Create",
		description:
			"Create a new project with custom orchestrator settings, auto-approve policy, and eligible agents. " +
			"All settings are optional — omit to use defaults.",
		parameters: Type.Object({
			project: Type.String({ description: "Project name (e.g. 'aivena', 'e9n.dev')" }),
			displayName: Type.Optional(Type.String({ description: "Display name for UI" })),
			maxConcurrent: Type.Optional(Type.Number({ description: "Max concurrent tasks (default: 10)" })),
			stallTimeoutMs: Type.Optional(Type.Number({ description: "Stall timeout in ms (default: 300000 = 5m)" })),
			turnTimeoutMs: Type.Optional(Type.Number({ description: "Turn timeout in ms (default: 3600000 = 1h)" })),
			maxRetryBackoffMs: Type.Optional(Type.Number({ description: "Max retry backoff in ms (default: 300000 = 5m)" })),
			pollIntervalMs: Type.Optional(Type.Number({ description: "Poll interval in ms (default: 30000 = 30s)" })),
			autoApprove: Type.Optional(Type.Boolean({ description: "Auto-approve tasks (default: false)" })),
			inputRequiredPolicy: Type.Optional(Type.Union([Type.Literal("block"), Type.Literal("ask")], { description: "Input policy (default: block)" })),
			eligibleAgents: Type.Optional(Type.Array(Type.String(), { description: "Restrict to specific agent IDs" })),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;

			if (!hubConfig?.apiKey) {
				return txt("❌ No A2A Hub configured. Set `pi-a2a.hub.url` and `pi-a2a.hub.apiKey` in settings.json.");
			}

			const result = await createProject(params, hubConfig, log);
			if (!result) {
				return txt(`❌ Failed to create project: ${params.project}`);
			}

			return txt(`✅ Created project: **${result.project}**${result.displayName ? ` (${result.displayName})` : ""}\nAuto-approve: ${result.autoApprove ? "✓" : "✗"}\nMax concurrent: ${result.maxConcurrent ?? 10}`);
		},
	});

	pi.registerTool({
		name: "projects_update",
		label: "Projects Update",
		description:
			"Update project settings. Only specified fields are updated — omit fields to preserve current values. " +
			"Use projects_get first to see current settings.",
		parameters: Type.Object({
			project: Type.String({ description: "Project name (e.g. 'aivena', 'e9n.dev')" }),
			displayName: Type.Optional(Type.String({ description: "Display name for UI" })),
			maxConcurrent: Type.Optional(Type.Number({ description: "Max concurrent tasks" })),
			stallTimeoutMs: Type.Optional(Type.Number({ description: "Stall timeout in ms" })),
			turnTimeoutMs: Type.Optional(Type.Number({ description: "Turn timeout in ms" })),
			maxRetryBackoffMs: Type.Optional(Type.Number({ description: "Max retry backoff in ms" })),
			pollIntervalMs: Type.Optional(Type.Number({ description: "Poll interval in ms" })),
			autoApprove: Type.Optional(Type.Boolean({ description: "Auto-approve tasks" })),
			inputRequiredPolicy: Type.Optional(Type.Union([Type.Literal("block"), Type.Literal("ask")], { description: "Input policy" })),
			eligibleAgents: Type.Optional(Type.Array(Type.String(), { description: "Restrict to specific agent IDs" })),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;

			if (!hubConfig?.apiKey) {
				return txt("❌ No A2A Hub configured. Set `pi-a2a.hub.url` and `pi-a2a.hub.apiKey` in settings.json.");
			}

			const result = await updateProject(params, hubConfig, log);
			if (!result) {
				return txt(`❌ Failed to update project: ${params.project}`);
			}

			return txt(`✅ Updated project: **${result.project}**${result.displayName ? ` (${result.displayName})` : ""}\nAuto-approve: ${result.autoApprove ? "✓" : "✗"}\nMax concurrent: ${result.maxConcurrent ?? 10}`);
		},
	});


	pi.registerTool({
		name: "pipeline_stream_subscribe",
		label: "Pipeline Stream Subscribe",
		description:
			"Subscribe to real-time pipeline task state changes via Server-Sent Events (SSE). " +
			"Receive instant notifications when tasks transition between states (queued→planning→building→reviewing→pr_ready). " +
			"Call without filters to subscribe to all events, or provide project/agent/state filters. " +
			"Returns a subscription ID — use pipeline_stream_unsubscribe to stop receiving events.",
		parameters: Type.Object({
			project: Type.Optional(Type.String({ description: "Filter to specific project (e.g. 'aivena', 'e9n.dev')" })),
			assignedAgentId: Type.Optional(Type.String({ description: "Filter to tasks assigned to specific agent" })),
			states: Type.Optional(Type.Array(Type.String(), {
				description: "Filter to specific target states (queued, planning, building, reviewing, pr_ready, blocked)",
			})),
		}),
		async execute(_toolCallId, params) {
			const { config } = loadConfig(cwd);
			const hubConfig = config.hub;

			if (!hubConfig?.apiKey) {
				return txt("❌ No A2A Hub configured. Set `pi-a2a.hub.url` and `pi-a2a.hub.apiKey` in settings.json.");
			}

			const { url } = await connectToPipelineStream(params, hubConfig);
			const subscriptionId = `sse-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

			// Event handler: notify user via TUI
			const handleEvent = (event: PipelineStreamEvent) => {
				const { data } = event;
				const emoji: Record<string, string> = {
					queued: "📋", planning: "📐", building: "🔨",
					reviewing: "👀", pr_ready: "🚀", blocked: "🚧",
					approved: "✅", cancelled: "❌",
				};
				const icon = emoji[data.toState] ?? "📝";
				const agent = data.assignedAgentId ? ` → agent:${data.assignedAgentId.slice(0, 8)}…` : "";
				const ext = data.externalTaskId ? ` [${data.externalTaskId}]` : "";
				const pr = data.prUrl ? ` PR#${data.prNumber}` : "";

				const message = `${icon} **${data.title}**${ext}\n` +
					`State: ${data.fromState ?? "(new)"} → **${data.toState}**${agent}${pr}\n` +
					`Project: ${data.project} | Priority: ${data.priority}`;

				sessionCtx?.ui.notify(message, "info");
			};

			try {
				const { abort } = await listenToSSEStream(url, handleEvent, log, hubConfig.apiKey);
				sseConnections.set(subscriptionId, { abort });

				const filters = [];
				if (params.project) filters.push(`project=${params.project}`);
				if (params.assignedAgentId) filters.push(`agent=${params.assignedAgentId}`);
				if (params.states?.length) filters.push(`states=${params.states.join(",")}`);
				const filterStr = filters.length > 0 ? ` (${filters.join(", ")})` : " (all events)";

				return txt(`✅ Subscribed to pipeline stream${filterStr}\n**Subscription ID:** ${subscriptionId}\n\nYou will receive real-time notifications when tasks change state.\nUse /tool pipeline_stream_unsubscribe subscriptionId=${subscriptionId} to stop.`);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return txt(`❌ Failed to subscribe: ${msg}`);
			}
		},
	});

	pi.registerTool({
		name: "pipeline_stream_unsubscribe",
		label: "Pipeline Stream Unsubscribe",
		description:
			"Stop receiving real-time pipeline events from a previous subscription. " +
			"Use the subscription ID returned from pipeline_stream_subscribe.",
		parameters: Type.Object({
			subscriptionId: Type.String({ description: "Subscription ID from pipeline_stream_subscribe" }),
		}),
		async execute(_toolCallId, params) {
			const conn = sseConnections.get(params.subscriptionId);
			if (!conn) {
				return txt(`❌ Subscription not found: ${params.subscriptionId}`);
			}

			conn.abort();
			sseConnections.delete(params.subscriptionId);
			return txt(`✅ Unsubscribed from pipeline stream: ${params.subscriptionId}`);
		},
	});

	pi.registerTool({
		name: "pipeline_stream_status",
		label: "Pipeline Stream Status",
		description:
			"Show active SSE subscriptions and their connection status.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params) {
			if (sseConnections.size === 0) {
				return txt("No active SSE subscriptions.\nUse /tool pipeline_stream_subscribe to start receiving real-time updates.");
			}

			const lines = [`# Active SSE Subscriptions (${sseConnections.size})\n`];
			for (const [id, conn] of sseConnections.entries()) {
				lines.push(`- **${id}** — Subscribed (stream active)`);
			}
			return txt(lines.join("\n"));
		},
	});

}
