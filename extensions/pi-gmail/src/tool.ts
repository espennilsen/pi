/**
 * pi-gmail — LLM tool registration.
 *
 * Read actions:
 *   - inbox: List recent inbox messages
 *   - unread: List unread messages
 *   - search: Search with Gmail query syntax
 *   - read: Read a specific message by ID
 *   - thread: Read a full thread by ID
 *   - labels: List all labels
 *
 * Write actions:
 *   - compose: Draft a new email (returns preview, does NOT send)
 *   - reply: Draft a reply to a message (returns preview, does NOT send)
 *   - send: Send a previously composed draft (requires draft_id from compose/reply)
 *
 * Safety:
 *   - compose/reply only create drafts — they don't send
 *   - send requires an explicit draft_id from a prior compose/reply
 *   - readOnly mode disables all write actions entirely
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { GmailClient } from "./client.ts";
import type { GmailMessage, GmailThread, GmailConfig } from "./types.ts";

// ── Types ───────────────────────────────────────────────────────

interface GmailToolParams {
	action: "inbox" | "unread" | "search" | "read" | "thread" | "labels" | "compose" | "reply" | "send";
	query?: string;
	id?: string;
	maxResults?: number;
	to?: string;
	subject?: string;
	body?: string;
	cc?: string;
	bcc?: string;
	draft_id?: string;
}

// ── Draft store (in-memory, per session) ────────────────────────

interface Draft {
	id: string;
	to: string;
	subject: string;
	body: string;
	cc?: string;
	bcc?: string;
	threadId?: string;
	inReplyTo?: string;
	createdAt: number;
}

const drafts = new Map<string, Draft>();
let draftCounter = 0;

/** Max number of drafts kept in memory */
const MAX_DRAFTS = 20;
/** Draft TTL: 30 minutes */
const DRAFT_TTL_MS = 30 * 60 * 1000;

function createDraft(data: Omit<Draft, "id" | "createdAt">): Draft {
	// Expire old drafts
	const now = Date.now();
	for (const [id, d] of drafts) {
		if (now - d.createdAt > DRAFT_TTL_MS) drafts.delete(id);
	}
	// Evict oldest if at capacity
	while (drafts.size >= MAX_DRAFTS) {
		const oldest = drafts.keys().next().value!;
		drafts.delete(oldest);
	}

	const draft: Draft = {
		...data,
		id: `draft-${++draftCounter}`,
		createdAt: now,
	};
	drafts.set(draft.id, draft);
	return draft;
}

// ── Tool registration ───────────────────────────────────────────

