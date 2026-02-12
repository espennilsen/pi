/**
 * pi-workon — Project context switching extension for pi.
 *
 * Provides:
 *   - workon        — Switch project context (switch/status/list)
 *   - project_init  — Detect stack & scaffold AGENTS.md, .pi/, td
 *
 * Configuration (settings.json under "pi-workon"):
 *   { "pi-workon": { "devDir": "~/Dev" } }
 *
 * Defaults to ~/Dev if no devDir is configured.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWorkonTool, registerProjectInitTool } from "./tool.ts";
import { resolveSettings } from "./settings.ts";
import { createLogger } from "./logger.ts";

export { getActiveProject } from "./tool.ts";
export { detectStack, type ProjectProfile } from "./detector.ts";
export { resolveProject, type ResolvedProject } from "./resolver.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	// Resolve settings on session start, then register tools
	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);
		registerWorkonTool(pi, settings.devDir);
		registerProjectInitTool(pi, settings.devDir);
		log("init", { devDir: settings.devDir });
	});
}
