/**
 * pi-a2a — Agent executor using pi subprocess.
 *
 * Implements @a2a-js/sdk's AgentExecutor interface. Each execution
 * spawns an isolated `pi --mode rpc` subprocess, collects the response,
 * and publishes it as an A2A Message event.
 */

import { randomUUID } from "node:crypto";
import type { AgentExecutor, ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import type { Message, TaskStatusUpdateEvent } from "@a2a-js/sdk";
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

	async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
		const { userMessage, taskId, contextId } = requestContext;

		// Concurrency guard
		if (this.running.size >= MAX_CONCURRENT) {
			this.log("executor_busy", { taskId, active: this.running.size, max: MAX_CONCURRENT }, "WARN");
			this.publishError(taskId, contextId, eventBus, "Server busy — too many concurrent requests");
			eventBus.finished();
			return;
		}

		// Extract text from message parts
		const textParts = userMessage.parts
			.filter((p): p is { kind: "text"; text: string; metadata?: Record<string, unknown> } =>
				p.kind === "text" && typeof (p as unknown as { text?: unknown }).text === "string")
			.map((p) => p.text);

		if (textParts.length === 0) {
			this.publishError(taskId, contextId, eventBus, "No text content in message");
			eventBus.finished();
			return;
		}

		const prompt = textParts.join("\n");
		this.log("executor_start", { taskId, promptLength: prompt.length });

		// Spawn subprocess
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
				const agentMessage: Message = {
					kind: "message",
					messageId: randomUUID(),
					role: "agent",
					parts: [{ kind: "text", text: result.response }],
				};
				eventBus.publish(agentMessage);
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

		eventBus.finished();
	}

	async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
		const entry = this.running.get(taskId);
		const contextId = entry?.contextId ?? taskId;
		if (entry) {
			entry.handle.abort();
			this.running.delete(taskId);
			this.log("executor_cancel", { taskId });
		}

		const cancelEvent: TaskStatusUpdateEvent = {
			kind: "status-update",
			taskId,
			contextId,
			status: {
				state: "canceled",
				timestamp: new Date().toISOString(),
			},
			final: true,
		};
		eventBus.publish(cancelEvent);
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
					parts: [{ kind: "text", text: `Error: ${error}` }],
				},
				timestamp: new Date().toISOString(),
			},
			final: true,
		};
		eventBus.publish(errorEvent);
	}
}
