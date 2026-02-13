/**
 * pi-jobs — Event listeners that auto-record agent runs.
 *
 * Hooks into pi lifecycle events (turn_start, turn_end, tool_call, tool_result)
 * to track runs. Also listens for subagent:complete, heartbeat:result,
 * and cron:job_complete events from other extensions.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getJobsStore, isStoreReady } from "./store.ts";

interface TrackerState {
	currentJobId: string | null;
	currentModel: string;
	currentProvider: string;
	turnCount: number;
	toolCallCount: number;
	startTime: number;
	toolStartTimes: Map<string, number>;
}

export function registerTracker(pi: ExtensionAPI): void {
	const state: TrackerState = {
		currentJobId: null,
		currentModel: "",
		currentProvider: "",
		turnCount: 0,
		toolCallCount: 0,
		startTime: 0,
		toolStartTimes: new Map(),
	};

	// ── Model tracking ──────────────────────────────────────

	pi.on("model_select", async (event) => {
		state.currentProvider = event.model.provider;
		state.currentModel = event.model.id;
	});

	// ── Turn tracking (one turn = one model call) ───────────

	pi.on("turn_start", async (event) => {
		if (!isStoreReady()) return;
		const store = getJobsStore();

		// First turn of a new run — create a job
		if (event.turnIndex === 0) {
			// Extract prompt from the user message
			const prompt = extractPrompt(event);
			const jobId = await store.createJob({
				channel: "tui",
				prompt: prompt.slice(0, 50_000),
				model: state.currentModel || undefined,
				provider: state.currentProvider || undefined,
			});
			await store.markJobRunning(jobId);
			state.currentJobId = jobId;
			state.turnCount = 0;
			state.toolCallCount = 0;
			state.startTime = Date.now();
			state.toolStartTimes.clear();

			pi.events.emit("jobs:recorded", { jobId, type: "start" });
		}
	});

	pi.on("turn_end", async (event) => {
		state.turnCount++;

		// If this is the final turn (no tool calls pending), complete the job
		const hasToolUse = event.toolResults && event.toolResults.length > 0;
		if (!hasToolUse && state.currentJobId && isStoreReady()) {
			const store = getJobsStore();
			const durationMs = Date.now() - state.startTime;

			// Extract usage from the event if available
			const usage = extractUsage(event);

			await store.completeJob(state.currentJobId, {
				response: extractResponse(event).slice(0, 50_000),
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				cacheReadTokens: usage.cacheReadTokens,
				cacheWriteTokens: usage.cacheWriteTokens,
				totalTokens: usage.totalTokens,
				costInput: usage.costInput,
				costOutput: usage.costOutput,
				costCacheRead: usage.costCacheRead,
				costCacheWrite: usage.costCacheWrite,
				costTotal: usage.costTotal,
				toolCallCount: state.toolCallCount,
				turnCount: state.turnCount,
				durationMs,
			});

			pi.events.emit("jobs:recorded", { jobId: state.currentJobId, type: "complete" });
			state.currentJobId = null;
		}
	});

	// ── Tool call tracking ──────────────────────────────────

	pi.on("tool_call", async (event) => {
		if (!state.currentJobId) return;
		state.toolStartTimes.set(event.toolCallId, Date.now());
		state.toolCallCount++;
	});

	pi.on("tool_result", async (event) => {
		if (!state.currentJobId || !isStoreReady()) return;
		const store = getJobsStore();
		const startTs = state.toolStartTimes.get(event.toolCallId) ?? Date.now();
		state.toolStartTimes.delete(event.toolCallId);
		const durationMs = Date.now() - startTs;

		await store.recordToolCall({
			jobId: state.currentJobId,
			toolName: event.toolName,
			isError: !!event.isError,
			durationMs,
		});
	});

	// ── External extension events ───────────────────────────

	// Track subagent runs
	pi.events.on("subagent:complete", async (data: any) => {
		try {
			if (!isStoreReady()) return;
			const store = getJobsStore();
			const jobId = await store.createJob({
				channel: "subagent",
				prompt: (data.task ?? "subagent run").slice(0, 50_000),
				model: data.model ?? undefined,
				provider: data.provider ?? undefined,
			});
			await store.markJobRunning(jobId);

			if (data.status === "done") {
				await store.completeJob(jobId, {
					response: (data.response ?? "").slice(0, 50_000),
					totalTokens: data.tokens ?? 0,
					costTotal: data.cost ?? 0,
					durationMs: data.durationMs ?? 0,
					toolCallCount: data.toolCallCount ?? 0,
					turnCount: data.turnCount ?? 0,
				});
			} else {
				await store.failJob(jobId, data.error ?? "Unknown error", data.durationMs);
			}
		} catch { /* Telemetry must never break the agent */ }
	});

	// Track heartbeat runs
	pi.events.on("heartbeat:result", async (data: any) => {
		try {
			if (!isStoreReady()) return;
			const store = getJobsStore();
			const jobId = await store.createJob({
				channel: "heartbeat",
				prompt: "(heartbeat check)",
				model: "subprocess",
			});
			await store.markJobRunning(jobId);
			await store.completeJob(jobId, {
				response: (data.response ?? "").slice(0, 50_000),
				durationMs: data.durationMs ?? 0,
			});
		} catch { /* Telemetry must never break the agent */ }
	});

	// Track cron job runs
	pi.events.on("cron:job_complete", async (data: any) => {
		try {
			if (!isStoreReady()) return;
			const store = getJobsStore();
			const jobId = await store.createJob({
				channel: "cron",
				prompt: (data.job?.prompt ?? "cron job").slice(0, 50_000),
			});
			await store.markJobRunning(jobId);

			if (data.ok) {
				await store.completeJob(jobId, {
					response: (data.response ?? "").slice(0, 50_000),
					durationMs: data.durationMs ?? 0,
				});
			} else {
				await store.failJob(jobId, data.error ?? "Unknown error", data.durationMs);
			}
		} catch { /* Telemetry must never break the agent */ }
	});
}

