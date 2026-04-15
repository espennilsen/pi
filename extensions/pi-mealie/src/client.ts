/**
 * Mealie API client — thin fetch-based wrapper over the Mealie REST API.
 *
 * Handles authentication, pagination, and error reporting.
 */

import type { MealieSettings } from "./settings.ts";

let baseUrl: string | null = null;
let apiToken: string | null = null;

export function initClient(settings: MealieSettings): void {
	baseUrl = (settings.baseUrl || "").replace(/\/+$/, "") || null;
	apiToken = settings.apiToken || null;
}

export function resetClient(): void {
	baseUrl = null;
	apiToken = null;
}

export function isClientReady(): boolean {
	return baseUrl !== null && apiToken !== null;
}

function assertClient(): { url: string; headers: Record<string, string> } {
	if (!baseUrl || !apiToken) {
		throw new Error("Mealie client not configured. Set pi-mealie.baseUrl and pi-mealie.apiToken in settings.json");
	}
	return {
		url: baseUrl!,
		headers: {
			"Authorization": `Bearer ${apiToken!}`,
			"Content-Type": "application/json",
			"Accept": "application/json",
		},
	};
}

/** Generic API request with error handling. */
export async function api<T>(
	method: string,
	path: string,
	opts?: { body?: unknown; params?: Record<string, string | number | undefined>; signal?: AbortSignal },
): Promise<T> {
	const { url, headers } = assertClient();
	const params = new URLSearchParams();
	if (opts?.params) {
		for (const [k, v] of Object.entries(opts.params)) {
			if (v !== undefined && v !== null) params.set(k, String(v));
		}
	}
	const qs = params.toString() ? `?${params.toString()}` : "";
	const fullUrl = `${url}${path}${qs}`;

	const res = await fetch(fullUrl, {
		method,
		headers,
		body: opts?.body ? JSON.stringify(opts.body) : undefined,
		signal: opts?.signal ?? AbortSignal.timeout(15_000),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		const safeText = text.length > 200 ? text.slice(0, 200) + "..." : text;
		throw new Error(`Mealie API ${res.status}: ${safeText || res.statusText} [${method} ${path}]`);
	}

	// Some DELETE endpoints return 200 with empty body
	if (res.status === 204 || res.headers.get("content-length") === "0") {
		return undefined as T;
	}

	return res.json() as Promise<T>;
}

/** Paginated list endpoint — fetches all pages automatically. */
export async function apiList<T>(
	path: string,
	opts?: { params?: Record<string, string | number | undefined>; pageSize?: number; signal?: AbortSignal },
): Promise<T[]> {
	const perPage = opts?.pageSize ?? 50;
	let page = 1;
	let allItems: T[] = [];

	const MAX_PAGES = 200;
	while (page <= MAX_PAGES) {
		const result = await api<{ items: T[]; total: number; page: number; total_pages: number }>(
			"GET", path,
			{ params: { ...opts?.params, page, perPage }, signal: opts?.signal },
		);
		allItems = allItems.concat(result.items);
		if (page >= result.total_pages) break;
		page++;
	}

	return allItems;
}

/** Convenience methods for common patterns */
export const mealie = {
	get: <T>(path: string, params?: Record<string, string | number | undefined>, signal?: AbortSignal) =>
		api<T>("GET", path, { params, signal }),

	post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
		api<T>("POST", path, { body, signal }),

	put: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
		api<T>("PUT", path, { body, signal }),

	patch: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
		api<T>("PATCH", path, { body, signal }),

	delete: <T>(path: string, signal?: AbortSignal) =>
		api<T>("DELETE", path, { signal }),
};