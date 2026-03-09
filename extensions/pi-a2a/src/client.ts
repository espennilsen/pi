/**
 * pi-a2a — A2A client for sending messages to remote agents.
 *
 * Sends A2A JSON-RPC `message/send` requests to remote agent endpoints.
 * Handles Bearer auth when a credential is provided.
 */

import { randomUUID } from "node:crypto";
import type { LogFn } from "./logger.ts";

/** Sender identity to include in message metadata. */
export interface SenderIdentity {
	/** Agent display name (e.g. "Aivena"). */
	name: string;
	/** Agent description (optional). */
	description?: string;
}

export interface SendMessageOptions {
	/** Remote agent's A2A endpoint URL. */
	url: string;
	/** Message text to send. */
	message: string;
	/** Bearer token for authenticating with the remote agent. */
	credential?: string | null;
	/** Timeout in milliseconds. Defaults to 120_000 (2 min). */
	timeoutMs?: number;
	/** Local agent identity to include as sender metadata. */
	sender?: SenderIdentity;
	/** If false, server returns immediately with a submitted task. Defaults to true. */
	blocking?: boolean;
	/** Callback URL for the receiver to send results back (used with blocking: false). */
	callbackUrl?: string;
	/** Credential for authenticating the callback to our endpoint. */
	callbackCredential?: string;
}

export interface SendMessageResult {
	ok: boolean;
	/** Extracted text from the agent's response artifacts/status. */
	response?: string;
	/** The raw JSON-RPC result for inspection. */
	raw?: unknown;
	/** Error message if the request failed. */
	error?: string;
	/** True when the remote agent returned HTTP 401 — credential may be stale. */
	unauthorized?: boolean;
	/** Task state if the response is a non-completed task (async processing). */
	taskState?: string;
	/** Task ID if the response is a task. */
	taskId?: string;
}

/**
 * Send a message to a remote A2A agent via `message/send`.
 *
 * Returns the agent's response text extracted from artifacts,
 * or the status message if no artifacts are present.
 */
export async function sendA2AMessage(
	opts: SendMessageOptions,
	log: LogFn,
): Promise<SendMessageResult> {
	const { url, message, credential, timeoutMs = 120_000, sender, blocking = true, callbackUrl, callbackCredential } = opts;

	// Build the message object, optionally including sender identity and callback info in metadata
	const metadata: Record<string, unknown> = {};
	if (sender) {
		metadata["pi:sender"] = {
			name: sender.name,
			...(sender.description ? { description: sender.description } : {}),
		};
	}
	if (callbackUrl) {
		metadata["pi:callback"] = {
			url: callbackUrl,
			...(callbackCredential ? { credential: callbackCredential } : {}),
		};
	}

	const msg: Record<string, unknown> = {
		kind: "message",
		messageId: randomUUID(),
		role: "user",
		parts: [{ kind: "text", text: message }],
	};
	if (Object.keys(metadata).length > 0) {
		msg.metadata = metadata;
	}

	const params: Record<string, unknown> = { message: msg };
	if (!blocking) {
		params.configuration = { blocking: false };
	}

	const payload = {
		jsonrpc: "2.0" as const,
		method: "message/send",
		params,
		id: randomUUID(),
	};

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (credential) {
		headers["Authorization"] = `Bearer ${credential}`;
	}

	log("a2a_send_start", { url, messageLength: message.length, hasCredential: !!credential });

	try {
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(timeoutMs),
		});

		if (res.status === 401) {
			log("a2a_send_unauthorized", { url }, "ERROR");
			return { ok: false, error: "Unauthorized — the remote agent rejected the credential", unauthorized: true };
		}

		if (!res.ok) {
			const text = await res.text();
			log("a2a_send_http_error", { url, status: res.status, body: text.slice(0, 500) }, "ERROR");
			return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
		}

		const data = await res.json() as {
			jsonrpc: "2.0";
			result?: Record<string, unknown>;
			error?: { code: number; message: string; data?: unknown };
			id: string;
		};

		if (data.error) {
			log("a2a_send_rpc_error", { url, code: data.error.code, message: data.error.message }, "ERROR");
			return { ok: false, error: `RPC error ${data.error.code}: ${data.error.message}`, raw: data };
		}

		if (!data.result) {
			return { ok: false, error: "Empty result from remote agent", raw: data };
		}

		// Check if response is a task in a non-terminal state (async processing)
		const resultObj = data.result as Record<string, unknown>;
		const taskStatus = resultObj.status as { state?: string } | undefined;
		const terminalStates = ["completed", "failed", "canceled", "rejected"];
		if (taskStatus?.state && !terminalStates.includes(taskStatus.state)) {
			const taskId = resultObj.id as string | undefined;
			log("a2a_send_async", { url, taskId, state: taskStatus.state });
			return { ok: true, response: "", taskId, taskState: taskStatus.state, raw: data.result };
		}

		// Extract response text from the A2A task result
		const responseText = extractResponseText(data.result);
		log("a2a_send_success", { url, responseLength: responseText.length });

		return { ok: true, response: responseText, raw: data.result };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log("a2a_send_error", { url, error: msg }, "ERROR");
		return { ok: false, error: msg };
	}
}