// ── Helpers ─────────────────────────────────────────────────────

function extractPrompt(event: any): string {
	if (event.userMessage?.content) {
		if (typeof event.userMessage.content === "string") return event.userMessage.content;
		if (Array.isArray(event.userMessage.content)) {
			return event.userMessage.content
				.filter((b: any) => b.type === "text")
				.map((b: any) => b.text)
				.join("\n");
		}
	}
	return "(unknown prompt)";
}

function extractResponse(event: any): string {
	if (event.assistantMessage?.content) {
		if (typeof event.assistantMessage.content === "string") return event.assistantMessage.content;
		if (Array.isArray(event.assistantMessage.content)) {
			return event.assistantMessage.content
				.filter((b: any) => b.type === "text")
				.map((b: any) => b.text)
				.join("\n");
		}
	}
	return "";
}

function extractUsage(event: any): {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	costInput: number;
	costOutput: number;
	costCacheRead: number;
	costCacheWrite: number;
	costTotal: number;
} {
	const u = event.usage ?? event.assistantMessage?.usage ?? {};
	const cost = u.cost ?? {};
	return {
		inputTokens: u.input ?? u.inputTokens ?? 0,
		outputTokens: u.output ?? u.outputTokens ?? 0,
		cacheReadTokens: u.cacheRead ?? u.cacheReadTokens ?? 0,
		cacheWriteTokens: u.cacheWrite ?? u.cacheWriteTokens ?? 0,
		totalTokens: (u.input ?? u.inputTokens ?? 0) + (u.output ?? u.outputTokens ?? 0),
		costInput: cost.input ?? 0,
		costOutput: cost.output ?? 0,
		costCacheRead: cost.cacheRead ?? 0,
		costCacheWrite: cost.cacheWrite ?? 0,
		costTotal: (cost.input ?? 0) + (cost.output ?? 0) + (cost.cacheRead ?? 0) + (cost.cacheWrite ?? 0),
	};
}
