/**
 * pi-a2a — Agent executor that delegates to the main agent process.
 *
 * Instead of spawning isolated subprocesses, incoming A2A messages are
 * injected into the main pi conversation via a callback. This gives full
 * TUI visibility — tool calls, file edits, thinking — all visible in
 * the chat, just like normal user messages.
 *
 * Task lifecycle:
 *   1. Pre-checks: supervisor loop control, content validation
 *   2. Publish initial Task (state: submitted) + status-update (state: working) +
 *      finish event bus → immediate HTTP response (before queue wait)
 *   3. Wait for preceding tasks in the queue (HTTP response already sent)
 *   4. Delegate to main agent process via processMessage callback (background)
 *   5. On completion: update task in TaskStore with artifact + completed/failed status
 *   6. Callers retrieve results via tasks/get polling or SSE resubscribe
 *
 * Multi-turn (input-required) support:
 *   - The a2a_request_input tool calls parkForInput(), which saves the task
 *     as "input-required" and parks the tool's execute() promise.
 *   - When a follow-up message/send arrives with the same taskId, the SDK
 *     calls execute() again. The executor detects the parked resolver,
 *     delivers the follow-up text, ACKs the SDK, and exits.
 *   - The original tool promise resolves with the answer, and the agent
 *     turn continues — full reasoning context preserved.
 *   - Follow-up execute() calls bypass the serial queue to prevent deadlock.
 *
 * This eliminates the old onAsyncResult→sendA2AMessage pattern that caused
 * bidirectional infinite loops (A→B→A→B...). Results are now stored in the
 * task store and retrieved through the A2A protocol's native task lifecycle.
 *
 * Concurrency: max 1 (blocks — the main agent handles one request at a
 * time). Additional requests are queued and processed in arrival order.
 * Run more pi instances for parallel A2A processing.
 *
 * Duplicate-send / re-processing guard:
 *   - If a caller resends the same message while the task is still in
 *     'working' state, the follow-up is queued behind the active task.
 *   - After the first processing completes (task → completed/failed), the
 *     queued follow-up wakes up, detects the terminal state, re-publishes
 *     the existing completed task so the caller gets the result immediately,
 *     and exits without running processMessage again.
 *   - This prevents callers that retry on timeout from triggering duplicate
 *     agent turns and overwriting already-stored results.
 */

import { randomUUID } from "node:crypto";
import type { AgentExecutor, ExecutionEventBus, RequestContext, TaskStore } from "@a2a-js/sdk/server";
import type { Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, Part } from "@a2a-js/sdk";
import type { LogFn } from "./logger.ts";
import type { TelemetrySnapshot, HubConfig } from "./types.ts";
import { sendTaskStateChanged } from "./hub.ts";
import {
	extractLoopMetadata,
	generateTraceId,
	injectLoopMetadata,
	supervise,
	type LoopMetadata,
	type SupervisorConfig,
} from "./supervisor.ts";

/** Max concurrent tasks (1 for main-process delegation). */
const MAX_CONCURRENT = 1;

/** Default timeout for waiting for input-required follow-ups: 10 minutes. */
const DEFAULT_INPUT_REQUIRED_TIMEOUT_MS = 600_000;

/** Default maximum input-required rounds per task. */
const DEFAULT_MAX_INPUT_ROUNDS = 5;

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

/** Default task processing timeout: 10 minutes. */
const DEFAULT_TASK_TIMEOUT_MS = 600_000;

