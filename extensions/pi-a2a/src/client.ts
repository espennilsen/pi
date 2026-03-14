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
	/** Timeout in milliseconds. No timeout by default (requests are async/background). */
	timeoutMs?: number;
	/** Local agent identity to include as sender metadata. */
	sender?: SenderIdentity;
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
	/** True when the remote agent ACKed with "working" — the real result will arrive later as a separate message. */
	working?: boolean;
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
	const { url, message, credential, timeoutMs, sender } = opts;

	// Build the message object, optionally including sender identity in metadata
	const msg: Record<string, unknown> = {
		kind: "message",
		messageId: randomUUID(),
		role: "user",
		parts: [{ kind: "text", text: message }],
	};
	if (sender) {
		msg.metadata = {
			"pi:sender": {
				name: sender.name,
				...(sender.description ? { description: sender.description } : {}),
			},
		};
	}

	const payload = {
		jsonrpc: "2.0" as const,
		method: "message/send",
		params: { message: msg },
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
			...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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

		// Detect "working" ACK — the remote agent accepted the task but hasn't finished yet.
		// The actual result will arrive later as a separate A2A message.
		const status = (data.result as { status?: { state?: string } }).status;
		if (status?.state === "working") {
			log("a2a_send_working", { url });
			return { ok: true, response: "", raw: data.result, working: true };
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
