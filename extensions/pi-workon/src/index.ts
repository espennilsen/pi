/**
 * pi-workon — Project context switching extension for pi.
 *
 * Provides:
 *   - workon        — Tool: switch project context (switch/status/list)
 *   - /workon       — Slash command: quick project switch
 *   - project_init  — Tool: detect stack & scaffold AGENTS.md, .pi/, td
 *
 * Configuration (settings.json under "pi-workon"):
 *   {
 *     "pi-workon": {
 *       "devDirs": ["~/Dev", "~/Work"],
 *       "aliases": {
 *         "bg": "battleground.no",
 *         "blog": "e9n.dev",
 *         "infra": "/opt/infrastructure"
 *       }
 *     }
 *   }
 *
 * Legacy "devDir" (string) is still supported.
 * Defaults to ~/Dev if nothing is configured.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWorkonTool, registerProjectInitTool } from "./tool.ts";
import { resolveSettings } from "./settings.ts";
import { resolveProject, listProjectDirs } from "./resolver.ts";
import { createLogger } from "./logger.ts";

export { getActiveProject } from "./tool.ts";
export { detectStack, type ProjectProfile } from "./detector.ts";
export { resolveProject, type ResolvedProject } from "./resolver.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);

		// Register tools
		registerWorkonTool(pi, settings);
		registerProjectInitTool(pi, settings);

		// Register /workon slash command for quick switching
		pi.registerCommand("workon", {
			description: "Switch to a project: /workon <name|alias|path>",
			getArgumentCompletions: (prefix: string) => {
				const entries = listProjectDirs(settings.devDirs);
				const names = entries.map((e) => e.name);

				// Include aliases
				const aliasNames = Object.keys(settings.aliases);
				const all = [...new Set([...names, ...aliasNames])];

				return all
					.filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase()))
					.map((n) => ({ value: n, label: n }));
			},
			handler: async (args, ctx) => {
				const project = args?.trim();
				if (!project) {
					ctx.ui.notify("Usage: /workon <project-name>", "info");
					return;
				}

				ctx.ui.notify(`Switching to ${project}…`, "info");

				// Use sendUserMessage to trigger the workon tool via the agent
				pi.sendUserMessage(`/workon ${project}`, { deliverAs: "followUp" });
			},
		});

		log("init", { devDirs: settings.devDirs, aliasCount: Object.keys(settings.aliases).length });
	});
}
