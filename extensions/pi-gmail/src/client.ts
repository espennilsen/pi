/**
 * pi-gmail — Lightweight Gmail REST API client.
 *
 * No heavy SDK — just fetch() against the Gmail API v1.
 * Handles pagination, message parsing, body decoding, and rate limiting.
 */

import type { GmailAuth } from "./auth.ts";
import type {
	GmailMessage,
	GmailMessageRef,
	GmailAttachment,
	GmailThread,
	GmailLabel,
	GmailListResult,
	GmailThreadListResult,
} from "./types.ts";

// ── Constants ───────────────────────────────────────────────────

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Max results per page (Gmail API max is 500, but 50 is practical) */
const DEFAULT_MAX_RESULTS = 25;

/** Rate limit: minimum ms between requests */
const MIN_REQUEST_INTERVAL_MS = 100;

// ── Concurrency helpers ─────────────────────────────────────────

/** Max concurrent detail-fetches (getMessage/getThread) per list call */
const CONCURRENCY_LIMIT = 5;

/** Run async tasks with bounded concurrency. */
async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const i = nextIndex++;
			results[i] = await fn(items[i]);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

// ── Client ──────────────────────────────────────────────────────

export class GmailClient {
	private auth: GmailAuth;
	/** Promise-based sequential queue for rate limiting */
	private requestQueue: Promise<void> = Promise.resolve();

	constructor(auth: GmailAuth) {
		this.auth = auth;
	}

	// ── Messages ──────────────────────────────────────────────

	/**
	 * List messages matching a Gmail search query.
	 * Returns full message objects (not just refs).
	 */
	async listMessages(options?: {
		query?: string;
		maxResults?: number;
		pageToken?: string;
		labelIds?: string[];
	}): Promise<GmailListResult> {
		const params = new URLSearchParams();
		if (options?.query) params.set("q", options.query);
		params.set("maxResults", String(options?.maxResults ?? DEFAULT_MAX_RESULTS));
		if (options?.pageToken) params.set("pageToken", options.pageToken);
		if (options?.labelIds) {
			for (const id of options.labelIds) params.append("labelIds", id);
		}

		const data = await this.request<{
			messages?: GmailMessageRef[];
			nextPageToken?: string;
			resultSizeEstimate?: number;
		}>(`/messages?${params.toString()}`);

		const refs = data.messages ?? [];
		const messages = await pMap(refs, (ref) => this.getMessage(ref.id), CONCURRENCY_LIMIT);

		return {
			messages,
			nextPageToken: data.nextPageToken,
			resultSizeEstimate: data.resultSizeEstimate ?? 0,
		};
	}

	/**
	 * Get a single message by ID with full content.
	 */
	async getMessage(id: string): Promise<GmailMessage> {
		const data = await this.request<RawMessage>(`/messages/${id}?format=full`);
		return parseMessage(data);
	}

	/**
	 * Search messages with Gmail query syntax.
	 * Convenience wrapper around listMessages.
	 *
	 * Examples:
	 *   search("from:john@example.com")
	 *   search("subject:invoice after:2024/01/01")
	 *   search("is:unread label:inbox")
	 *   search("has:attachment filename:pdf")
	 */
	async search(
		query: string,
		maxResults: number = DEFAULT_MAX_RESULTS,
	): Promise<GmailListResult> {
		return this.listMessages({ query, maxResults });
	}

	// ── Threads ───────────────────────────────────────────────

	/**
	 * List threads matching a query.
	 */
	async listThreads(options?: {
		query?: string;
		maxResults?: number;
		pageToken?: string;
		labelIds?: string[];
	}): Promise<GmailThreadListResult> {
		const params = new URLSearchParams();
		if (options?.query) params.set("q", options.query);
		params.set("maxResults", String(options?.maxResults ?? DEFAULT_MAX_RESULTS));
		if (options?.pageToken) params.set("pageToken", options.pageToken);
		if (options?.labelIds) {
			for (const id of options.labelIds) params.append("labelIds", id);
		}

		const data = await this.request<{
			threads?: { id: string; snippet: string }[];
			nextPageToken?: string;
			resultSizeEstimate?: number;
		}>(`/threads?${params.toString()}`);

		const threadRefs = data.threads ?? [];
		const threads = await pMap(threadRefs, (ref) => this.getThread(ref.id), CONCURRENCY_LIMIT);

		return {
			threads,
			nextPageToken: data.nextPageToken,
			resultSizeEstimate: data.resultSizeEstimate ?? 0,
		};
	}

