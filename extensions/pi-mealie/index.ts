/**
 * pi-mealie — Mealie recipe manager integration for pi.
 *
 * Provides tools for Mealie API access:
 *   - `mealie_recipes` — Browse, search, get, create, update, and delete recipes
 *   - `mealie_mealplans` — Meal planning: today, this week, add/remove meals
 *   - `mealie_shopping` — Shopping lists: view, add items, check off
 *   - `mealie_organizer` — Tags, categories, tools, foods, units
 *
 * Configure in settings.json:
 *   "pi-mealie": {
 *     "baseUrl": "https://mealie.e9n.dev/api",
 *     "apiToken": "<your-mealie-api-token>"
 *   }
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveSettings } from "./settings.ts";
import { initClient, resetClient, isClientReady, mealie, apiList } from "./client.ts";
import { registerRecipesTool } from "./tools/recipes.ts";
import { registerMealplansTool } from "./tools/mealplans.ts";
import { registerShoppingTool } from "./tools/shopping.ts";
import { registerOrganizerTool } from "./tools/organizer.ts";

export default function (pi: ExtensionAPI) {
	// ── Register all tools ────────────────────────────────────
	registerRecipesTool(pi);
	registerMealplansTool(pi);
	registerShoppingTool(pi);
	registerOrganizerTool(pi);

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);

		if (!settings.baseUrl || !settings.apiToken) {
			// Silently skip — tools will show config message when invoked
			return;
		}

		try {
			initClient(settings);
			ctx.ui.setStatus("pi-mealie", "✅ mealie");
		} catch (err: any) {
			ctx.ui.notify(`pi-mealie: ${err.message}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		resetClient();
	});
}