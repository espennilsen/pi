/**
 * pi-todoist — Todoist task management integration for pi.
 *
 * Provides five tools for full Todoist API access:
 *   - `todoist_tasks` — Tasks (list, add, update, complete, reopen, delete, move, search)
 *   - `todoist_projects` — Projects (list, add, update, delete, archive)
 *   - `todoist_sections` — Sections (list, add, update, delete)
 *   - `todoist_labels` — Labels (list, add, update, delete)
 *   - `todoist_comments` — Comments (list, add, update, delete)
 *
 * Configure in settings.json:
 *   "pi-todoist": {
 *     "apiToken": "<todoist-api-token>"
 *   }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveSettings } from "./settings.ts";
import { initClient, resetClient } from "./client.ts";
import { registerTasksTool } from "./tools/todoist-tasks.ts";
import { registerProjectsTool } from "./tools/todoist-projects.ts";
import { registerSectionsTool } from "./tools/todoist-sections.ts";
import { registerLabelsTool } from "./tools/todoist-labels.ts";
import { registerCommentsTool } from "./tools/todoist-comments.ts";

export default function (pi: ExtensionAPI) {
	// ── Register all tools (available immediately, guard on client readiness) ──
	registerTasksTool(pi);
	registerProjectsTool(pi);
	registerSectionsTool(pi);
	registerLabelsTool(pi);
	registerCommentsTool(pi);

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);

		if (!settings.apiToken) {
			// Silently skip — tools will show config message when invoked
			return;
		}

		try {
			initClient(settings);
			ctx.ui.setStatus("pi-todoist", "✅ todoist");
		} catch (err: any) {
			ctx.ui.notify(`pi-todoist: ${err.message}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		resetClient();
	});
}
