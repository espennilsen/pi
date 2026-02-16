/**
 * Gmail REST API client.
 *
 * Thin wrapper over the Gmail API v1 REST endpoints.
 * Uses fetch directly — no heavy SDK.
 */

import type {
	GmailMessage,
	GmailThread,
	GmailLabel,
	GmailDraft,
	MessageListResponse,
	GmailSettings,
} from "./types.ts";
import { getAccessToken } from "./auth.ts";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

// ── Internal helpers ────────────────────────────────────────────

async function gmailFetch(
	settings: GmailSettings,
	agentDir: string,
	path: string,
	options: RequestInit = {},
): Promise<any> {
	const token = await getAccessToken(settings, agentDir);
	const url = `${BASE_URL}${path}`;

	const resp = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			...options.headers,
		},
	});

	if (!resp.ok) {
		const err = await resp.text();
		throw new Error(`Gmail API error: ${resp.status} ${err}`);
	}

	// Handle 204 No Content
	if (resp.status === 204) return null;

	return resp.json();
}

// ── Messages ────────────────────────────────────────────────────

export async function listMessages(
	settings: GmailSettings,
	agentDir: string,
	query?: string,
	maxResults = 20,
	labelIds?: string[],
	pageToken?: string,
): Promise<MessageListResponse> {
	const params = new URLSearchParams();
	if (query) params.set("q", query);
	params.set("maxResults", String(maxResults));
	if (labelIds) {
		for (const label of labelIds) params.append("labelIds", label);
	}
	if (pageToken) params.set("pageToken", pageToken);

	return gmailFetch(settings, agentDir, `/messages?${params.toString()}`);
}

export async function getMessage(
	settings: GmailSettings,
	agentDir: string,
	id: string,
	format: "full" | "metadata" | "minimal" | "raw" = "full",
): Promise<GmailMessage> {
	return gmailFetch(settings, agentDir, `/messages/${encodeURIComponent(id)}?format=${format}`);
}

export async function getThread(
	settings: GmailSettings,
	agentDir: string,
	id: string,
	format: "full" | "metadata" | "minimal" = "full",
): Promise<GmailThread> {
	return gmailFetch(settings, agentDir, `/threads/${encodeURIComponent(id)}?format=${format}`);
}

// ── Labels ──────────────────────────────────────────────────────

export async function listLabels(
	settings: GmailSettings,
	agentDir: string,
): Promise<GmailLabel[]> {
	const data = await gmailFetch(settings, agentDir, "/labels");
	return data.labels ?? [];
}

// ── Modify messages ─────────────────────────────────────────────

export async function modifyMessage(
	settings: GmailSettings,
	agentDir: string,
	id: string,
	addLabelIds?: string[],
	removeLabelIds?: string[],
): Promise<GmailMessage> {
	return gmailFetch(settings, agentDir, `/messages/${encodeURIComponent(id)}/modify`, {
		method: "POST",
		body: JSON.stringify({
			addLabelIds: addLabelIds ?? [],
			removeLabelIds: removeLabelIds ?? [],
		}),
	});
}


// ── Send ────────────────────────────────────────────────────────

export async function sendMessage(
	settings: GmailSettings,
	agentDir: string,
	raw: string,
	threadId?: string,
): Promise<GmailMessage> {
	const body: any = { raw };
	if (threadId) body.threadId = threadId;

	return gmailFetch(settings, agentDir, "/messages/send", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

// ── Drafts ──────────────────────────────────────────────────────

export async function createDraft(
	settings: GmailSettings,
	agentDir: string,
	raw: string,
	threadId?: string,
): Promise<GmailDraft> {
	const message: any = { raw };
	if (threadId) message.threadId = threadId;

	return gmailFetch(settings, agentDir, "/drafts", {
		method: "POST",
		body: JSON.stringify({ message }),
	});
}

export async function sendDraft(
	settings: GmailSettings,
	agentDir: string,
	draftId: string,
): Promise<GmailMessage> {
	return gmailFetch(settings, agentDir, "/drafts/send", {
		method: "POST",
		body: JSON.stringify({ id: draftId }),
	});
}

export async function listDrafts(
	settings: GmailSettings,
	agentDir: string,
	maxResults = 20,
): Promise<GmailDraft[]> {
	const data = await gmailFetch(settings, agentDir, `/drafts?maxResults=${maxResults}`);
	return data.drafts ?? [];
}

export async function getDraft(
	settings: GmailSettings,
	agentDir: string,
	draftId: string,
): Promise<GmailDraft> {
	return gmailFetch(settings, agentDir, `/drafts/${encodeURIComponent(draftId)}?format=full`);
}

export async function deleteDraft(
	settings: GmailSettings,
	agentDir: string,
	draftId: string,
): Promise<void> {
	await gmailFetch(settings, agentDir, `/drafts/${encodeURIComponent(draftId)}`, {
		method: "DELETE",
	});
}

// ── Attachments ─────────────────────────────────────────────────

export async function getAttachment(
	settings: GmailSettings,
	agentDir: string,
	messageId: string,
	attachmentId: string,
): Promise<{ size: number; data: string }> {
	return gmailFetch(
		settings,
		agentDir,
		`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
	);
}

// ── Batch modify ────────────────────────────────────────────────

export async function batchModifyMessages(
	settings: GmailSettings,
	agentDir: string,
	ids: string[],
	addLabelIds?: string[],
	removeLabelIds?: string[],
): Promise<void> {
	await gmailFetch(settings, agentDir, "/messages/batchModify", {
		method: "POST",
		body: JSON.stringify({
			ids,
			addLabelIds: addLabelIds ?? [],
			removeLabelIds: removeLabelIds ?? [],
		}),
	});
}
