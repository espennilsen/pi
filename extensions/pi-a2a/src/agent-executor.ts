/**
 * pi-a2a — Agent executor using pi subprocess.
 *
 * Implements @a2a-js/sdk's AgentExecutor interface following the SDK's
 * task lifecycle pattern:
 *
 *   1. Publish initial Task (state: submitted) if new
 *   2. Publish status-update (state: working)
 *   3. Spawn pi subprocess, collect response
 *   4. Publish artifact-update with the response
 *   5. Publish final status-update (state: completed) with final=true
 *   6. Call eventBus.finished()
 *
 * This enables proper task tracking via InMemoryTaskStore, streaming
 * via SSE, and push notifications for long-running tasks.
 */

import { randomUUID } from "node:crypto";
import type { AgentExecutor, ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import type { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, Part } from "@a2a-js/sdk";
import { runPrompt, type SubprocessHandle } from "./subprocess.ts";
import type { LogFn } from "./logger.ts";

/** Max concurrent subprocess executions. */
const MAX_CONCURRENT = 3;

interface RunningTask {
	handle: SubprocessHandle;
	contextId: string;
}

export class PiAgentExecutor implements AgentExecutor {
	private cwd: string;
	private log: LogFn;
	/** Track running subprocesses for cancellation and concurrency. */
	private running = new Map<string, RunningTask>();

	constructor(cwd: string, log: LogFn) {
		this.cwd = cwd;
		this.log = log;
	}

	setCwd(cwd: string): void {
		this.cwd = cwd;
	}

	/** Abort all running tasks. Call before discarding the executor. */
	abortAll(): void {
		for (const [taskId, entry] of this.running) {
			entry.handle.abort();
			this.log("executor_abort_all", { taskId });
		}
		this.running.clear();
	}

	async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
		const { userMessage, taskId, contextId, task } = requestContext;

		// Concurrency guard
		if (this.running.size >= MAX_CONCURRENT) {
			this.log("executor_busy", { taskId, active: this.running.size, max: MAX_CONCURRENT }, "WARN");
			this.publishError(taskId, contextId, eventBus, "Server busy — too many concurrent requests");
			eventBus.finished();
			return;
		}

		// Extract text from all part types
		const textSegments: string[] = [];
		for (const part of userMessage.parts) {
			if (part.kind === "text") {
				textSegments.push((part as { kind: "text"; text: string }).text);
			} else if (part.kind === "data") {
				// Serialize structured data as JSON for the subprocess
				const dataPart = part as { kind: "data"; data: Record<string, unknown> };
				textSegments.push(JSON.stringify(dataPart.data, null, 2));
			} else {
				this.log("executor_unsupported_part", { taskId, kind: part.kind }, "WARN");
			}
		}

		if (textSegments.length === 0) {
			this.publishError(taskId, contextId, eventBus, "No processable content in message");
			eventBus.finished();
			return;
		}

		// ── Step 1: Publish initial Task if this is a new task ──
		if (!task) {
			const initialTask: Task = {
				kind: "task",
				id: taskId,
				contextId,
				status: {
					state: "submitted",
					timestamp: new Date().toISOString(),
				},
				history: [userMessage],
			};
			eventBus.publish(initialTask);
		}

		// ── Step 2: Publish "working" status ──
		const workingUpdate: TaskStatusUpdateEvent = {
			kind: "status-update",
			taskId,
			contextId,
			status: {
				state: "working",
				timestamp: new Date().toISOString(),
			},
			final: false,
		};
		eventBus.publish(workingUpdate);

		const prompt = textSegments.join("\n");
		this.log("executor_start", { taskId, promptLength: prompt.length });

		// ── Step 3: Spawn subprocess ──
		const handle = runPrompt(prompt, this.cwd, this.log);
		this.running.set(taskId, { handle, contextId });

		try {
			const result = await handle.result;

			// If canceled while running, don't publish completion
			if (!this.running.has(taskId)) {
				this.log("executor_canceled_during_run", { taskId, durationMs: result.durationMs });
				return;
			}

			this.running.delete(taskId);

			if (result.ok) {
				// ── Step 4: Publish artifact with response ──
				const artifactUpdate: TaskArtifactUpdateEvent = {
					kind: "artifact-update",
					taskId,
					contextId,
					artifact: {
						artifactId: randomUUID(),
						name: "response",
						parts: [{ kind: "text", text: result.response } as Part],
					},
				};
				eventBus.publish(artifactUpdate);

				// ── Step 5: Publish final "completed" status ──
				// Content is in the artifact; status message is a brief summary to avoid duplication
				const completedUpdate: TaskStatusUpdateEvent = {
					kind: "status-update",
					taskId,
					contextId,
					status: {
						state: "completed",
						timestamp: new Date().toISOString(),
					},
					final: true,
				};
				eventBus.publish(completedUpdate);
				this.log("executor_completed", { taskId, responseLength: result.response.length, durationMs: result.durationMs });
			} else {
				this.publishError(taskId, contextId, eventBus, result.error ?? "Unknown error");
				this.log("executor_failed", { taskId, error: result.error ?? "Unknown", durationMs: result.durationMs }, "ERROR");
			}
		} catch (err: unknown) {
			this.running.delete(taskId);
			const msg = err instanceof Error ? err.message : String(err);
			this.publishError(taskId, contextId, eventBus, msg);
			this.log("executor_error", { taskId, error: msg }, "ERROR");
		}

		// ── Step 6: Signal execution finished ──
		eventBus.finished();
	}

	async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
		const entry = this.running.get(taskId);
		if (entry) {
			entry.handle.abort();
			this.running.delete(taskId);
			this.log("executor_cancel", { taskId });

			const cancelEvent: TaskStatusUpdateEvent = {
				kind: "status-update",
				taskId,
				contextId: entry.contextId,
				status: {
					state: "canceled",
					timestamp: new Date().toISOString(),
				},
				final: true,
			};
			eventBus.publish(cancelEvent);
		} else {
			this.log("executor_cancel_unknown", { taskId }, "WARN");
		}
		eventBus.finished();
	}

	private publishError(taskId: string, contextId: string, eventBus: ExecutionEventBus, error: string): void {
		const errorEvent: TaskStatusUpdateEvent = {
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
		};
		eventBus.publish(errorEvent);
	}
}
