/**
 * pi-a2a — JSON-RPC 2.0 request handler.
 *
 * Implements A2A protocol server methods:
 *   - message/send     — Send a message, get a completed task back
 *   - tasks/get        — Get task by ID
 *   - tasks/cancel     — Cancel a running task
 *
 * Each message/send spawns an isolated `pi --mode rpc` subprocess
 * to process the prompt and returns the response as a completed task.
 */

import { randomUUID } from "node:crypto";
import type {
	JsonRpcRequest,
	JsonRpcResponse,
	SendMessageRequest,
	Message,
} from "./types.ts";
import type { LogFn } from "./logger.ts";
import { runPrompt } from "./subprocess.ts";
import * as store from "./task-store.ts";

// ── JSON-RPC Helpers ────────────────────────────────────────────

function success(id: string | number | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", result, id };
}

function error(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", error: { code, message, data }, id };
}

// Standard JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

// A2A-specific error codes
const TASK_NOT_FOUND = -32001;
const TASK_NOT_CANCELABLE = -32002;

// ── Handler ─────────────────────────────────────────────────────

export async function handleJsonRpc(
	body: string,
	cwd: string,
	log: LogFn,
): Promise<JsonRpcResponse> {
	let req: JsonRpcRequest;
	try {
		req = JSON.parse(body);
	} catch {
		return error(null, PARSE_ERROR, "Parse error");
	}

	if (req.jsonrpc !== "2.0" || !req.method) {
		return error(req.id ?? null, INVALID_REQUEST, "Invalid Request");
	}

	const id = req.id ?? null;
	log("rpc_request", { method: req.method, id: String(id) });

	switch (req.method) {
		case "message/send":
			return handleSendMessage(id, req.params as SendMessageRequest | undefined, cwd, log);

		case "tasks/get":
			return handleGetTask(id, req.params as { id: string } | undefined);

		case "tasks/cancel":
			return handleCancelTask(id, req.params as { id: string } | undefined);

		default:
			return error(id, METHOD_NOT_FOUND, `Method not found: ${req.method}`);
	}
}

// ── message/send ────────────────────────────────────────────────

async function handleSendMessage(
	id: string | number | null,
	params: SendMessageRequest | undefined,
	cwd: string,
	log: LogFn,
): Promise<JsonRpcResponse> {
	if (!params?.message?.parts?.length) {
		return error(id, INVALID_PARAMS, "message.parts is required");
	}

	// Extract text from message parts
	const textParts = params.message.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text);

	if (textParts.length === 0) {
		return error(id, INVALID_PARAMS, "At least one text part is required");
	}

	const prompt = textParts.join("\n");
	const contextId = (params as unknown as Record<string, unknown>).contextId as string | undefined;

	// Create task
	const task = store.createTask(contextId);
	store.appendMessage(task.id, params.message);
	store.updateTaskState(task.id, "working");

	log("task_created", { taskId: task.id, promptLength: prompt.length });

	// Run prompt via isolated pi subprocess
	const result = await runPrompt(prompt, cwd, log);

	if (result.ok) {
		const agentMessage: Message = {
			role: "agent",
			parts: [{ type: "text", text: result.response }],
		};

		store.appendMessage(task.id, agentMessage);
		store.addArtifact(task.id, {
			artifactId: randomUUID(),
			name: "response",
			parts: [{ type: "text", text: result.response }],
		});
		store.updateTaskState(task.id, "completed", agentMessage);

		log("task_completed", { taskId: task.id, responseLength: result.response.length, durationMs: result.durationMs });
	} else {
		const errorMessage: Message = {
			role: "agent",
			parts: [{ type: "text", text: `Error: ${result.error ?? "Unknown error"}` }],
		};
		store.updateTaskState(task.id, "failed", errorMessage);

		log("task_failed", { taskId: task.id, error: result.error ?? "Unknown", durationMs: result.durationMs }, "ERROR");
	}

	return success(id, store.getTask(task.id));
}

// ── tasks/get ───────────────────────────────────────────────────

function handleGetTask(
	id: string | number | null,
	params: { id: string } | undefined,
): JsonRpcResponse {
	if (!params?.id) {
		return error(id, INVALID_PARAMS, "id is required");
	}

	const task = store.getTask(params.id);
	if (!task) {
		return error(id, TASK_NOT_FOUND, "Task not found");
	}

	return success(id, task);
}

// ── tasks/cancel ────────────────────────────────────────────────

function handleCancelTask(
	id: string | number | null,
	params: { id: string } | undefined,
): JsonRpcResponse {
	if (!params?.id) {
		return error(id, INVALID_PARAMS, "id is required");
	}

	const task = store.getTask(params.id);
	if (!task) {
		return error(id, TASK_NOT_FOUND, "Task not found");
	}

	if (task.status.state === "completed" || task.status.state === "canceled" || task.status.state === "failed") {
		return error(id, TASK_NOT_CANCELABLE, `Task is already ${task.status.state}`);
	}

	store.cancelTask(params.id);
	return success(id, store.getTask(params.id));
}
