/**
 * pi-cmux — cmux terminal app integration for pi.
 *
 * Provides three layers of integration:
 *
 *   Layer 1 — Passive: Auto-detects cmux and pushes status/notifications
 *             via Pi lifecycle hooks (agent_start, agent_end, tool events).
 *
 *   Layer 2 — Tools: Registers cmux_list, cmux_split, cmux_read, cmux_send,
 *             cmux_close, cmux_notify, cmux_browser so the LLM can drive cmux.
 *
 *   Layer 3 — Skill: A SKILL.md teaches the agent orchestration patterns.
 *
 * Detection: Checks for CMUX_WORKSPACE_ID / CMUX_SURFACE_ID env vars and
 * the cmux socket at /tmp/cmux.sock. No-ops gracefully outside cmux.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { CmuxClient } from "./client.ts";
import { registerTools } from "./tools.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	// ── Detection ─────────────────────────────────────────────
	//
	// cmux injects CMUX_WORKSPACE_ID and CMUX_SURFACE_ID into every
	// terminal it spawns. We also check the socket exists.

	const workspaceId = process.env.CMUX_WORKSPACE_ID;
	const surfaceId = process.env.CMUX_SURFACE_ID;
	const client = new CmuxClient({ log });

	if (!workspaceId || !surfaceId || !client.isAvailable()) {
		log("not_in_cmux", {
			hasWorkspaceId: !!workspaceId,
			hasSurfaceId: !!surfaceId,
			socketAvailable: client.isAvailable(),
			socketPath: client.socketPath,
		}, "DEBUG");
		// Not running inside cmux — skip all setup
		return;
	}

	log("detected", { workspaceId, surfaceId, socketPath: client.socketPath });

	// ── Layer 2: Agent tools ──────────────────────────────────

	registerTools(pi, client, log);

	// ── Layer 1: Passive lifecycle hooks ──────────────────────

	/** Safely call cmux — never throw from lifecycle hooks. */
	function safe(fn: () => Promise<void>): void {
		fn().catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			log("hook_error", { error: msg }, "WARN");
		});
	}

	// Track turn progress for multi-turn agents
	let turnCount = 0;

	/** Status pill key used for all Pi status updates. */
	const STATUS_KEY = "pi";

	pi.on("session_start", async (_event, ctx) => {
		// Set workspace name from session
		const name = pi.getSessionName();
		if (name) {
			safe(() => client.renameWorkspace(name));
		}

		// Show initial idle status
		safe(() => client.setStatus(STATUS_KEY, "idle"));

		// Set terminal title
		if (ctx.hasUI) {
			ctx.ui.setTitle(`Pi — cmux`);
		}

		log("session_started", { workspaceId, surfaceId });
	});

	pi.on("agent_start", () => {
		turnCount = 0;
		safe(() => client.setStatus(STATUS_KEY, "thinking..."));
	});

	pi.on("agent_end", () => {
		safe(() => client.clearProgress());
		safe(() => client.setStatus(STATUS_KEY, "idle"));

		// Notify user that agent is done and needs attention
		safe(() => client.notify("Pi", "Ready for input"));
	});

	pi.on("tool_execution_start", (event) => {
		safe(() => client.setStatus(STATUS_KEY, `running ${event.toolName}...`));
	});

	pi.on("tool_execution_end", () => {
		safe(() => client.setStatus(STATUS_KEY, "thinking..."));
	});

	pi.on("turn_start", () => {
		turnCount++;
		if (turnCount > 1) {
			safe(() => client.setStatus(STATUS_KEY, `turn ${turnCount}...`));
		}
	});

	pi.on("turn_end", () => {
		// Reset at end — agent_end will set final status
	});

	pi.on("session_shutdown", async () => {
		await Promise.allSettled([
			client.clearStatus(STATUS_KEY),
			client.clearProgress(),
		]);
		log("session_shutdown");
	});

	// ── Commands ──────────────────────────────────────────────

	pi.registerCommand("cmux-status", {
		description: "Show cmux connection status and environment info",
		handler: async (_args, ctx) => {
			const lines: string[] = [
				"## cmux Integration Status",
				"",
				`- **Socket**: ${client.socketPath} (${client.isAvailable() ? "✅ connected" : "❌ unavailable"})`,
				`- **Workspace ID**: ${workspaceId}`,
				`- **Surface ID**: ${surfaceId}`,
			];

			try {
				const surfaces = await client.listSurfaces();
				const workspaces = await client.listWorkspaces();
				lines.push(`- **Surfaces**: ${Array.isArray(surfaces) ? surfaces.length : "?"}`);
				lines.push(`- **Workspaces**: ${Array.isArray(workspaces) ? workspaces.length : "?"}`);
			} catch {
				lines.push("- **API**: ⚠️ Could not query cmux");
			}

			lines.push("", "### Registered Tools");
			lines.push("cmux_list, cmux_split, cmux_read, cmux_send, cmux_close, cmux_notify, cmux_browser");

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ── Keyboard shortcuts ────────────────────────────────────

	pi.registerShortcut("ctrl+shift+w", {
		description: "List cmux panes",
		handler: async (ctx) => {
			try {
				const surfaces = await client.listSurfaces();
				if (!Array.isArray(surfaces) || surfaces.length === 0) {
					ctx.ui.notify("No cmux surfaces found", "info");
					return;
				}

				const surfaceMap = new Map<string, string>();
				const options = surfaces.map((s) => {
					const sf = s as Record<string, unknown>;
					const id = String(sf.id ?? "?");
					const label = `${id}: ${String(sf.title ?? sf.cwd ?? "untitled")}`;
					surfaceMap.set(label, id);
					return label;
				});

				const choice = await ctx.ui.select("cmux Panes", options);
				if (choice) {
					const selectedId = surfaceMap.get(choice) ?? choice;
					await client.focusSurface(selectedId);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`cmux error: ${msg}`, "error");
			}
		},
	});

	log("initialized", {
		workspaceId,
		surfaceId,
		socketPath: client.socketPath,
		tools: ["cmux_list", "cmux_split", "cmux_read", "cmux_send", "cmux_close", "cmux_notify", "cmux_browser"],
	});
}
