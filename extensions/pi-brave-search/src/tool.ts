/**
 * Register the `search` tool for LLM use.
 *
 * Provides web search via Brave Search API. The LLM can search the web
 * for current information, news, documentation, etc.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { search, type SearchOptions } from "./search.ts";

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

export function registerSearchTool(pi: ExtensionAPI, getApiKey: () => string | undefined, getDefaults: () => { count: number; safesearch: string }) {
	pi.registerTool({
		name: "search",
		label: "Web Search",
		description: "Search the web using Brave Search. Returns titles, URLs, and descriptions for each result. Use this to find current information, documentation, news, or answers to questions.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			count: Type.Optional(Type.Number({ description: "Number of results (1-20, default from settings)", minimum: 1, maximum: 20 })),
			freshness: Type.Optional(Type.String({ description: "Time filter: 'pd' (past day), 'pw' (past week), 'pm' (past month), 'py' (past year), or 'YYYY-MM-DDtoYYYY-MM-DD'" })),
			country: Type.Optional(Type.String({ description: "2-letter country code to bias results (e.g. 'US', 'NO', 'GB')" })),
			search_lang: Type.Optional(Type.String({ description: "Language code (e.g. 'en', 'no')" })),
		}),

		async execute(_toolCallId, params, _signal) {
			const apiKey = getApiKey();
			if (!apiKey) {
				return text('Brave Search API key not configured. Add to settings:\n\n"pi-brave-search": { "apiKey": "YOUR_KEY" }\n\nGet a key at https://brave.com/search/api/');
			}

			const defaults = getDefaults();
			const options: SearchOptions = {
				query: params.query,
				count: params.count ?? defaults.count,
				safesearch: defaults.safesearch as SearchOptions["safesearch"],
				freshness: params.freshness,
				country: params.country,
				search_lang: params.search_lang,
			};

			const response = await search(apiKey, options);

			if (response.error) {
				return text(`Search error: ${response.error}`);
			}

			if (response.results.length === 0) {
				return text(`No results found for: ${params.query}`);
			}

			const formatted = response.results.map((r, i) => {
				let entry = `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`;
				if (r.age) entry += `\n   _${r.age}_`;
				return entry;
			}).join("\n\n");

			return text(`Search results for "${response.query}" (${response.results.length} results):\n\n${formatted}`);
		},
	});
}
