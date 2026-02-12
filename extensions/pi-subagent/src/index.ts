/**
 * pi-subagent — Parallel task delegation extension for pi.
 *
 * Provides:
 *   - subagent tool — spawn isolated pi subprocesses (single/parallel/chain)
 *   - Agent discovery from ~/.pi/agent/agents/*.md and .pi/agents/*.md
 *   - One-shot tracking with event bus integration
 *
 * Configuration (settings.json under "pi-subagent"):
 *   {
 *     "pi-subagent": {
 *       "maxConcurrent": 4,
 *       "maxTotal": 8,
 *       "timeoutMs": 600000,
 *       "model": null
 *     }
 *   }
 *
 * Events emitted:
 *   - subagent:start    { agent, task, trackingId }
 *   - subagent:complete { agent, trackingId, status, tokens, cost, durationMs }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSubagentTool } from "./tool.ts";
import { resolveSettings } from "./settings.ts";
import { createLogger } from "./logger.ts";

export { runIsolatedAgent } from "./runner.ts";
export { discoverAgents } from "./agents.ts";
export { oneShotTracker } from "./tracker.ts";
export type {
	AgentConfig,
	AgentScope,
	RunnerResult,
	SingleResult,
	SubagentSettings,
	OneShotEntry,
	OneShotStatus,
} from "./types.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);
		registerSubagentTool(pi, settings, log);
	});

	pi.on("session_shutdown", async () => {
		// Tracker cleanup
		const { oneShotTracker } = await import("./tracker.ts");
		oneShotTracker.dispose();
	});
}
