/**
 * pi-brave-search — Web search extension for pi via Brave Search API.
 *
 * Provides a `search` tool that the LLM can use to search the web for
 * current information, news, documentation, etc.
 *
 * Also provides a `/search` command for quick searches from the TUI.
 *
 * Settings:
 *   "pi-brave-search": {
 *     "apiKey": "BSA...",          // Brave Search API subscription token (required)
 *     "defaultCount": 5,           // Default number of results (1-20)
 *     "safesearch": "moderate"     // off | moderate | strict
 *   }
 *
 * Get an API key at: https://brave.com/search/api/
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { getSettings, type BraveSearchSettings } from "./settings.ts";
import { registerSearchTool } from "./tool.ts";
import { search } from "./search.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	let settings: BraveSearchSettings = {};

	pi.on("session_start", async (_event, ctx) => {
		settings = getSettings(ctx.cwd);

		if (settings.apiKey) {
			log("init", { status: "ready", defaultCount: settings.defaultCount ?? 5 });
		} else {
			log("init", { status: "no-api-key" }, "WARNING");
		}
	});

	// ── Search tool for LLM ─────────────────────────────────────

	registerSearchTool(
		pi,
		() => settings.apiKey,
		() => ({
			count: settings.defaultCount ?? 5,
			safesearch: settings.safesearch ?? "moderate",
		}),
	);

	// ── /search command for TUI ─────────────────────────────────

	pi.registerCommand("search", {
		description: "Search the web: /search <query>",
		handler: async (args, ctx) => {
			const query = args?.trim();
			if (!query) {
				ctx.ui.notify("Usage: /search <query>", "error");
				return;
			}

			if (!settings.apiKey) {
				ctx.ui.notify(
					'Brave Search API key not configured.\nAdd to settings: "pi-brave-search": { "apiKey": "YOUR_KEY" }\nGet a key at https://brave.com/search/api/',
					"error",
				);
				return;
			}

			const response = await search(settings.apiKey, {
				query,
				count: settings.defaultCount ?? 5,
				safesearch: settings.safesearch as "off" | "moderate" | "strict" ?? "moderate",
			});

			if (response.error) {
				ctx.ui.notify(`Search error: ${response.error}`, "error");
				return;
			}

			if (response.results.length === 0) {
				ctx.ui.notify(`No results for: ${query}`, "info");
				return;
			}

			const lines = response.results.map((r, i) =>
				`${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}${r.age ? ` (${r.age})` : ""}`,
			);

			ctx.ui.notify(lines.join("\n\n"), "info");
		},
	});
}
