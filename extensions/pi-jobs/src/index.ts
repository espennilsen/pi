/**
 * pi-jobs — Agent run telemetry and cost tracking extension for pi.
 *
 * Tracks every agent invocation with token usage, cost, duration, and tool call stats.
 * Stores data in a self-contained SQLite database.
 *
 * Provides:
 *   - Auto-tracking of all agent runs via lifecycle events
 *   - `jobs` tool for the LLM to query stats
 *   - Web dashboard at /jobs via pi-webserver
 *   - /jobs command for quick stats in TUI
 *
 * Listens for events from pi-cron, pi-heartbeat, and pi-subagent to
 * track subprocess runs as well.
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { resolveSettings } from "./settings.ts";
import { initDb, closeDb, getJobsApi } from "./db.ts";
import { registerTracker } from "./tracker.ts";
import { registerJobsTool } from "./tool.ts";
import { mountJobsRoutes, unmountJobsRoutes } from "./web.ts";

export default function (pi: ExtensionAPI) {
	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);
		const agentDir = getAgentDir();
		const dbPath = path.isAbsolute(settings.dbPath)
			? settings.dbPath
			: path.join(agentDir, settings.dbPath);

		initDb(dbPath);

		// Mount web routes
		mountJobsRoutes(pi.events);
	});

	// Re-mount when pi-webserver starts after us
	pi.events.on("web:ready", () => {
		mountJobsRoutes(pi.events);
	});

	pi.on("session_shutdown", async () => {
		unmountJobsRoutes(pi.events);
		closeDb();
	});

	// ── Event tracker ─────────────────────────────────────────
	registerTracker(pi);

	// ── LLM tool ──────────────────────────────────────────────
	registerJobsTool(pi);

	// ── Command: /jobs ────────────────────────────────────────

	pi.registerCommand("jobs", {
		description: "Show quick job stats: /jobs [channel]",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "tui", label: "tui — TUI session runs" },
				{ value: "cron", label: "cron — Cron job runs" },
				{ value: "heartbeat", label: "heartbeat — Heartbeat check runs" },
				{ value: "subagent", label: "subagent — Subagent runs" },
			];
			return items.filter((i) => i.value.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			try {
				const api = getJobsApi();
				const channel = args?.trim() || undefined;
				const totals = api.getTotals(channel);
				const label = channel ? ` (${channel})` : "";
				const lines = [
					`Jobs${label}: ${totals.jobs} runs · ${totals.errors} errors`,
					`Tokens: ${totals.tokens.toLocaleString()} · Cost: $${totals.cost.toFixed(4)}`,
					`Tools: ${totals.toolCalls} calls · Avg: ${(totals.avgDurationMs / 1000).toFixed(1)}s`,
				];
				ctx.ui.notify(lines.join("\n"), "info");
			} catch (e: any) {
				ctx.ui.notify(`pi-jobs: ${e.message}`, "error");
			}
		},
	});
}
