/**
 * pi-gmail — Type definitions for Gmail API entities.
 */

// ── Message ─────────────────────────────────────────────────────

export interface GmailMessage {
	id: string;
	threadId: string;
	labelIds: string[];
	snippet: string;
	/** Parsed headers for convenience */
	from: string;
	to: string;
	subject: string;
	date: string;
	/** Plain text body (decoded) */
	body: string;
	/** HTML body if present (decoded) */
	htmlBody?: string;
	/** Attachment metadata */
	attachments: GmailAttachment[];
	/** Whether the message is unread */
	unread: boolean;
	/** Raw size estimate in bytes */
	sizeEstimate: number;
}

export interface GmailAttachment {
	attachmentId: string;
	filename: string;
	mimeType: string;
	size: number;
}

/** Minimal message from list endpoint (before full fetch) */
export interface GmailMessageRef {
	id: string;
	threadId: string;
}

// ── Thread ──────────────────────────────────────────────────────

export interface GmailThread {
	id: string;
	snippet: string;
	messages: GmailMessage[];
	/** Aggregated subject from first message */
	subject: string;
	/** Number of messages in thread */
	messageCount: number;
}

// ── Label ───────────────────────────────────────────────────────

export interface GmailLabel {
	id: string;
	name: string;
	type: "system" | "user";
	/** Number of unread messages */
	messagesUnread?: number;
	/** Total messages */
	messagesTotal?: number;
}

// ── List results ────────────────────────────────────────────────

export interface GmailListResult {
	messages: GmailMessage[];
	nextPageToken?: string;
	resultSizeEstimate: number;
}

export interface GmailThreadListResult {
	threads: GmailThread[];
	nextPageToken?: string;
	resultSizeEstimate: number;
}

// ── Config ──────────────────────────────────────────────────────

export interface GmailConfig {
	/** Disable all write operations (default: true) */
	readOnly?: boolean;
	/** Require confirmation before sending (default: true) */
	confirmBeforeSend?: boolean;
}