export function registerGmailTool(
	pi: ExtensionAPI,
	getClient: () => GmailClient | null,
	getConfig: () => GmailConfig,
): void {
	pi.registerTool({
		name: "gmail",
		label: "Gmail",
		description:
			"Read, search, compose, and send Gmail. " +
			"Read: inbox, unread, search (Gmail query), read (message by ID), thread, labels. " +
			"Write: compose (create draft), reply (draft reply), send (send a draft by draft_id). " +
			"Compose and reply only create drafts — use send with the returned draft_id to actually send.",
		parameters: Type.Object({
			action: StringEnum(
				["inbox", "unread", "search", "read", "thread", "labels", "compose", "reply", "send"] as const,
				{ description: "Action to perform" },
			) as any,
			query: Type.Optional(
				Type.String({
					description:
						"Gmail search query (for search action). Examples: 'from:john@example.com', 'subject:invoice after:2024/01/01', 'is:unread label:important'",
				}),
			),
			id: Type.Optional(
				Type.String({ description: "Message or thread ID (for read/thread/reply actions)" }),
			),
			maxResults: Type.Optional(
				Type.Number({
					description: "Max results to return (default: 10, max: 50)",
					minimum: 1,
					maximum: 50,
				}),
			),
			to: Type.Optional(
				Type.String({ description: "Recipient email (for compose)" }),
			),
			subject: Type.Optional(
				Type.String({ description: "Email subject (for compose)" }),
			),
			body: Type.Optional(
				Type.String({ description: "Email body text (for compose/reply)" }),
			),
			cc: Type.Optional(
				Type.String({ description: "CC recipients (for compose)" }),
			),
			bcc: Type.Optional(
				Type.String({ description: "BCC recipients (for compose)" }),
			),
			draft_id: Type.Optional(
				Type.String({ description: "Draft ID from compose/reply to send (for send action)" }),
			),
		}) as any,

		async execute(_toolCallId, _params) {
			const params = _params as GmailToolParams;
			const client = getClient();

			if (!client) {
				return textResult(
					"Gmail not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN. Run /gmail-setup for instructions.",
				);
			}

			const max = Math.min(params.maxResults ?? 10, 50);

			try {
				switch (params.action) {
					case "inbox": {
						const result = await client.listMessages({
							query: "in:inbox",
							maxResults: max,
						});
						return formatMessageList("Inbox", result.messages, result.resultSizeEstimate);
					}

					case "unread": {
						const result = await client.listMessages({
							query: "is:unread",
							maxResults: max,
						});
						return formatMessageList("Unread", result.messages, result.resultSizeEstimate);
					}

					case "search": {
						if (!params.query) {
							return textResult("Missing required parameter: query");
						}
						const result = await client.search(params.query, max);
						return formatMessageList(
							`Search: ${params.query}`,
							result.messages,
							result.resultSizeEstimate,
						);
					}

					case "read": {
						if (!params.id) {
							return textResult("Missing required parameter: id");
						}
						const msg = await client.getMessage(params.id);
						return formatFullMessage(msg);
					}

					case "thread": {
						if (!params.id) {
							return textResult("Missing required parameter: id");
						}
						const thread = await client.getThread(params.id);
						return formatThread(thread);
					}

					case "labels": {
						const labels = await client.listLabels();
						const userLabels = labels.filter((l) => l.type === "user");
						const systemLabels = labels.filter((l) => l.type === "system");

						const lines: string[] = ["## Labels"];

						if (userLabels.length > 0) {
							lines.push("", "### User Labels");
							for (const l of userLabels) {
								const stats =
									l.messagesTotal != null
										? ` (${l.messagesTotal} messages, ${l.messagesUnread ?? 0} unread)`
										: "";
								lines.push(`- **${l.name}**${stats} — id: \`${l.id}\``);
							}
						}

						lines.push("", "### System Labels");
						for (const l of systemLabels) {
							const stats =
								l.messagesTotal != null
									? ` (${l.messagesTotal} messages, ${l.messagesUnread ?? 0} unread)`
									: "";
							lines.push(`- **${l.name}**${stats} — id: \`${l.id}\``);
						}

						return textResult(lines.join("\n"));
					}

					case "compose": {
						const config = getConfig();
						if (config.readOnly) {
							return textResult("Gmail is in read-only mode. Write operations are disabled.");
						}
						if (!params.to || !params.subject || !params.body) {
							return textResult("Missing required parameters: to, subject, body");
						}
						const draft = createDraft({
							to: params.to,
							subject: params.subject,
							body: params.body,
							cc: params.cc,
							bcc: params.bcc,
						});
						return textResult(formatDraftPreview(draft, "New Email Draft"));
					}

					case "reply": {
						const config = getConfig();
						if (config.readOnly) {
							return textResult("Gmail is in read-only mode. Write operations are disabled.");
						}
						if (!params.id || !params.body) {
							return textResult("Missing required parameters: id (message to reply to), body");
						}
						// Fetch the original message for reply metadata
						const original = await client.getMessage(params.id);
						const replySubject = original.subject.startsWith("Re: ")
							? original.subject
							: `Re: ${original.subject}`;

						// Use RFC 2822 Message-ID for In-Reply-To/References headers
						const draft = createDraft({
							to: original.from,
							subject: replySubject,
							body: params.body,
							threadId: original.threadId,
							inReplyTo: original.messageId || undefined,
						});
						return textResult(formatDraftPreview(draft, `Reply to: ${original.from}`));
					}

					case "send": {
						const config = getConfig();
						if (config.readOnly) {
							return textResult("Gmail is in read-only mode. Write operations are disabled.");
						}
						// confirmBeforeSend is enforced by the draft-based flow:
						// the agent must first compose/reply (creating a draft for user review)
						// then explicitly call send with the draft_id.
						if (!params.draft_id) {
							if (config.confirmBeforeSend) {
								return textResult("Confirmation required: use compose or reply first to create a draft, then send with the returned draft_id.");
							}
							return textResult("Missing required parameter: draft_id. Use compose or reply first to create a draft.");
						}
						const draft = drafts.get(params.draft_id);
						if (!draft) {
							return textResult(`Draft not found: ${params.draft_id}. Available drafts: ${[...drafts.keys()].join(", ") || "none"}`);
						}
						const result = await client.sendMessage({
							to: draft.to,
							subject: draft.subject,
							body: draft.body,
							cc: draft.cc,
							bcc: draft.bcc,
							threadId: draft.threadId,
							inReplyTo: draft.inReplyTo,
						});
						drafts.delete(params.draft_id);
						return textResult(
							`✅ Email sent successfully!\n\n` +
							`- **To:** ${draft.to}\n` +
							`- **Subject:** ${draft.subject}\n` +
							`- **Message ID:** \`${result.id}\`\n` +
							`- **Thread ID:** \`${result.threadId}\``,
						);
					}

					default:
						return textResult(`Unknown action: ${params.action}`);
				}
			} catch (err: any) {
				return textResult(`Gmail error: ${err.message}`);
			}
		},
	});
}