export class PiAgentExecutor implements AgentExecutor {
	private log: LogFn;
	private processMessage: ProcessMessage;
	private taskStore: TaskStore;
	private supervisorConfig: SupervisorConfig;
	/** Timeout for a single task's processMessage call. 0 = no timeout. */
	private taskTimeoutMs: number;
	/** Callback to abort a pending request when timeout occurs. */
	private abortCurrentTask?: (reason: string) => void;
	/**
	 * Track the single active task for cancellation.
	 * Note: cancellation only prevents result dispatch — the underlying
	 * agent turn cannot be interrupted mid-execution at this layer.
	 */
	private activeTaskId: string | null = null;
	/**
	 * Loop metadata for the currently active task (set by supervisor).
	 * Used by the outbound client to propagate loop control on a2a_send
	 * calls made during this task's processing. Null when no active task
	 * or for tasks without loop metadata.
	 */
	private activeLoopMetadata: LoopMetadata | null = null;
	/** Serializing queue — tasks run one at a time in arrival order. */
	private queue: Promise<void> = Promise.resolve();
	/** Cancel callbacks for queued (not yet active) tasks. */
	private cancelCallbacks = new Map<string, () => void>();
	/** Map taskId → contextId for protocol-correct cancel events. */
	private taskContexts = new Map<string, string>();
	/**
	 * Fallback status map for tasks whose final state couldn't be persisted
	 * to the DB (e.g. disk full). Allows tasks/get to return a terminal state
	 * instead of being stuck on "working" forever.
	 */
	private fallbackStatuses = new Map<string, { state: "completed" | "failed" | "canceled"; response: string }>();
	/**
	 * Parked input resolvers — keyed by taskId.
	 * When a2a_request_input parks, the resolver is stored here. When a
	 * follow-up message/send arrives for the same taskId, execute() looks
	 * up the resolver and delivers the follow-up text.
	 */
	private parkedInputResolvers = new Map<string, { resolve: (text: string) => void; reject: (err: Error) => void }>();
	/** Track timeout handles for parked input resolvers (keyed by taskId). */
	private parkedInputTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
	/** Track how many input-required rounds each task has used (keyed by taskId). */
	private inputRoundCounts = new Map<string, number>();
	/** Timeout for waiting for input-required follow-ups. */
	private inputRequiredTimeoutMs: number;
	/** Maximum input-required rounds allowed per task. */
	private maxInputRounds: number;
	/** Hub configuration for push notifications. */
	private hubConfig?: HubConfig;
	/** Registered hub agent ID for push notifications. */
	private hubAgentId?: string;
	/** Number of tasks waiting in the queue (not yet active). */
	private _queueDepth = 0;
	/** Last completed/failed task duration for telemetry reporting. */
	private lastTaskDurationMs?: number;
	/** Last completed/failed task status for telemetry reporting. */
	private lastTaskStatus?: "completed" | "failed";
	/** Optional callback invoked after each task completes or fails (before saving result). */
	onTaskFinished?: () => void;
	/** Optional callback invoked after task result is successfully saved to TaskStore. */
	onTaskResultSaved?: (taskId: string, success: boolean) => void;

	constructor(
		log: LogFn,
		processMessage: ProcessMessage,
		taskStore: TaskStore,
		supervisorConfig: SupervisorConfig,
		taskTimeoutMs?: number,
		inputRequiredTimeoutMs?: number,
		maxInputRounds?: number,
		hubConfig?: HubConfig,
	) {
		this.log = log;
		this.processMessage = processMessage;
		this.taskStore = taskStore;
		this.supervisorConfig = supervisorConfig;
		this.taskTimeoutMs = taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
		this.inputRequiredTimeoutMs = inputRequiredTimeoutMs ?? DEFAULT_INPUT_REQUIRED_TIMEOUT_MS;
		this.maxInputRounds = maxInputRounds ?? DEFAULT_MAX_INPUT_ROUNDS;
		this.hubConfig = hubConfig;
	}

	/** Set the hub agent ID after registration (called from index.ts). */
	setHubAgentId(agentId: string): void {
		this.hubAgentId = agentId;
	}

	/**
	 * Set the callback to abort a pending request when timeout occurs.
	 * This allows the executor to clean up pendingResolve state in the main
	 * index.ts module, preventing queue contamination.
	 */
	setAbortCallback(abort: (reason: string) => void): void {
		this.abortCurrentTask = abort;
	}

	/**
	 * Get the loop metadata for the currently active inbound task.
	 * Returns null if no task is active or the task had no loop metadata.
	 * Used by the outbound client (a2a_send) to propagate loop control.
	 */
	getActiveLoopMetadata(): LoopMetadata | null {
		return this.activeLoopMetadata;
	}

	/**
	 * Get the taskId of the currently active inbound task.
	 * Returns null if no task is active.
	 * Used by a2a_request_input to guard against calls outside A2A context.
	 */
	getActiveTaskId(): string | null {
		return this.activeTaskId;
	}

