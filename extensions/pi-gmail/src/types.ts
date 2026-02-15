/**
 * Gmail extension types.
 */

// ── OAuth tokens ────────────────────────────────────────────────

export interface OAuthTokens {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	scope: string;
	email: string;
}

// ── Gmail API types ─────────────────────────────────────────────

export interface GmailHeader {
	name: string;
	value: string;
}

export interface GmailMessagePartBody {
	attachmentId?: string;
	size: number;
	data?: string; // base64url-encoded
}

export interface GmailMessagePart {
	partId?: string;
	mimeType: string;
	filename?: string;
	headers?: GmailHeader[];
	body?: GmailMessagePartBody;
	parts?: GmailMessagePart[];
}

export interface GmailMessage {
	id: string;
	threadId: string;
	labelIds?: string[];
	snippet: string;
	historyId?: string;
	internalDate?: string;
	payload?: GmailMessagePart;
	sizeEstimate?: number;
	raw?: string;
}

export interface GmailThread {
	id: string;
	historyId?: string;
	messages?: GmailMessage[];
}

export interface GmailLabel {
	id: string;
	name: string;
	type: "system" | "user";
	messageListVisibility?: string;
	labelListVisibility?: string;
	messagesTotal?: number;
	messagesUnread?: number;
	threadsTotal?: number;
	threadsUnread?: number;
}

export interface GmailDraft {
	id: string;
	message: GmailMessage;
}

export interface MessageListResponse {
	messages?: Array<{ id: string; threadId: string }>;
	nextPageToken?: string;
	resultSizeEstimate?: number;
}

export interface ThreadListResponse {
	threads?: Array<{ id: string; snippet: string; historyId: string }>;
	nextPageToken?: string;
	resultSizeEstimate?: number;
}

// ── Attachment info (parsed from message parts) ─────────────────

export interface AttachmentInfo {
	filename: string;
	mimeType: string;
	size: number;
	attachmentId: string;
	messageId: string;
}

// ── Parsed email (formatted for LLM consumption) ───────────────

export interface ParsedEmail {
	id: string;
	threadId: string;
	from: string;
	to: string;
	cc: string;
	bcc: string;
	subject: string;
	date: string;
	snippet: string;
	body: string;
	labels: string[];
	attachments: AttachmentInfo[];
	isUnread: boolean;
}

// ── Settings ────────────────────────────────────────────────────

export interface GmailSettings {
	clientId?: string;
	clientSecret?: string;
	maxResults?: number;
}
