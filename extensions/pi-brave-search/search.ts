/**
 * Brave Web Search API client.
 *
 * API docs: https://api.search.brave.com/app/documentation/web-search/query
 *
 * Endpoint: GET https://api.search.brave.com/res/v1/web/search
 * Auth: X-Subscription-Token header
 */

const BASE_URL = "https://api.search.brave.com/res/v1/web/search";

// ── Types ───────────────────────────────────────────────────────

export interface SearchOptions {
	query: string;
	count?: number;           // 1-20 (default 5)
	offset?: number;          // pagination offset
	safesearch?: "off" | "moderate" | "strict";
	freshness?: string;       // pd (past day), pw (past week), pm (past month), py (past year), or YYYY-MM-DDtoYYYY-MM-DD
	country?: string;         // 2-letter country code
	search_lang?: string;     // language code (en, no, etc.)
	result_filter?: string;   // comma-separated: web, news, video, infobox
}

export interface SearchResult {
	title: string;
	url: string;
	description: string;
	age?: string;             // e.g. "2 hours ago"
	language?: string;
	family_friendly?: boolean;
}

export interface SearchResponse {
	query: string;
	results: SearchResult[];
	total_estimated?: number;
	error?: string;
}

// ── Raw API response types ──────────────────────────────────────

interface BraveWebResult {
	title?: string;
	url?: string;
	description?: string;
	age?: string;
	language?: string;
	family_friendly?: boolean;
}

interface BraveApiResponse {
	query?: { original?: string };
	web?: { results?: BraveWebResult[] };
	mixed?: { main?: Array<{ type?: string; index?: number }> };
	error?: { code?: string; detail?: string };
}

// ── Client ──────────────────────────────────────────────────────

export async function search(apiKey: string, options: SearchOptions): Promise<SearchResponse> {
	const params = new URLSearchParams();
	params.set("q", options.query);
	if (options.count) params.set("count", String(Math.min(20, Math.max(1, options.count))));
	if (options.offset) params.set("offset", String(options.offset));
	if (options.safesearch) params.set("safesearch", options.safesearch);
	if (options.freshness) params.set("freshness", options.freshness);
	if (options.country) params.set("country", options.country);
	if (options.search_lang) params.set("search_lang", options.search_lang);
	if (options.result_filter) params.set("result_filter", options.result_filter);

	const url = `${BASE_URL}?${params.toString()}`;

	const res = await fetch(url, {
		headers: {
			"Accept": "application/json",
			"Accept-Encoding": "gzip",
			"X-Subscription-Token": apiKey,
		},
	});

	if (!res.ok) {
		const body = await res.text();
		let detail = `HTTP ${res.status}`;
		try {
			const err = JSON.parse(body);
			detail = err.error?.detail ?? err.error?.code ?? detail;
		} catch { /* ignore parse errors */ }
		return { query: options.query, results: [], error: detail };
	}

	const data: BraveApiResponse = await res.json();

	if (data.error) {
		return { query: options.query, results: [], error: data.error.detail ?? data.error.code };
	}

	const results: SearchResult[] = (data.web?.results ?? []).map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		description: r.description ?? "",
		age: r.age,
		language: r.language,
		family_friendly: r.family_friendly,
	}));

	return {
		query: data.query?.original ?? options.query,
		results,
	};
}
