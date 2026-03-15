/**
 * pi-web-dashboard — Live agent dashboard with SSE streaming.
 *
 * Mounts on pi-webserver:
 *   Page: /dashboard         — Dashboard UI with live agent stream
 *   API:  /api/dashboard/events  — SSE stream of agent events
 *   API:  /api/dashboard/prompt  — POST a prompt to the agent
 *   API:  /api/dashboard/config  — Agent config/status
 *
 * Subscribes to agent lifecycle events and streams them to SSE clients.
 *
 * SSE event types (structured payloads):
 *   connected     — { type, time }
 *   agent_start   — { type, time }
 *   agent_end     — { type, time }
 *   user_message  — { type, text, time }
 *   turn_start    — { type, turn }
 *   turn_end      — { type, turn, content[], toolResults }
 *   tool_start    — { type, toolName, toolCallId, input? }
 *   tool_end      — { type, toolName, toolCallId, isError, content }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mountDashboard, unmountDashboard, broadcast } from "./web.ts";
import { createLogger } from "./logger.ts";

/** Max characters per text content block in SSE payloads. */
const MAX_TEXT_CHARS = 8_192;

/** Max characters for serialized tool input in SSE payloads. */
const MAX_INPUT_CHARS = 4_096;

/** Truncate a string to a character limit, appending "…" if clipped. */
function truncate(s: string, maxChars: number): string {
	if (s.length <= maxChars) return s;
	return s.slice(0, maxChars) + "…";
}

/** Serialize and truncate a tool input to a JSON string within a character limit. */
function truncateInput(input: unknown, maxChars: number): string | undefined {
	if (input == null) return undefined;
	try {
		const json = JSON.stringify(input);
		return truncate(json, maxChars);
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	// Mount web routes when webserver is ready
	const mount = () => { mountDashboard(pi); log("mount", {}); };

	pi.events.on("web:ready", mount);
	pi.on("session_start", async () => mount());

	pi.on("session_shutdown", async () => {
		unmountDashboard(pi);
	});

	// ── Stream agent events to SSE clients ────────────────────

	pi.on("agent_start", async () => {
		broadcast({ type: "agent_start", time: new Date().toISOString() });
	});

	pi.on("agent_end", async () => {
		broadcast({ type: "agent_end", time: new Date().toISOString() });
	});

	pi.on("turn_start", async (event) => {
		broadcast({ type: "turn_start", turn: event.turnIndex });
	});

	pi.on("turn_end", async (event) => {
		// Send the full assistant content blocks so the frontend can render
		// text, thinking, and tool_use blocks with proper styling.
		const msg = event.message as { role?: string; content?: unknown[] } | undefined;
		const content: unknown[] = [];

		if (msg?.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				const b = block as Record<string, unknown>;
				if (b.type === "text") {
					content.push({ type: "text", text: truncate(String(b.text ?? ""), MAX_TEXT_CHARS) });
				} else if (b.type === "thinking") {
					content.push({ type: "thinking", thinking: truncate(String(b.thinking ?? ""), MAX_TEXT_CHARS) });
				} else if (b.type === "tool_use") {
					content.push({
						type: "tool_use",
						id: b.id,
						name: b.name,
						// Omit input — tool_start/tool_end events carry that
					});
				}
			}
		}

		// Note: TurnEndEvent does not carry stopReason (verified against type def).
		broadcast({
			type: "turn_end",
			turn: event.turnIndex,
			content,
			toolResults: event.toolResults.length,
		});
	});

	// Tool calls — include input params (capped) for debugging visibility
	pi.on("tool_call", async (event) => {
		broadcast({
			type: "tool_start",
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			input: truncateInput(event.input, MAX_INPUT_CHARS),
		});
	});

	// Tool results — send content (capped per block) and correlate with toolCallId
	pi.on("tool_result", async (event) => {
		// Build structured content array from the result
		const content: unknown[] = [];
		for (const c of event.content) {
			const block = c as unknown as Record<string, unknown>;
			if (block.type === "text") {
				content.push({ type: "text", text: truncate(String(block.text ?? ""), MAX_TEXT_CHARS) });
			} else if (block.type === "image") {
				content.push({ type: "image" }); // Don't send binary data over SSE
			} else {
				content.push({ type: block.type ?? "unknown" });
			}
		}

		broadcast({
			type: "tool_end",
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			isError: event.isError,
			content,
		});
	});
}