	/**
	 * Get a full thread with all messages.
	 */
	async getThread(id: string): Promise<GmailThread> {
		const data = await this.request<{
			id: string;
			snippet: string;
			messages: RawMessage[];
		}>(`/threads/${id}?format=full`);

		const messages = data.messages.map(parseMessage);
		return {
			id: data.id,
			snippet: data.snippet,
			messages,
			subject: messages[0]?.subject ?? "(no subject)",
			messageCount: messages.length,
		};
	}

	// ── Labels ────────────────────────────────────────────────

	/**
	 * List all labels.
	 */
	async listLabels(): Promise<GmailLabel[]> {
		const data = await this.request<{ labels: RawLabel[] }>("/labels");
		return data.labels.map((l) => ({
			id: l.id,
			name: l.name,
			type: l.type?.toLowerCase() === "system" ? "system" as const : "user" as const,
			messagesUnread: l.messagesUnread,
			messagesTotal: l.messagesTotal,
		}));
	}

	/**
	 * Get a single label by ID.
	 */
	async getLabel(id: string): Promise<GmailLabel> {
		const data = await this.request<RawLabel>(`/labels/${id}`);
		return {
			id: data.id,
			name: data.name,
			type: data.type?.toLowerCase() === "system" ? "system" : "user",
			messagesUnread: data.messagesUnread,
			messagesTotal: data.messagesTotal,
		};
	}

	/**
	 * Modify labels on a message (add/remove).
	 */
	async modifyMessageLabels(
		messageId: string,
		addLabelIds?: string[],
		removeLabelIds?: string[],
	): Promise<void> {
		await this.request(`/messages/${messageId}/modify`, {
			method: "POST",
			body: JSON.stringify({ addLabelIds, removeLabelIds }),
		});
	}

	// ── Send ──────────────────────────────────────────────────

	/**
	 * Send a new email.
	 */
	async sendMessage(options: {
		to: string;
		subject: string;
		body: string;
		/** Sender address (for alias/send-as). Omit to use primary address. */
		from?: string;
		cc?: string;
		bcc?: string;
		replyTo?: string;
		/** Thread ID for reply-in-thread */
		threadId?: string;
		/** Message-ID header to set In-Reply-To for replies */
		inReplyTo?: string;
	}): Promise<{ id: string; threadId: string }> {
		const headers = [
			`To: ${sanitizeHeader(options.to)}`,
			`Subject: ${encodeHeaderValue(options.subject)}`,
			"Content-Type: text/plain; charset=utf-8",
			`Date: ${new Date().toUTCString()}`,
		];
		if (options.from) headers.unshift(`From: ${sanitizeHeader(options.from)}`);
		if (options.cc) headers.push(`Cc: ${sanitizeHeader(options.cc)}`);
		if (options.bcc) headers.push(`Bcc: ${sanitizeHeader(options.bcc)}`);
		if (options.replyTo) headers.push(`Reply-To: ${sanitizeHeader(options.replyTo)}`);
		if (options.inReplyTo) {
			headers.push(`In-Reply-To: ${options.inReplyTo}`);
			headers.push(`References: ${options.inReplyTo}`);
		}

		const raw = headers.join("\r\n") + "\r\n\r\n" + options.body;
		const encoded = base64UrlEncode(raw);

		const requestBody: Record<string, unknown> = { raw: encoded };
		if (options.threadId) requestBody.threadId = options.threadId;

		const data = await this.request<{ id: string; threadId: string }>("/messages/send", {
			method: "POST",
			body: JSON.stringify(requestBody),
		});

		return { id: data.id, threadId: data.threadId };
	}

	// ── Internal ──────────────────────────────────────────────

	private request<T>(path: string, init?: RequestInit): Promise<T> {
		// Chain requests through a sequential queue so rate limiting
		// works correctly even with concurrent callers.
		const ticket = this.requestQueue.then(() => sleep(MIN_REQUEST_INTERVAL_MS));
		const result = ticket.then(() => this.doRequest<T>(path, init));
		// Update queue to wait for this request to finish (ignore errors for queue chaining)
		this.requestQueue = result.then(() => {}, () => {});
		return result;
	}