	/**
	 * Park the current task waiting for follow-up input from the caller.
	 *
	 * Called by the a2a_request_input tool during an active agent turn:
	 *   1. Checks the input-round count against maxInputRounds
	 *   2. Saves the task as "input-required" in the TaskStore with the question
	 *   3. Creates a promise and parks — the tool's execute() awaits this
	 *   4. When a follow-up message/send arrives, execute() resolves the promise
	 *   5. The tool returns the answer, and the agent turn continues
	 *
	 * @param taskId The active task's ID
	 * @param question The question to ask the caller
	 * @param signal AbortSignal for cancellation (Ctrl+C, session restart)
	 * @returns The follow-up text from the caller
	 * @throws If max rounds exceeded, timeout, or abort
	 */
	async parkForInput(taskId: string, question: string, signal?: AbortSignal): Promise<string> {
		// ── Round limit check ───────────────────────────────────────
		const roundCount = (this.inputRoundCounts.get(taskId) ?? 0) + 1;
		if (roundCount > this.maxInputRounds) {
			throw new Error(
				`Input-required round limit exceeded: ${roundCount} > ${this.maxInputRounds} (max). ` +
				`Provide the information needed or rephrase the original request.`,
			);
		}
		this.inputRoundCounts.set(taskId, roundCount);

		this.log("park_for_input", { taskId, question: question.slice(0, 200), round: roundCount });

		// ── Save task as input-required ─────────────────────────────
		const contextId = this.taskContexts.get(taskId) ?? taskId;
		const now = new Date().toISOString();
		const existing = await this.taskStore.load(taskId);

		const inputRequiredTask: Task = {
			kind: "task",
			id: taskId,
			contextId,
			...(existing?.history ? { history: existing.history } : {}),
			...(existing?.metadata ? { metadata: existing.metadata } : {}),
			status: {
				state: "input-required",
				message: {
					kind: "message",
					messageId: randomUUID(),
					role: "agent",
					parts: [{ kind: "text", text: question } as Part],
				},
				timestamp: now,
			},
		};
		await this.taskStore.save(inputRequiredTask);

		// ── Park: create promise and wait for follow-up ─────────────
		return new Promise<string>((resolve, reject) => {
			// Abort handler (Ctrl+C, session restart)
			const onAbort = () => {
				if (timeoutId) {
					clearTimeout(timeoutId);
					this.parkedInputTimeouts.delete(taskId);
				}
				this.parkedInputResolvers.delete(taskId);
				reject(new Error("Input-required aborted"));
			};

			// Timeout handler
			const timeoutId = this.inputRequiredTimeoutMs > 0
				? setTimeout(() => {
					signal?.removeEventListener("abort", onAbort);
					this.parkedInputTimeouts.delete(taskId);
					this.parkedInputResolvers.delete(taskId);
					reject(new Error(
						`Input-required timeout: caller did not respond within ${this.inputRequiredTimeoutMs}ms`,
					));
				}, this.inputRequiredTimeoutMs)
				: null;
			
			// Track the timeout handle so abortAll() can clear it
			if (timeoutId) this.parkedInputTimeouts.set(taskId, timeoutId);

			signal?.addEventListener("abort", onAbort, { once: true });

			// Store resolver + reject — execute() calls resolve on follow-up,
			// cancelTask() calls reject to unblock processInBackground.
			this.parkedInputResolvers.set(taskId, {
				resolve: (text: string) => {
					if (timeoutId) {
						clearTimeout(timeoutId);
						this.parkedInputTimeouts.delete(taskId);
					}
					signal?.removeEventListener("abort", onAbort);
					this.parkedInputResolvers.delete(taskId);
					resolve(text);
				},
				reject: (err: Error) => {
					if (timeoutId) {
						clearTimeout(timeoutId);
						this.parkedInputTimeouts.delete(taskId);
					}
					signal?.removeEventListener("abort", onAbort);
					this.parkedInputResolvers.delete(taskId);
					reject(err);
				},
			});
		});
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
		this.taskContexts.clear();
		this.fallbackStatuses.clear();

		// Clear parked input resolvers — the parked promises will reject
		// when their AbortSignal fires (session restart triggers abort)
		// Clear all parked input timeout handles
		for (const timeoutId of this.parkedInputTimeouts.values()) {
			clearTimeout(timeoutId);
		}
		this.parkedInputTimeouts.clear();
		this.parkedInputResolvers.clear();
		this.inputRoundCounts.clear();

		if (this.activeTaskId) {
			this.log("executor_abort_all", { taskId: this.activeTaskId });
			this.activeTaskId = null;
			this.activeLoopMetadata = null;
		}
	}

