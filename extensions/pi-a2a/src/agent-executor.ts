/**
 * pi-a2a — Agent executor that delegates to the main agent process.
 *
 * Instead of spawning isolated subprocesses, incoming A2A messages are
 * injected into the main pi conversation via a callback. This gives full
 * TUI visibility — tool calls, file edits, thinking — all visible in
 * the chat, just like normal user messages.
 *
 * Task lifecycle:
 *   1. Publish initial Task (state: submitted) if new
 *   2. Publish status-update (state: working) + finish event bus → HTTP response
 *   3. Delegate to main agent process via processMessage callback (background)
 *   4. On completion: update task in TaskStore with artifact + completed/failed status
 *   5. Callers retrieve results via tasks/get polling or SSE resubscribe
 *
 * This eliminates the old onAsyncResult→sendA2AMessage pattern that caused
 * bidirectional infinite loops (A→B→A→B...). Results are now stored in the
 * task store and retrieved through the A2A protocol's native task lifecycle.
 *
 * Concurrency: max 1 (blocks — the main agent handles one request at a
 * time). Additional requests are queued and processed in arrival order.
 * Run more pi instances for parallel A2A processing.
 */

import { randomUUID } from "node:crypto";
import type { AgentExecutor, ExecutionEventBus, RequestContext, TaskStore } from "@a2a-js/sdk/server";
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
	private taskStore: TaskStore;
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

	constructor(log: LogFn, processMessage: ProcessMessage, taskStore: TaskStore) {
		this.log = log;
		this.processMessage = processMessage;
		this.taskStore = taskStore;
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

		// Extract sender identity for logging
		const senderMeta = (userMessage.metadata as Record<string, unknown> | undefined)?.["pi:sender"] as
			| { name?: string; description?: string }
			| undefined;
		const senderName = senderMeta?.name ?? "Unknown agent";

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
			releaseQueue!();
			return;
		}

		const prompt = textSegments.join("\n");
		this.activeTaskId = taskId;
		this.log("executor_start", { taskId, sender: senderName, promptLength: prompt.length });

		// ── ACK immediately: publish "working" and finish the event bus ──
		// This unblocks the HTTP response so the sender gets a Task with
		// state: "working" right away instead of waiting for the agent to
		// finish (which can take minutes and causes timeout).
		eventBus.publish({
			kind: "status-update",
			taskId,
			contextId,
			status: {
				state: "working",
				message: {
					kind: "message",
					messageId: randomUUID(),
					role: "agent",
					parts: [{ kind: "text", text: "Message received, working on it…" } as Part],
				},
				timestamp: new Date().toISOString(),
			},
			final: true,
		} as TaskStatusUpdateEvent);
		eventBus.finished();

		// ── Process in the background ──────────────────────────────
		// The HTTP response has already been sent with "working" status.
		// When the agent finishes, the result is saved to the TaskStore.
		// Callers retrieve it via tasks/get polling or SSE resubscribe.
		this.processInBackground(taskId, contextId, prompt, senderName, releaseQueue!).catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			this.log("executor_bg_error", { taskId, error: msg }, "ERROR");
		});
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

	/**
	 * Process a task in the background after the HTTP ACK has been sent.
	 *
	 * When the agent finishes, updates the task in the TaskStore with the
	 * result artifact and final status (completed/failed). Callers retrieve
	 * results via tasks/get polling or SSE resubscribe — no new A2A message
	 * is sent back, eliminating bidirectional loops.
	 */
	private async processInBackground(
		taskId: string,
		contextId: string,
		prompt: string,
		senderName: string,
		releaseQueue: () => void,
	): Promise<void> {
		try {
			const result = await this.processMessage(prompt, senderName);

			// Check if canceled while processing
			if (this.activeTaskId !== taskId) {
				this.log("executor_canceled_during_run", { taskId });
				return;
			}

			this.activeTaskId = null;

			// Record telemetry
			this.lastTaskDurationMs = result.durationMs;
			this.lastTaskStatus = result.ok ? "completed" : "failed";
			this.onTaskFinished?.();

			if (result.ok) {
				this.log("executor_completed", { taskId, responseLength: result.response.length, durationMs: result.durationMs });
			} else {
				this.log("executor_failed", { taskId, error: result.error ?? "Unknown", durationMs: result.durationMs }, "ERROR");
			}

			// Update the task in the store — callers poll via tasks/get
			await this.saveTaskResult(taskId, contextId, result);
		} catch (err: unknown) {
			this.activeTaskId = null;
			const msg = err instanceof Error ? err.message : String(err);
			this.log("executor_error", { taskId, error: msg }, "ERROR");

			this.lastTaskDurationMs = undefined;
			this.lastTaskStatus = "failed";
			this.onTaskFinished?.();

			// Save failure to the store so callers can see the error
			await this.saveTaskResult(taskId, contextId, {
				ok: false,
				response: "",
				error: msg,
				durationMs: 0,
			});
		} finally {
			releaseQueue();
		}
	}

	/**
	 * Save the completed/failed task result to the TaskStore.
	 *
	 * Loads the existing task (saved by the SDK during the "working" ACK phase),
	 * updates it with the result artifact and final status, and saves it back.
	 * If the task isn't found (shouldn't happen), constructs a minimal one.
	 */
	private async saveTaskResult(
		taskId: string,
		contextId: string,
		result: ProcessResult,
	): Promise<void> {
		try {
			const existing = await this.taskStore.load(taskId);
			const now = new Date().toISOString();

			const statusMessage = {
				kind: "message" as const,
				messageId: randomUUID(),
				role: "agent" as const,
				parts: [{
					kind: "text" as const,
					text: result.ok
						? result.response
						: `Error: ${result.error ?? "Unknown error"}`,
				} as Part],
			};

			const updatedTask: Task = {
				kind: "task",
				id: taskId,
				contextId,
				// Preserve history from the existing task
				...(existing?.history ? { history: existing.history } : {}),
				// Preserve existing metadata
				...(existing?.metadata ? { metadata: existing.metadata } : {}),
				status: {
					state: result.ok ? "completed" : "failed",
					message: statusMessage,
					timestamp: now,
				},
				// Add artifact with response on success
				...(result.ok ? {
					artifacts: [{
						artifactId: randomUUID(),
						name: "response",
						parts: [{ kind: "text" as const, text: result.response } as Part],
					}],
				} : {}),
			};

			await this.taskStore.save(updatedTask);
			this.log("task_result_saved", {
				taskId,
				state: result.ok ? "completed" : "failed",
				hadExisting: !!existing,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.log("task_result_save_error", { taskId, error: msg }, "ERROR");
		}
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
