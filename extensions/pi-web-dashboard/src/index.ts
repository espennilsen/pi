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
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mountDashboard, unmountDashboard, broadcast } from "./web.ts";
import { createLogger } from "./logger.ts";

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
		// Extract assistant text from the message
		const msg = event.message as any;
		let text = "";
		if (msg?.role === "assistant" && Array.isArray(msg.content)) {
			text = msg.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text ?? "")
				.join("");
		}
		broadcast({
			type: "turn_end",
			turn: event.turnIndex,
			text: text || undefined,
			toolResults: event.toolResults.length,
		});
	});

	// Tool calls
	pi.on("tool_call", async (event) => {
		broadcast({ type: "tool_start", toolName: event.toolName, toolCallId: event.toolCallId });
	});

	pi.on("tool_result", async (event) => {
		// Send a preview of the result
		const textContent = event.content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text ?? "")
			.join("");
		broadcast({
			type: "tool_end",
			toolName: event.toolName,
			isError: event.isError,
			preview: textContent.slice(0, 200) || undefined,
		});
	});
}