// ── Formatters ──────────────────────────────────────────────────

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: {} };
}

function formatMessageList(
	title: string,
	messages: GmailMessage[],
	total: number,
) {
	if (messages.length === 0) {
		return textResult(`## ${title}\n\nNo messages found.`);
	}

	const lines: string[] = [`## ${title} (${messages.length} of ~${total})`];

	for (const msg of messages) {
		const unread = msg.unread ? "🔵 " : "";
		const attachIcon = msg.attachments.length > 0 ? " 📎" : "";
		lines.push("");
		lines.push(
			`### ${unread}${truncate(msg.subject || "(no subject)", 80)}${attachIcon}`,
		);
		lines.push(`- **From:** ${msg.from}`);
		lines.push(`- **Date:** ${msg.date}`);
		lines.push(`- **ID:** \`${msg.id}\` | **Thread:** \`${msg.threadId}\``);
		if (msg.snippet) {
			lines.push(`- ${truncate(msg.snippet, 150)}`);
		}
	}

	return textResult(lines.join("\n"));
}

function formatFullMessage(msg: GmailMessage) {
	const lines: string[] = [
		`## ${msg.subject || "(no subject)"}`,
		"",
		`| Field | Value |`,
		`|-------|-------|`,
		`| From | ${msg.from} |`,
		`| To | ${msg.to} |`,
		`| Date | ${msg.date} |`,
		`| ID | \`${msg.id}\` |`,
		`| Thread | \`${msg.threadId}\` |`,
		`| Labels | ${msg.labelIds.join(", ") || "none"} |`,
		`| Unread | ${msg.unread ? "Yes" : "No"} |`,
	];

	if (msg.attachments.length > 0) {
		lines.push("");
		lines.push("### Attachments");
		for (const att of msg.attachments) {
			lines.push(
				`- **${att.filename}** (${att.mimeType}, ${formatBytes(att.size)})`,
			);
		}
	}

	lines.push("", "### Body", "");
	lines.push(msg.body || "(empty body)");

	return textResult(lines.join("\n"));
}

function formatThread(thread: GmailThread) {
	const lines: string[] = [
		`## Thread: ${thread.subject}`,
		`**${thread.messageCount} messages** | Thread ID: \`${thread.id}\``,
	];

	for (let i = 0; i < thread.messages.length; i++) {
		const msg = thread.messages[i];
		const unread = msg.unread ? "🔵 " : "";
		lines.push("");
		lines.push(`---`);
		lines.push(
			`### ${unread}Message ${i + 1}/${thread.messageCount}`,
		);
		lines.push(`**From:** ${msg.from} | **Date:** ${msg.date}`);
		lines.push(`**ID:** \`${msg.id}\``);
		lines.push("");
		// Truncate individual messages in a thread to keep output manageable
		const body = msg.body || "(empty)";
		lines.push(body.length > 2000 ? body.slice(0, 2000) + "\n\n[...truncated]" : body);
	}

	return textResult(lines.join("\n"));
}

function formatDraftPreview(draft: Draft, title: string): string {
	const lines = [
		`## 📝 ${title}`,
		"",
		`| Field | Value |`,
		`|-------|-------|`,
		`| To | ${draft.to} |`,
		`| Subject | ${draft.subject} |`,
	];
	if (draft.cc) lines.push(`| CC | ${draft.cc} |`);
	if (draft.bcc) lines.push(`| BCC | ${draft.bcc} |`);
	if (draft.threadId) lines.push(`| Thread | \`${draft.threadId}\` |`);
	lines.push(`| Draft ID | \`${draft.id}\` |`);
	lines.push("", "### Body", "", draft.body);
	lines.push(
		"",
		"---",
		`⚠️ **This is a draft. To send, use: gmail send with draft_id="${draft.id}"**`,
	);
	return lines.join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max) + "…";
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
