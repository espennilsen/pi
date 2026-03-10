/**
 * pi-penpot — HTTP client for Penpot REST API.
 *
 * All Penpot API calls go through /api/rpc/command/<command-name>.
 * Auth via `Authorization: Token <access-token>` header.
 * JSON content negotiation via Accept header.
 */

import type { PenpotSettings } from "./settings.ts";

let _endpoint: string | null = null;
let _token: string | null = null;

export function initClient(settings: PenpotSettings): void {
	if (!settings.endpoint) throw new Error("pi-penpot: 'endpoint' is required in settings");
	if (!settings.accessToken) throw new Error("pi-penpot: 'accessToken' is required in settings");

	// Normalize endpoint: strip trailing slash
	_endpoint = settings.endpoint.replace(/\/+$/, "");
	_token = settings.accessToken;
}

export function isClientReady(): boolean {
	return _endpoint !== null && _token !== null;
}

export function getEndpoint(): string {
	if (!_endpoint) throw new Error("Penpot client not initialized");
	return _endpoint;
}

export function resetClient(): void {
	_endpoint = null;
	_token = null;
}

/** Penpot API error shape */
export interface PenpotError {
	type: string;
	code: string;
	hint?: string;
	message?: string;
}

/** Make a GET request to a Penpot command endpoint (for get-* commands without params). */
export async function apiGet<T = any>(
	command: string,
	params?: Record<string, any>,
	signal?: AbortSignal,
): Promise<T> {
	assertReady();

	let url = `${_endpoint}/api/rpc/command/${command}`;

	// Append query params for GET
	if (params && Object.keys(params).length > 0) {
		const qs = new URLSearchParams();
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== null) {
				qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
			}
		}
		url += `?${qs.toString()}`;
	}

	const resp = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Token ${_token}`,
			Accept: "application/json",
		},
		signal,
	});

	return handleResponse<T>(resp, command);
}

/** Make a POST request to a Penpot command endpoint. */
export async function apiPost<T = any>(
	command: string,
	body: Record<string, any> = {},
	signal?: AbortSignal,
): Promise<T> {
	assertReady();

	const url = `${_endpoint}/api/rpc/command/${command}`;

	const resp = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Token ${_token}`,
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal,
	});

	return handleResponse<T>(resp, command);
}

/** Upload a file to a Penpot endpoint (multipart/form-data). */
export async function apiUpload<T = any>(
	command: string,
	formData: FormData,
	signal?: AbortSignal,
): Promise<T> {
	assertReady();

	const url = `${_endpoint}/api/rpc/command/${command}`;

	const resp = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Token ${_token}`,
			Accept: "application/json",
			// Don't set Content-Type — fetch sets it with boundary for FormData
		},
		body: formData,
		signal,
	});

	return handleResponse<T>(resp, command);
}

/** Download binary data from a Penpot endpoint. */
export async function apiDownload(
	command: string,
	body: Record<string, any> = {},
	signal?: AbortSignal,
): Promise<{ data: Buffer; contentType: string }> {
	assertReady();

	const url = `${_endpoint}/api/rpc/command/${command}`;

	const resp = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Token ${_token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal,
	});

	if (!resp.ok) {
		const text = await resp.text();
		let hint = text;
		try {
			const err = JSON.parse(text) as PenpotError;
			hint = err.hint || err.message || err.code || text;
		} catch { /* raw text */ }
		throw new Error(`Penpot ${command} failed (${resp.status}): ${hint}`);
	}

	const arrayBuffer = await resp.arrayBuffer();
	return {
		data: Buffer.from(arrayBuffer),
		contentType: resp.headers.get("content-type") || "application/octet-stream",
	};
}

/** Make a POST request with Transit+JSON content type.
 *  Body is a pre-encoded Transit string.
 *  Response is still decoded as JSON (Accept: application/json). */
export async function apiPostTransit<T = any>(
	command: string,
	transitBody: string,
	signal?: AbortSignal,
): Promise<T> {
	assertReady();

	const url = `${_endpoint}/api/rpc/command/${command}`;

	const resp = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Token ${_token}`,
			Accept: "application/json",
			"Content-Type": "application/transit+json",
		},
		body: transitBody,
		signal,
	});

	return handleResponse<T>(resp, command);
}

// ── Internal ────────────────────────────────────────────────────

function assertReady(): void {
	if (!_endpoint || !_token) {
		throw new Error(
			'Penpot client not configured. Add endpoint and accessToken to settings under "pi-penpot".',
		);
	}
}

async function handleResponse<T>(resp: Response, command: string): Promise<T> {
	const text = await resp.text();

	if (!resp.ok) {
		let hint = text;
		try {
			const err = JSON.parse(text) as PenpotError;
			hint = err.hint || err.message || err.code || text;
		} catch { /* raw text */ }
		throw new Error(`Penpot ${command} failed (${resp.status}): ${hint}`);
	}

	if (!text || text.trim() === "") {
		return {} as T;
	}

	try {
		return JSON.parse(text) as T;
	} catch {
		// Some endpoints return non-JSON (e.g., empty 200)
		return text as unknown as T;
	}
}
