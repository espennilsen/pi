/**
 * pi-a2a — Agent executor that delegates to the main agent process.
 *
 * Instead of spawning isolated subprocesses, incoming A2A messages are
 * injected into the main pi conversation via a callback. This gives full
 * TUI visibility — tool calls, file edits, thinking — all visible in
 * the chat, just like normal user messages.
 *
 * Task lifecycle (unchanged from the SDK's perspective):
 *   1. Publish initial Task (state: submitted) if new
 *   2. Publish status-update (state: working)
 *   3. Delegate to main agent process via processMessage callback
 *   4. Publish artifact-update with the response
 *   5. Publish final status-update (state: completed) with final=true
 *   6. Call eventBus.finished()
 *
 * Concurrency: max 1 (blocks — the main agent handles one request at a
 * time). Additional requests are queued and processed in arrival order.
 * Run more pi instances for parallel A2A processing.
 */

import { randomUUID } from "node:crypto";
import type { AgentExecutor, ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import type { Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, Part } from "@a2a-js/sdk";
import type { LogFn } from "./logger.ts";
import type { TelemetrySnapshot } from "./types.ts";

/** Max concurrent tasks (1 for main-process delegation). */
const MAX_CONCURRENT = 1;

/** Result returned by the main agent process. */
export interface ProcessResult {
	ok: boolean;
	response: string;
	error?: string;
	durationMs: number;
}

/**
 * Callback to inject a message into the main agent conversation.
 * Returns a promise that resolves when the agent finishes processing.
 */
export type ProcessMessage = (prompt: string, sender: string) => Promise<ProcessResult>;

export class PiAgentExecutor implements AgentExecutor {
	private log: LogFn;
	private processMessage: ProcessMessage;
	/**
	 * Track the single active task for cancellation.
	 * Note: cancellation only prevents result dispatch — the underlying
	 * agent turn cannot be interrupted mid-execution at this layer.
	 */
	private activeTaskId: string | null = null;
	/** Serializing queue — tasks run one at a time in arrival order. */
	private queue: Promise<void> = Promise.resolve();
	/** Cancel callbacks for queued (not yet active) tasks. */
	private cancelCallbacks = new Map<string, () => void>();
	/** Number of tasks waiting in the queue (not yet active). */
	private _queueDepth = 0;
	/** Last completed/failed task duration for telemetry reporting. */
	private lastTaskDurationMs?: number;
	/** Last completed/failed task status for telemetry reporting. */
	private lastTaskStatus?: "completed" | "failed";
	/** Optional callback invoked after each task completes or fails. */
	onTaskFinished?: () => void;

	constructor(log: LogFn, processMessage: ProcessMessage) {
		this.log = log;
		this.processMessage = processMessage;
	}

	/** Return a snapshot of current telemetry state for hub reporting. */
	getTelemetrySnapshot(): TelemetrySnapshot {
		const snapshot: TelemetrySnapshot = {
			queueDepth: this._queueDepth,
			activeTasks: this.activeTaskId ? 1 : 0,
			maxConcurrent: MAX_CONCURRENT,
		};
		if (this.lastTaskDurationMs !== undefined) {
			snapshot.lastTaskDurationMs = this.lastTaskDurationMs;
		}
		if (this.lastTaskStatus !== undefined) {
			snapshot.lastTaskStatus = this.lastTaskStatus;
		}
		return snapshot;
	}

	/** Abort the active task and cancel all queued tasks. */
	abortAll(): void {
		// Cancel queued tasks first — invoke their cancel callbacks so they
		// see canceled=true when they wake up from `await myTurn`
		for (const [taskId, cancel] of this.cancelCallbacks) {
			cancel();
			this.log("executor_abort_queued", { taskId });
		}
		this.cancelCallbacks.clear();

		if (this.activeTaskId) {
			this.log("executor_abort_all", { taskId: this.activeTaskId });
			this.activeTaskId = null;
		}
	}

	async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
		// Serialize: queue behind any active task, process in arrival order
		let releaseQueue: () => void;
		const myTurn = this.queue;
		this.queue = new Promise<void>((resolve) => { releaseQueue = resolve; });

		// Publish submitted immediately so the caller sees progress
		const { userMessage, taskId, contextId, task } = requestContext;
		if (!task) {
			eventBus.publish({
				kind: "task",
				id: taskId,
				contextId,
				status: { state: "submitted", timestamp: new Date().toISOString() },
				history: [userMessage],
			} as Task);
		}

		// Register cancel callback so queued tasks can be canceled
		let canceled = false;
		this._queueDepth++;
		this.cancelCallbacks.set(taskId, () => { canceled = true; });

		// Wait for preceding tasks to finish
		await myTurn;
		this._queueDepth--;
		this.cancelCallbacks.delete(taskId);

		// If canceled while queued (by abortAll or cancelTask), skip processing.
		// Always call eventBus.finished() to complete the SDK task lifecycle.
		if (canceled) {
			this.log("executor_skip_canceled", { taskId });
			eventBus.finished();
			releaseQueue!();
			return;
		}

		// Extract sender identity
		const senderMeta = (userMessage.metadata as Record<string, unknown> | undefined)?.["pi:sender"] as
			| { name?: string; description?: string }
			| undefined;
		const senderName = senderMeta?.name ?? "Unknown agent";

		try {
			// Extract text from all part types
			const textSegments: string[] = [];
			for (const part of userMessage.parts) {
				if (part.kind === "text") {
					textSegments.push((part as { kind: "text"; text: string }).text);
				} else if (part.kind === "data") {
					const dataPart = part as { kind: "data"; data: Record<string, unknown> };
					textSegments.push(JSON.stringify(dataPart.data, null, 2));
				} else if (part.kind === "file") {
					const file = part.file as { uri?: string; name?: string; bytes?: string };
					if (file?.uri) {
						textSegments.push(`[File: ${file.name ?? file.uri}](${file.uri})`);
					} else if (file?.name) {
						textSegments.push(`[File: ${file.name}]`);
					}
					this.log("executor_file_part", { taskId, uri: file?.uri, name: file?.name });
				} else {
					this.log("executor_unsupported_part", { taskId, kind: (part as { kind: string }).kind }, "WARN");
				}
			}

			if (textSegments.length === 0) {
				this.publishError(taskId, contextId, eventBus, "No processable content in message");
				eventBus.finished();
				return;
			}

			// ── Publish "working" status ──
			eventBus.publish({
				kind: "status-update",
				taskId,
				contextId,
				status: { state: "working", timestamp: new Date().toISOString() },
				final: false,
			} as TaskStatusUpdateEvent);

			const prompt = textSegments.join("\n");
			this.activeTaskId = taskId;
			this.log("executor_start", { taskId, sender: senderName, promptLength: prompt.length });

			// ── Delegate to main agent process ──
			const result = await this.processMessage(prompt, senderName);

			// Check if canceled while processing
			if (this.activeTaskId !== taskId) {
				this.log("executor_canceled_during_run", { taskId });
				eventBus.finished();
				return;
			}

			this.activeTaskId = null;

			if (result.ok) {
				// Publish artifact with response
				eventBus.publish({
					kind: "artifact-update",
					taskId,
					contextId,
					artifact: {
						artifactId: randomUUID(),
						name: "response",
						parts: [{ kind: "text", text: result.response } as Part],
					},
				} as TaskArtifactUpdateEvent);

				// Publish "completed"
				eventBus.publish({
					kind: "status-update",
					taskId,
					contextId,
					status: { state: "completed", timestamp: new Date().toISOString() },
					final: true,
				} as TaskStatusUpdateEvent);
				this.log("executor_completed", { taskId, responseLength: result.response.length, durationMs: result.durationMs });

				// Record telemetry for hub reporting
				this.lastTaskDurationMs = result.durationMs;
				this.lastTaskStatus = "completed";
				this.onTaskFinished?.();
			} else {
				this.publishError(taskId, contextId, eventBus, result.error ?? "Unknown error");
				this.log("executor_failed", { taskId, error: result.error ?? "Unknown", durationMs: result.durationMs }, "ERROR");

				// Record telemetry for hub reporting
				this.lastTaskDurationMs = result.durationMs;
				this.lastTaskStatus = "failed";
				this.onTaskFinished?.();
			}

			eventBus.finished();
		} catch (err: unknown) {
			this.activeTaskId = null;
			const msg = err instanceof Error ? err.message : String(err);
			this.publishError(taskId, contextId, eventBus, msg);
			this.log("executor_error", { taskId, error: msg }, "ERROR");

			// Record telemetry for hub reporting — clear stale duration
			// to avoid pairing a previous task's timing with this failure
			this.lastTaskDurationMs = undefined;
			this.lastTaskStatus = "failed";
			this.onTaskFinished?.();

			eventBus.finished();
		} finally {
			// Release the queue so the next task can proceed
			releaseQueue!();
		}
	}

	async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
		// Check queued tasks first
		const queuedCancel = this.cancelCallbacks.get(taskId);
		if (queuedCancel) {
			queuedCancel();
			this.cancelCallbacks.delete(taskId);
			this.log("executor_cancel_queued", { taskId });
			eventBus.publish({
				kind: "status-update",
				taskId,
				contextId: taskId,
				status: { state: "canceled", timestamp: new Date().toISOString() },
				final: true,
			} as TaskStatusUpdateEvent);
			eventBus.finished();
			return;
		}

		// Active task — mark as canceled so result dispatch is skipped
		if (this.activeTaskId === taskId) {
			this.activeTaskId = null;
			this.log("executor_cancel", { taskId });

			eventBus.publish({
				kind: "status-update",
				taskId,
				contextId: taskId,
				status: { state: "canceled", timestamp: new Date().toISOString() },
				final: true,
			} as TaskStatusUpdateEvent);
			eventBus.finished();
			return;
		}

		// Unknown task — already completed or never existed; don't double-finish
		this.log("executor_cancel_unknown", { taskId }, "WARN");
		eventBus.finished();
	}

	/** Whether the executor is currently processing a task or has queued tasks. */
	isBusy(): boolean {
		return this.activeTaskId !== null || this._queueDepth > 0;
	}

	/** Number of tasks waiting in the queue (not including the active one). */
	queueDepth(): number {
		return this._queueDepth;
	}

	private publishError(taskId: string, contextId: string, eventBus: ExecutionEventBus, error: string): void {
		eventBus.publish({
			kind: "status-update",
			taskId,
			contextId,
			status: {
				state: "failed",
				message: {
					kind: "message",
					messageId: randomUUID(),
					role: "agent",
					parts: [{ kind: "text", text: `Error: ${error}` } as Part],
				},
				timestamp: new Date().toISOString(),
			},
			final: true,
		} as TaskStatusUpdateEvent);
	}
}