/**
 * Send a callback with results to the original sender.
 *
 * Used by the receiver after async processing completes.
 * The callback is a standard message/send with `pi:isCallback: true` metadata,
 * which the sender's server intercepts and injects directly into the conversation.
 */
export async function sendA2ACallback(
	opts: {
		url: string;
		credential?: string | null;
		taskId: string;
		response: string;
		sender?: SenderIdentity;
	},
	log: LogFn,
): Promise<void> {
	const { url, credential, taskId, response, sender } = opts;
	const metadata: Record<string, unknown> = {
		"pi:isCallback": true,
		"pi:taskId": taskId,
	};
	if (sender) {
		metadata["pi:sender"] = {
			name: sender.name,
			...(sender.description ? { description: sender.description } : {}),
		};
	}

	const msg = {
		kind: "message",
		messageId: randomUUID(),
		role: "user",
		parts: [{ kind: "text", text: response }],
		metadata,
	};

	const payload = {
		jsonrpc: "2.0" as const,
		method: "message/send",
		params: { message: msg },
		id: randomUUID(),
	};

	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (credential) {
		headers["Authorization"] = `Bearer ${credential}`;
	}

	log("a2a_callback_start", { url, taskId, responseLength: response.length });

	try {
		const res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(30_000),
		});

		if (!res.ok) {
			log("a2a_callback_failed", { url, taskId, status: res.status }, "ERROR");
		} else {
			log("a2a_callback_sent", { url, taskId });
		}
	} catch (err: unknown) {
		const errMsg = err instanceof Error ? err.message : String(err);
		log("a2a_callback_error", { url, taskId, error: errMsg }, "ERROR");
	}
}

/**
 * Extract readable text from an A2A task result.
 *
 * Looks for text in: artifacts → status.message → fallback to JSON.
 */
function extractResponseText(result: Record<string, unknown>): string {
	const parts: string[] = [];

	// Try artifacts first (primary response content)
	const artifacts = result.artifacts as Array<{ parts?: Array<{ kind: string; text?: string }> }> | undefined;
	if (artifacts?.length) {
		for (const artifact of artifacts) {
			if (artifact.parts) {
				for (const part of artifact.parts) {
					if (part.kind === "text" && part.text) {
						parts.push(part.text);
					}
				}
			}
		}
	}

	if (parts.length > 0) {
		return parts.join("\n");
	}

	// Fall back to status message
	const status = result.status as { message?: { parts?: Array<{ kind: string; text?: string }> } } | undefined;
	if (status?.message?.parts) {
		for (const part of status.message.parts) {
			if (part.kind === "text" && part.text) {
				parts.push(part.text);
			}
		}
	}

	if (parts.length > 0) {
		return parts.join("\n");
	}

	// Last resort: serialize the whole result
	return JSON.stringify(result, null, 2);
}