	private async doRequest<T>(path: string, init?: RequestInit): Promise<T> {
		const maxRetries = 3;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const headers = await this.auth.getHeaders();
			const url = `${API_BASE}${path}`;
			const res = await fetch(url, {
				...init,
				headers: { ...headers, ...(init?.headers as Record<string, string>) },
			});

			if (res.ok) {
				return (await res.json()) as T;
			}

			const errBody = await res.text();
			lastError = new Error(`Gmail API error (${res.status} ${res.statusText}): ${errBody}`);

			// Retry on 429 (rate limit) and 5xx (transient server errors)
			const retryable = res.status === 429 || res.status >= 500;
			if (!retryable || attempt === maxRetries) {
				throw lastError;
			}

			// Exponential backoff: 1s, 2s, 4s
			const backoff = Math.pow(2, attempt) * 1000;
			await sleep(backoff);
		}

		throw lastError!;
	}
}

// ── Raw Gmail API types ─────────────────────────────────────────

interface RawMessage {
	id: string;
	threadId: string;
	labelIds?: string[];
	snippet: string;
	sizeEstimate: number;
	payload: {
		mimeType: string;
		headers: { name: string; value: string }[];
		body?: { data?: string; size: number; attachmentId?: string };
		parts?: RawPart[];
	};
}

interface RawPart {
	mimeType: string;
	filename?: string;
	headers?: { name: string; value: string }[];
	body?: { data?: string; size: number; attachmentId?: string };
	parts?: RawPart[];
}

interface RawLabel {
	id: string;
	name: string;
	type?: string;
	messagesUnread?: number;
	messagesTotal?: number;
}

// ── Message parsing ─────────────────────────────────────────────

function parseMessage(raw: RawMessage): GmailMessage {
	const headers = raw.payload.headers ?? [];
	const getHeader = (name: string): string =>
		headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

	const attachments: GmailAttachment[] = [];
	const { text, html } = extractBodies(raw.payload, attachments);

	return {
		id: raw.id,
		threadId: raw.threadId,
		labelIds: raw.labelIds ?? [],
		snippet: raw.snippet,
		messageId: getHeader("Message-ID") || getHeader("Message-Id"),
		from: getHeader("From"),
		to: getHeader("To"),
		subject: getHeader("Subject"),
		date: getHeader("Date"),
		body: text,
		htmlBody: html || undefined,
		attachments,
		unread: (raw.labelIds ?? []).includes("UNREAD"),
		sizeEstimate: raw.sizeEstimate,
	};
}

function extractBodies(
	part: { mimeType: string; body?: { data?: string; size: number; attachmentId?: string }; parts?: RawPart[]; filename?: string },
	attachments: GmailAttachment[],
): { text: string; html: string } {
	let text = "";
	let html = "";

	// Check for attachment
	if (part.filename && part.body?.attachmentId) {
		attachments.push({
			attachmentId: part.body.attachmentId,
			filename: part.filename,
			mimeType: part.mimeType,
			size: part.body.size,
		});
		return { text, html };
	}

	// Single part with body data
	if (part.body?.data) {
		const decoded = base64UrlDecode(part.body.data);
		if (part.mimeType === "text/plain") text = decoded;
		else if (part.mimeType === "text/html") html = decoded;
	}

	// Multipart — recurse into parts
	if (part.parts) {
		for (const sub of part.parts) {
			const result = extractBodies(sub, attachments);
			if (result.text) text = text || result.text;
			if (result.html) html = html || result.html;
		}
	}

	return { text, html };
}

// ── Base64url helpers ───────────────────────────────────────────

function base64UrlDecode(data: string): string {
	// Gmail uses URL-safe base64 (replace - with +, _ with /)
	const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(base64, "base64").toString("utf-8");
}

function base64UrlEncode(data: string): string {
	return Buffer.from(data, "utf-8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip \r and \n from header values to prevent header injection attacks.
 */
function sanitizeHeader(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * RFC 2047 encode a header value if it contains non-ASCII characters.
 * Uses =?UTF-8?B?...?= (Base64 encoded-word) syntax.
 * Also sanitizes against header injection.
 */
function encodeHeaderValue(value: string): string {
	value = sanitizeHeader(value);
	// Check if value contains non-ASCII characters
	if (/^[\x20-\x7E]*$/.test(value)) {
		return value; // Pure ASCII, no encoding needed
	}
	const encoded = Buffer.from(value, "utf-8").toString("base64");
	return `=?UTF-8?B?${encoded}?=`;
}
