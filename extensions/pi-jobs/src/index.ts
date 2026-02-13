/**
 * pi-jobs — Agent run telemetry and cost tracking extension for pi.
 *
 * Tracks every agent invocation with token usage, cost, duration, and tool call stats.
 * Stores data in a configurable database backend.
 *
 * Provides:
 *   - Auto-tracking of all agent runs via lifecycle events
 *   - `jobs` tool for the LLM to query stats
 *   - Web dashboard at /jobs via pi-webserver
 *   - /jobs command for quick stats in TUI
 *
 * Listens for events from pi-cron, pi-heartbeat, and pi-subagent to
 * track subprocess runs as well.
 *
 * Database backend is configurable:
 *   - Default: local SQLite via better-sqlite3 (db.ts)
 *   - Optional: shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Settings:
 *   "pi-jobs": {
 *     "dbPath": "jobs/jobs.db",   // SQLite file path (sqlite backend only)
 *     "useKysely": true           // Use pi-kysely shared DB instead of SQLite
 *   }
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { resolveSettings } from "./settings.ts";
import { closeDb } from "./db.ts";
import { setJobsStore, isStoreReady, createSqliteStore, createKyselyStore } from "./store.ts";
import { registerTracker } from "./tracker.ts";
import { registerJobsTool } from "./tool.ts";
import { mountJobsRoutes, unmountJobsRoutes } from "./web.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);

		if (settings.useKysely) {
			// ── Kysely backend ──────────────────────────────────
			// Handle both orderings: kysely may already be ready,
			// or it may start after us. Probe first, then listen.

			const initKysely = async () => {
				if (isStoreReady()) return; // already initialized
				try {
					const store = await createKyselyStore(pi.events as any);
					setJobsStore(store);
					log("ready", { backend: "kysely" });
					mountJobsRoutes(pi.events);
				} catch (err: any) {
					log("error", { backend: "kysely", error: err.message }, "ERROR");
				}
			};

			// Listen for future kysely:ready events
			pi.events.on("kysely:ready", initKysely);

			// Probe: check if pi-kysely is already available
			log("init", { backend: "kysely", status: "probing for kysely" });
			let kyselyAlreadyReady = false;
			pi.events.emit("kysely:info", {
				reply: () => { kyselyAlreadyReady = true; },
			});
			if (kyselyAlreadyReady) {
				log("init", { backend: "kysely", status: "kysely already available" });
				await initKysely();
			} else {
				log("init", { backend: "kysely", status: "waiting for kysely:ready" });
			}
		} else {
			// ── SQLite backend (default) ────────────────────────
			const agentDir = getAgentDir();
			const dbPath = path.isAbsolute(settings.dbPath)
				? settings.dbPath
				: path.join(agentDir, settings.dbPath);

			const store = await createSqliteStore(dbPath);
			setJobsStore(store);
			log("init", { backend: "sqlite", dbPath });

			// Mount web routes
			mountJobsRoutes(pi.events);
		}
	});

	// Re-mount when pi-webserver starts after us
	pi.events.on("web:ready", () => {
		if (!isStoreReady()) return;
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
				const { getJobsStore } = await import("./store.ts");
				const store = getJobsStore();
				const channel = args?.trim() || undefined;
				const totals = await store.getTotals(channel);
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