	async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
		const { userMessage, taskId, contextId, task } = requestContext;

		// ── Follow-up for input-required: bypass queue and deliver ───
		// When a2a_request_input has parked a task waiting for input, a
		// follow-up message/send arrives with the same taskId. The SDK
		// calls execute() again — we detect the parked resolver, deliver
		// the follow-up text, ACK the caller, and exit. The original
		// processMessage continues (the tool promise resolves).
		// This MUST bypass the serial queue — otherwise deadlock.
		const parkedResolver = this.parkedInputResolvers.get(taskId);
		if (parkedResolver) {
			// Extract text from the follow-up message
			const textParts: string[] = [];
			for (const part of userMessage.parts) {
				if (part.kind === "text") {
					textParts.push((part as { kind: "text"; text: string }).text);
				}
			}
			const MAX_FOLLOWUP_LENGTH = 100_000;
			let followUpText = textParts.join("\n") || "(empty response)";
			if (followUpText.length > MAX_FOLLOWUP_LENGTH) {
				followUpText = followUpText.slice(0, MAX_FOLLOWUP_LENGTH) + "\n\n[truncated]";
			}

			this.log("input_followup_delivered", { taskId, textLength: followUpText.length });

			// Resolve the parked promise — a2a_request_input returns the answer
			parkedResolver.resolve(followUpText);

			// ACK the caller: publish "working" (resumed) and finish
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
						parts: [{ kind: "text", text: "Input received, resuming…" } as Part],
					},
					timestamp: new Date().toISOString(),
				},
				final: true,
			} as TaskStatusUpdateEvent);
			eventBus.finished();
			return;
		}


		// ── Pre-ACK: extract metadata and validate ──────────────────────
		// These checks run before the ACK so that rejection responses are
		// sent immediately, not after the queue wait.

		const messageMeta = userMessage.metadata as Record<string, unknown> | undefined;

		// Extract sender identity for logging (needed for processing)
		const senderMeta = messageMeta?.["pi:sender"] as
			| { name?: string; description?: string }
			| undefined;
		// Sanitize sender name: max 64 chars, strip newlines to prevent injection
		const rawSenderName = senderMeta?.name ?? "Unknown agent";
		const senderName = rawSenderName.slice(0, 64).replace(/[\r\n]/g, " ");

		// Extract text from all part types (need the prompt for processing)
		const textSegments: string[] = [];
		for (const part of userMessage.parts) {
			if (part.kind === "text") {
				textSegments.push((part as { kind: "text"; text: string }).text);
			} else if (part.kind === "data") {
				const dataPart = part as { kind: "data"; data: Record<string, unknown> };
				textSegments.push(JSON.stringify(dataPart.data, null, 2));
			} else if (part.kind === "file") {
				const file = part.file as { uri?: string; name?: string; bytes?: string };
				if (file?.uri && /^https?:\/\//i.test(file.uri)) {
					textSegments.push(`[File: ${file.name ?? file.uri}](${file.uri})`);
				} else if (file?.uri) {
					// Non-http(s) URI (file://, data:, etc.) — display name only, no link
					textSegments.push(`[File: ${file.name ?? file.uri}]`);
				} else if (file?.name) {
					textSegments.push(`[File: ${file.name}]`);
				}
				this.log("executor_file_part", { taskId, uri: file?.uri, name: file?.name });
			} else {
				this.log("executor_unsupported_part", { taskId, kind: (part as { kind: string }).kind }, "WARN");
			}
		}

		// ── Supervisor: loop control check ──────────────────────────
		// Run BEFORE the ACK so that rejection responses are immediate.
		const incomingLoop = extractLoopMetadata(messageMeta);
		const supervisorResult = supervise(incomingLoop, this.supervisorConfig);

		if (!supervisorResult.approved) {
			this.log("supervisor_rejected", {
				taskId,
				reason: supervisorResult.reason,
				hopCount: supervisorResult.metadata.hopCount,
				visitedAgents: supervisorResult.metadata.visitedAgents,
			}, "WARN");

			// Publish failed status with clear rejection reason and finish
			this.publishError(taskId, contextId, eventBus,
				`Loop control: ${supervisorResult.reason}`);
			eventBus.finished();

			// Save the rejected task with metadata so it shows up in task store
			const rejectedMeta = injectLoopMetadata(messageMeta, supervisorResult.metadata);
			const rejectedTask: Task = {
				kind: "task",
				id: taskId,
				contextId,
				metadata: rejectedMeta,
				status: {
					state: "failed",
					message: {
						kind: "message",
						messageId: randomUUID(),
						role: "agent",
						parts: [{ kind: "text", text: `Loop control: ${supervisorResult.reason}` } as Part],
					},
					timestamp: new Date().toISOString(),
				},
			};
			try {
				await this.taskStore.save(rejectedTask);
			} catch (e) {
				this.log("executor_supervisor_store_error", { taskId, error: e instanceof Error ? e.message : String(e) }, "WARN");
				this.fallbackStatuses.set(taskId, { state: "failed", response: `Loop control: ${supervisorResult.reason}` });
			}

			// Fire push notification for automatic failure
			this.fireFailurePush(taskId, contextId, `Loop control: ${supervisorResult.reason}`);

			return;
		}

		// ── Empty message check ─────────────────────────────────────────
		if (textSegments.length === 0) {
			this.publishError(taskId, contextId, eventBus, "No processable content in message");
			eventBus.finished();

			// Persist the rejected task for parity with the supervisor rejection path
			const emptyTask: Task = {
				kind: "task",
				id: taskId,
				contextId,
				status: {
					state: "failed",
					message: {
						kind: "message",
						messageId: randomUUID(),
						role: "agent",
						parts: [{ kind: "text", text: "No processable content in message" } as Part],
					},
					timestamp: new Date().toISOString(),
				},
			};
			try {
				await this.taskStore.save(emptyTask);
			} catch (e) {
				this.log("executor_empty_store_error", { taskId, error: e instanceof Error ? e.message : String(e) }, "WARN");
				this.fallbackStatuses.set(taskId, { state: "failed", response: "No processable content in message" });
			}

			// Fire push notification for automatic failure
			this.fireFailurePush(taskId, contextId, "No processable content in message");

			return;
		}

		// ── Immediate ACK ────────────────────────────────────────────────
		// Publish initial task + "working" ACK and finish the event bus BEFORE
		// any queue waiting. This ensures the HTTP response is sent back to the
		// caller immediately — even for blocking callers — instead of being held
		// until the queue drains (which can take minutes for long-running tasks).
		//
		// The eventBus.finished() call tells the SDK's ExecutionEventQueue to
		// stop yielding events, which unblocks the HTTP response. The result is
		// saved to the TaskStore by processInBackground() when processing completes;
		// callers retrieve it via tasks/get polling or SSE resubscribe.
		const prompt = textSegments.join("\n");
		const ackMetadata = injectLoopMetadata(messageMeta, supervisorResult.metadata);

		if (!task) {
			eventBus.publish({
				kind: "task",
				id: taskId,
				contextId,
				status: { state: "submitted", timestamp: new Date().toISOString() },
				history: [userMessage],
			} as Task);
		}

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
			metadata: ackMetadata,
			final: true,
		} as TaskStatusUpdateEvent);
		eventBus.finished();

		this.log("executor_ack_sent", { taskId, sender: senderName, promptLength: prompt.length });

		// ── Queue: serialize and process ─────────────────────────────
		// After the ACK, wait for any preceding task to finish before
		// starting background processing. The HTTP response is already sent,
		// so the queue wait doesn't block the caller.
		let releaseQueue: () => void;
		const myTurn = this.queue;
		this.queue = new Promise<void>((resolve) => { releaseQueue = resolve; });

		// Register cancel callback and context mapping so queued tasks can be canceled
		let canceled = false;
		this._queueDepth++;
		this.cancelCallbacks.set(taskId, () => { canceled = true; });
		this.taskContexts.set(taskId, contextId);
		const queuedParentTaskId = this.activeTaskId;
		const queuedParentTraceId = this.activeLoopMetadata?.traceId;

		// Wait for preceding tasks to finish
		await myTurn;
		this._queueDepth--;
		this.cancelCallbacks.delete(taskId);

		// If canceled while queued (by abortAll or cancelTask), update the
		// task store to reflect the canceled state and skip processing.
		if (canceled) {
			this.log("executor_skip_canceled", { taskId });
			this.taskContexts.delete(taskId);
			// Update the task store so tasks/get returns canceled instead of stuck on working
			try {
				const cancelTask: Task = {
					kind: "task",
					id: taskId,
					contextId,
					status: {
						state: "canceled",
						message: {
							kind: "message",
							messageId: randomUUID(),
							role: "agent",
							parts: [{ kind: "text", text: "Task canceled while queued" } as Part],
						},
						timestamp: new Date().toISOString(),
					},
				};
				await this.taskStore.save(cancelTask);
			} catch (e) {
				this.log("executor_cancel_store_error", { taskId, error: e instanceof Error ? e.message : String(e) }, "WARN");
				this.fallbackStatuses.set(taskId, { state: "canceled", response: "Task canceled while queued" });
			}
			releaseQueue!();
			return;
		}

		// ── Duplicate-send guard: skip re-processing completed tasks ───────────
		// When a caller resends the same message/send while the task is working,
		// the follow-up is queued. By the time it dequeues, the first processing
		// may have already completed. Re-running processMessage would overwrite
		// the stored result and trigger a duplicate agent turn.
		//
		// Since we already ACKed this task, save the duplicate result to the
		// task store so callers polling via tasks/get see the terminal state.
		try {
			const existingTask = await this.taskStore.load(taskId);
			const existingState = existingTask?.status?.state;
			if (existingState === "completed" || existingState === "failed" || existingState === "canceled") {
				this.log("executor_skip_terminal_task", { taskId, state: existingState });
				this.taskContexts.delete(taskId);
				releaseQueue!();
				return;
			}
		} catch (err: unknown) {
			// Store error — proceed with processing anyway; the result
			// will be saved by processInBackground when it finishes.
			const msg = err instanceof Error ? err.message : String(err);
			this.log("executor_store_load_error", { taskId, error: msg }, "WARN");
		}

		// Supervisor approved — store the updated metadata for this task.
		// This is used by a2a_send for outbound metadata propagation.
		// Ensure traceId is set (generate one if this is the root of a chain)
		if (!supervisorResult.metadata.traceId) {
			supervisorResult.metadata.traceId = generateTraceId();
		}
		// Set parentTaskId from the active task context if this is a queued sub-call
		if (
			!supervisorResult.metadata.parentTaskId &&
			queuedParentTaskId != null &&
			queuedParentTraceId != null &&
			supervisorResult.metadata.traceId === queuedParentTraceId
		) {
			supervisorResult.metadata.parentTaskId = queuedParentTaskId;
		}
		this.activeLoopMetadata = supervisorResult.metadata;
		this.log("supervisor_approved", {
			taskId,
			hopCount: supervisorResult.metadata.hopCount,
			visitedAgents: supervisorResult.metadata.visitedAgents,
		});

		this.activeTaskId = taskId;
		const callContext = requestContext.context;
		this.log("executor_start", {
			taskId,
			sender: senderName,
			promptLength: prompt.length,
			authenticated: callContext?.user?.isAuthenticated ?? false,
			...(callContext?.requestedExtensions?.length
				? { requestedExtensions: callContext.requestedExtensions.length }
				: {}),
		});

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
		const resolvedContextId = this.taskContexts.get(taskId) ?? taskId;

		// Check queued tasks first
		const queuedCancel = this.cancelCallbacks.get(taskId);
		if (queuedCancel) {
			queuedCancel();
			this.cancelCallbacks.delete(taskId);
			this.taskContexts.delete(taskId);
			this.log("executor_cancel_queued", { taskId });
			eventBus.publish({
				kind: "status-update",
				taskId,
				contextId: resolvedContextId,
				status: { state: "canceled", timestamp: new Date().toISOString() },
				final: true,
			} as TaskStatusUpdateEvent);
			eventBus.finished();
			return;
		}

		// Active task — mark as canceled so result dispatch is skipped
		if (this.activeTaskId === taskId) {
			this.activeTaskId = null;
			this.activeLoopMetadata = null;
			this.taskContexts.delete(taskId);
			this.inputRoundCounts.delete(taskId);
			const parkedTimeout = this.parkedInputTimeouts.get(taskId);
			if (parkedTimeout) clearTimeout(parkedTimeout);
			this.parkedInputTimeouts.delete(taskId);
			const parkedEntry = this.parkedInputResolvers.get(taskId);
			if (parkedEntry) parkedEntry.reject(new Error("Task canceled"));
			// reject() already deletes the entry via its cleanup, but ensure it's gone
			this.parkedInputResolvers.delete(taskId);
			this.log("executor_cancel", { taskId });

			eventBus.publish({
				kind: "status-update",
				taskId,
				contextId: resolvedContextId,
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
		// Capture loop metadata before processing — it's cleared when the task
		// finishes, but we need it for the saved task result.
		const loopMetadata = this.activeLoopMetadata;

		let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
		try {
			// Wrap processMessage with a timeout to prevent one stuck task
			// from blocking the entire inbound queue indefinitely.
			let result: ProcessResult;
			if (this.taskTimeoutMs > 0) {
				const timeoutPromise = new Promise<ProcessResult>((_, reject) => {
					timeoutHandle = setTimeout(() => reject(new Error(`Task timeout: agent did not respond within ${this.taskTimeoutMs}ms`)), this.taskTimeoutMs);
				});
				result = await Promise.race([this.processMessage(prompt, senderName), timeoutPromise]);
			} else {
				result = await this.processMessage(prompt, senderName);
			}

			// Clear timeout handle if processMessage won the race
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
				timeoutHandle = null;
			}

			// Check if canceled while processing
			if (this.activeTaskId !== taskId) {
				this.log("executor_canceled_during_run", { taskId });
				this.activeLoopMetadata = null;
				this.inputRoundCounts.delete(taskId);
				return;
			}

			this.activeTaskId = null;
			this.activeLoopMetadata = null;

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
			await this.saveTaskResult(taskId, contextId, result, loopMetadata);
			this.taskContexts.delete(taskId);
			this.inputRoundCounts.delete(taskId);
			
			// Notify that result has been persisted
			this.onTaskResultSaved?.(taskId, result.ok);
		} catch (err: unknown) {
			this.activeTaskId = null;
			this.activeLoopMetadata = null;
			const msg = err instanceof Error ? err.message : String(err);
			this.log("executor_error", { taskId, error: msg }, "ERROR");

			// If this was a task timeout, abort the pending request in index.ts
			// to clean up pendingResolve state and prevent queue contamination
			if (msg.includes("Task timeout") && this.abortCurrentTask) {
				this.abortCurrentTask(msg);
			}

			this.lastTaskDurationMs = undefined;
			this.lastTaskStatus = "failed";
			this.onTaskFinished?.();

			// Save failure to the store so callers can see the error
			await this.saveTaskResult(taskId, contextId, {
				ok: false,
				response: "",
				error: msg,
				durationMs: 0,
			}, loopMetadata);
			this.taskContexts.delete(taskId);
			this.inputRoundCounts.delete(taskId);
			const parkedEntry = this.parkedInputResolvers.get(taskId);
			if (parkedEntry) parkedEntry.reject(new Error("Task failed"));
			this.parkedInputResolvers.delete(taskId);
			const parkedTimeout = this.parkedInputTimeouts.get(taskId);
			if (parkedTimeout) clearTimeout(parkedTimeout);
			this.parkedInputTimeouts.delete(taskId);
			
			// Notify that result has been persisted (even on error)
			this.onTaskResultSaved?.(taskId, false);
		} finally {
			// Clean up timeout handle to prevent timer leak
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
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
		loopMetadata?: LoopMetadata | null,
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

			// Merge existing metadata with loop-control metadata
			const existingMeta = existing?.metadata as Record<string, unknown> | undefined;
			const mergedMeta = loopMetadata
				? injectLoopMetadata(existingMeta, loopMetadata)
				: existingMeta;

			const updatedTask: Task = {
				kind: "task",
				id: taskId,
				contextId,
				// Preserve history from the existing task
				...(existing?.history ? { history: existing.history } : {}),
				// Include merged metadata (existing + loop control)
				...(mergedMeta ? { metadata: mergedMeta } : {}),
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

			// Fire push notification after persistence succeeds (fire-and-forget)
			if (this.hubConfig?.apiKey && this.hubAgentId) {
				const toState = result.ok ? "completed" : "failed";
				const fromState = existing?.status?.state as string | null || null;
				const hubConfig = this.hubConfig;
				const log = this.log;
				const agentId = this.hubAgentId;
				sendTaskStateChanged(
					agentId, taskId, fromState, toState,
					hubConfig, log,
					result.ok ? { response: result.response.slice(0, 500) } : undefined,
				).catch(err => {
					log("push_notification_failed", { error: err instanceof Error ? err.message : String(err) }, "WARN");
				});
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.log("task_result_save_error", { taskId, error: msg, attempt: 1 }, "ERROR");

			// Retry once after a short delay
			try {
				await new Promise(r => setTimeout(r, 500));
				const fallbackTask: Task = {
					kind: "task",
					id: taskId,
					contextId,
					status: {
						state: result.ok ? "completed" : "failed",
						message: {
							kind: "message",
							messageId: randomUUID(),
							role: "agent",
							parts: [{ kind: "text", text: result.ok ? result.response : `Error: ${result.error ?? "Unknown error"}` } as Part],
						},
						timestamp: new Date().toISOString(),
					},
				};
				await this.taskStore.save(fallbackTask);
				this.log("task_result_saved_retry", { taskId, state: result.ok ? "completed" : "failed" });

				// Fire push notification after retry-save succeeds
				if (this.hubConfig?.apiKey && this.hubAgentId) {
					const toState = result.ok ? "completed" : "failed";
					const hubConfig = this.hubConfig;
					const log = this.log;
					const agentId = this.hubAgentId;
					sendTaskStateChanged(
						agentId, taskId, null, toState,
						hubConfig, log,
						result.ok ? { response: result.response.slice(0, 500) } : undefined,
					).catch(err => {
						log("push_notification_failed", { error: err instanceof Error ? err.message : String(err) }, "WARN");
					});
				}
			} catch (retryErr: unknown) {
				const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
				this.log("task_result_save_error", { taskId, error: retryMsg, attempt: 2 }, "ERROR");

				// Last resort: store in memory so tasks/get doesn't return "working" forever
				this.fallbackStatuses.set(taskId, {
					state: result.ok ? "completed" : "failed",
					response: result.ok ? result.response : `Error: ${result.error ?? "Unknown error"}`,
				});
				this.log("task_result_fallback_stored", { taskId });
			}
		}
	}

	/**
	 * Get fallback status for a task whose result couldn't be persisted.
	 * Returns undefined if no fallback exists (normal path — DB worked fine).
	 */
	getFallbackStatus(taskId: string): { state: "completed" | "failed" | "canceled"; response: string } | undefined {
		return this.fallbackStatuses.get(taskId);
	}

	/** Send push notification for automatic task failures (loop control, empty messages). */
	private fireFailurePush(taskId: string, _contextId: string, error: string): void {
		if (this.hubConfig?.apiKey && this.hubAgentId) {
			const hubConfig = this.hubConfig;
			const log = this.log;
			const agentId = this.hubAgentId;
			setImmediate(() => {
				sendTaskStateChanged(
					agentId, taskId, null, "failed",
					hubConfig, log,
					{ response: error.slice(0, 500) },
				).catch(err => {
					log("push_notification_failed", { error: err instanceof Error ? err.message : String(err) }, "WARN");
				});
			});
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
