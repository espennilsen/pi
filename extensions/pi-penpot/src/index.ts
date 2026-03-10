/**
 * pi-penpot — Penpot design tool integration for pi.
 *
 * Provides three tools for full Penpot API access:
 *   - `penpot` — Projects, files, teams, libraries, media, webhooks, snapshots
 *   - `penpot_page` — Pages, shapes, components (design content)
 *   - `penpot_comment` — Comment threads, replies, collaboration
 *
 * Configure in settings.json:
 *   "pi-penpot": {
 *     "endpoint": "https://penpot.e9n.dev",
 *     "accessToken": "<personal-access-token>"
 *   }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveSettings } from "./settings.ts";
import { initClient, resetClient, isClientReady } from "./client.ts";
import { registerPenpotTool } from "./tools/penpot.ts";
import { registerPenpotPageTool, clearFileCache } from "./tools/penpot-page.ts";
import { registerPenpotCommentTool } from "./tools/penpot-comment.ts";

export default function (pi: ExtensionAPI) {
	// ── Register all tools (available immediately, guard on client readiness) ──
	registerPenpotTool(pi);
	registerPenpotPageTool(pi);
	registerPenpotCommentTool(pi);

	// ── Lifecycle ─────────────────────────────────────────────

	let sessionCtx: Parameters<Parameters<typeof pi.on>[1]>[1] | null = null;

	pi.on("session_start", async (_event, ctx) => {
		sessionCtx = ctx;
		clearFileCache();

		const settings = resolveSettings(ctx.cwd);

		if (!settings.endpoint || !settings.accessToken) {
			// Silently skip — tools will show config message when invoked
			return;
		}

		try {
			initClient(settings);
			ctx.ui.setStatus("pi-penpot", "🎨 penpot");
		} catch (err: any) {
			ctx.ui.notify(`pi-penpot: ${err.message}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		resetClient();
		clearFileCache();
		sessionCtx?.ui.setStatus("pi-penpot", undefined);
		sessionCtx = null;
	});
}
