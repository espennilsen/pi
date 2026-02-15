/**
 * Gmail tool for the LLM.
 *
 * Actions: search, read, read_thread, list_inbox, list_unread, list_labels,
 *          compose, reply, send, send_draft, list_drafts, delete_draft,
 *          archive, trash, label, mark_read, mark_unread,
 *          download_attachment
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import * as client from "./client.ts";
import {
	parseMessage,
	formatEmail,
	formatThread,
	formatMessageList,
	formatSearchResult,
	buildRawMessage,
} from "./formatter.ts";
import { isAuthenticated, getAuthenticatedEmail } from "./auth.ts";
import type { GmailSettings, GmailMessage } from "./types.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const ACTIONS = [
	"search",
	"read",
	"read_thread",
	"list_inbox",
	"list_unread",
	"list_labels",
	"compose",
	"reply",
	"send",
	"send_draft",
	"list_drafts",
	"delete_draft",
	"archive",
	"trash",
	"label",
	"mark_read",
	"mark_unread",
	"download_attachment",
] as const;

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

export function registerGmailTool(
	pi: ExtensionAPI,
	getSettings: () => GmailSettings,
): void {
	pi.registerTool({
		name: "gmail",
		label: "Gmail",
		description:
			"Manage Gmail. " +
			"Actions: search (Gmail query syntax), read (single email), read_thread (full conversation), " +
			"list_inbox (recent inbox), list_unread (unread messages), list_labels (all labels), " +
			"compose (create draft), reply (reply to thread), send (compose+send immediately), " +
			"send_draft (send existing draft), list_drafts, delete_draft, " +
			"archive, trash, label (add/remove labels), mark_read, mark_unread, " +
			"download_attachment (save attachment to disk). " +
			"Search supports Gmail query syntax: from:, to:, subject:, has:attachment, " +
			"is:unread, is:starred, after:YYYY/MM/DD, before:YYYY/MM/DD, label:, in:sent, etc.",
		parameters: Type.Object({
			action: StringEnum(ACTIONS, {
				description: "Operation to perform",
			}),
			// Read/identify
			id: Type.Optional(
				Type.String({ description: "Message ID (for read, archive, trash, etc.)" }),
			),
			thread_id: Type.Optional(
				Type.String({ description: "Thread ID (for read_thread, reply)" }),
			),
			// Search
			query: Type.Optional(
				Type.String({ description: "Gmail search query (for search, list_unread)" }),
			),
			max_results: Type.Optional(
				Type.Number({ description: "Max results (default: 20)" }),
			),
			// Compose/send
			to: Type.Optional(
				Type.String({ description: "Recipient(s), comma-separated" }),
			),
			cc: Type.Optional(
				Type.String({ description: "CC recipients" }),
			),
			bcc: Type.Optional(
				Type.String({ description: "BCC recipients" }),
			),
			subject: Type.Optional(
				Type.String({ description: "Email subject" }),
			),
			body: Type.Optional(
				Type.String({ description: "Email body (plain text)" }),
			),
			reply_all: Type.Optional(
				Type.Boolean({ description: "Reply to all recipients (default: false)" }),
			),
			// Draft
			draft_id: Type.Optional(
				Type.String({ description: "Draft ID (for send_draft, delete_draft)" }),
			),
			// Label management
			ids: Type.Optional(
				Type.Array(Type.String(), { description: "Message IDs (for batch operations)" }),
			),
			add_labels: Type.Optional(
				Type.Array(Type.String(), { description: "Label IDs to add" }),
			),
			remove_labels: Type.Optional(
				Type.Array(Type.String(), { description: "Label IDs to remove" }),
			),
			// Attachments
			attachment_id: Type.Optional(
				Type.String({ description: "Attachment ID (for download_attachment)" }),
			),
			save_path: Type.Optional(
				Type.String({ description: "Path to save attachment (for download_attachment)" }),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const agentDir = getAgentDir();
			const settings = getSettings();

			if (!isAuthenticated(agentDir)) {
				return text("❌ Not authenticated. Run `/gmail-auth` to connect your Gmail account.");
			}

			const maxResults = params.max_results ?? settings.maxResults ?? 20;

			switch (params.action) {
				// ── Read operations ─────────────────────────────

				case "search": {
					if (!params.query) return text("Missing required field: query");
					const list = await client.listMessages(settings, agentDir, params.query, maxResults);
					if (!list.messages || list.messages.length === 0) {
						return text(`No results for: ${params.query}`);
					}
					// Fetch full messages for formatting
					const messages = await fetchMessages(settings, agentDir, list.messages.map((m) => m.id));
					return text(formatMessageList(messages, `Search: "${params.query}"`));
				}

				case "read": {
					if (!params.id) return text("Missing required field: id");
					const msg = await client.getMessage(settings, agentDir, params.id);
					const parsed = parseMessage(msg);
					return text(formatEmail(parsed));
				}

				case "read_thread": {
					if (!params.thread_id) return text("Missing required field: thread_id");
					const thread = await client.getThread(settings, agentDir, params.thread_id);
					return text(formatThread(thread));
				}

				case "list_inbox": {
					const list = await client.listMessages(settings, agentDir, undefined, maxResults, ["INBOX"]);
					if (!list.messages || list.messages.length === 0) {
						return text("Inbox is empty.");
					}
					const messages = await fetchMessages(settings, agentDir, list.messages.map((m) => m.id));
					return text(formatMessageList(messages, "Inbox"));
				}

				case "list_unread": {
					const query = params.query
						? `is:unread ${params.query}`
						: "is:unread";
					const list = await client.listMessages(settings, agentDir, query, maxResults);
					if (!list.messages || list.messages.length === 0) {
						return text("No unread messages.");
					}
					const messages = await fetchMessages(settings, agentDir, list.messages.map((m) => m.id));
					return text(formatMessageList(messages, "Unread"));
				}

				case "list_labels": {
					const labels = await client.listLabels(settings, agentDir);
					const lines = labels.map((l) => {
						const unread = l.messagesUnread ? ` (${l.messagesUnread} unread)` : "";
						return `- **${l.name}** — ID: ${l.id}${unread}`;
					});
					return text(`**Labels (${labels.length}):**\n\n${lines.join("\n")}`);
				}

				// ── Compose operations ──────────────────────────

				case "compose": {
					if (!params.to) return text("Missing required field: to");
					if (!params.subject) return text("Missing required field: subject");
					if (!params.body) return text("Missing required field: body");

					const email = getAuthenticatedEmail(agentDir);
					const raw = buildRawMessage({
						from: email ?? undefined,
						to: params.to,
						cc: params.cc,
						bcc: params.bcc,
						subject: params.subject,
						body: params.body,
					});

					const draft = await client.createDraft(settings, agentDir, raw);
					return text(
						`✓ Draft created (ID: ${draft.id})\n` +
						`  To: ${params.to}\n` +
						`  Subject: ${params.subject}\n\n` +
						`Use action "send_draft" with draft_id="${draft.id}" to send, or continue editing in Gmail.`,
					);
				}

				case "reply": {
					if (!params.thread_id) return text("Missing required field: thread_id");
					if (!params.body) return text("Missing required field: body");

					// Get the thread to find the last message
					const thread = await client.getThread(settings, agentDir, params.thread_id);
					if (!thread.messages || thread.messages.length === 0) {
						return text("Thread not found or empty.");
					}

					const lastMsg = thread.messages[thread.messages.length - 1]!;
					const headers = lastMsg.payload?.headers ?? [];
					const getHeader = (name: string) =>
						headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

					const from = getHeader("From");
					const to = getHeader("To");
					const subject = getHeader("Subject");
					const messageId = getHeader("Message-ID");
					const references = getHeader("References");

					const email = getAuthenticatedEmail(agentDir);
					const replyTo = params.reply_all
						? [from, to].filter((a) => a && !a.includes(email ?? "")).join(", ") || from
						: from;

					const raw = buildRawMessage({
						from: email ?? undefined,
						to: replyTo,
						cc: params.reply_all ? getHeader("Cc") : undefined,
						subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
						body: params.body,
						inReplyTo: messageId,
						references: references ? `${references} ${messageId}` : messageId,
					});

					const draft = await client.createDraft(settings, agentDir, raw, params.thread_id);
					return text(
						`✓ Reply draft created (ID: ${draft.id})\n` +
						`  To: ${replyTo}\n` +
						`  Subject: ${subject.startsWith("Re:") ? subject : `Re: ${subject}`}\n\n` +
						`Use action "send_draft" with draft_id="${draft.id}" to send.`,
					);
				}

				case "send": {
					if (!params.to) return text("Missing required field: to");
					if (!params.subject) return text("Missing required field: subject");
					if (!params.body) return text("Missing required field: body");

					// Safety gate — require human confirmation
					const confirmed = await ctx.ui.confirm(
						"Send email?",
						`To: ${params.to}\nSubject: ${params.subject}\n\n${params.body.slice(0, 200)}${params.body.length > 200 ? "..." : ""}`,
					);
					if (!confirmed) return text("❌ Send cancelled by user.");

					const email = getAuthenticatedEmail(agentDir);
					const raw = buildRawMessage({
						from: email ?? undefined,
						to: params.to,
						cc: params.cc,
						bcc: params.bcc,
						subject: params.subject,
						body: params.body,
					});

					const sent = await client.sendMessage(settings, agentDir, raw);
					return text(`✓ Email sent! (ID: ${sent.id})\n  To: ${params.to}\n  Subject: ${params.subject}`);
				}

				case "send_draft": {
					if (!params.draft_id) return text("Missing required field: draft_id");

					// Fetch draft details for confirmation
					const draft = await client.getDraft(settings, agentDir, params.draft_id);
					const draftHeaders = draft.message?.payload?.headers ?? [];
					const draftTo = draftHeaders.find((h) => h.name.toLowerCase() === "to")?.value ?? "unknown";
					const draftSubject = draftHeaders.find((h) => h.name.toLowerCase() === "subject")?.value ?? "(no subject)";

					const confirmed = await ctx.ui.confirm(
						"Send draft?",
						`To: ${draftTo}\nSubject: ${draftSubject}`,
					);
					if (!confirmed) return text("❌ Send cancelled by user.");

					const sent = await client.sendDraft(settings, agentDir, params.draft_id);
					return text(`✓ Draft sent! (ID: ${sent.id})`);
				}

				case "list_drafts": {
					const drafts = await client.listDrafts(settings, agentDir, maxResults);
					if (drafts.length === 0) return text("No drafts.");

					// Fetch full drafts for display
					const lines: string[] = [];
					for (const d of drafts) {
						const full = await client.getDraft(settings, agentDir, d.id);
						const headers = full.message?.payload?.headers ?? [];
						const to = headers.find((h) => h.name.toLowerCase() === "to")?.value ?? "";
						const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? "(no subject)";
						lines.push(`- **${subject}** → ${to} (draft ID: ${d.id})`);
					}
					return text(`**Drafts (${drafts.length}):**\n\n${lines.join("\n")}`);
				}

				case "delete_draft": {
					if (!params.draft_id) return text("Missing required field: draft_id");
					await client.deleteDraft(settings, agentDir, params.draft_id);
					return text(`✓ Draft ${params.draft_id} deleted.`);
				}

				// ── Management operations ───────────────────────

				case "archive": {
					const msgIds = params.ids ?? (params.id ? [params.id] : []);
					if (msgIds.length === 0) return text("Missing required field: id or ids");

					const confirmed = await ctx.ui.confirm(
						"Archive?",
						`Archive ${msgIds.length} message(s)?`,
					);
					if (!confirmed) return text("❌ Archive cancelled.");

					await client.batchModifyMessages(settings, agentDir, msgIds, [], ["INBOX"]);
					return text(`✓ Archived ${msgIds.length} message(s).`);
				}

				case "trash": {
					const msgIds = params.ids ?? (params.id ? [params.id] : []);
					if (msgIds.length === 0) return text("Missing required field: id or ids");

					const confirmed = await ctx.ui.confirm(
						"Trash?",
						`Move ${msgIds.length} message(s) to trash?`,
					);
					if (!confirmed) return text("❌ Trash cancelled.");

					for (const msgId of msgIds) {
						await client.trashMessage(settings, agentDir, msgId);
					}
					return text(`✓ Trashed ${msgIds.length} message(s).`);
				}

				case "label": {
					const msgIds = params.ids ?? (params.id ? [params.id] : []);
					if (msgIds.length === 0) return text("Missing required field: id or ids");
					if (!params.add_labels && !params.remove_labels) {
						return text("Provide add_labels and/or remove_labels");
					}

					await client.batchModifyMessages(
						settings,
						agentDir,
						msgIds,
						params.add_labels,
						params.remove_labels,
					);

					const changes: string[] = [];
					if (params.add_labels?.length) changes.push(`+${params.add_labels.join(",")}`);
					if (params.remove_labels?.length) changes.push(`-${params.remove_labels.join(",")}`);
					return text(`✓ Labels updated for ${msgIds.length} message(s): ${changes.join(" ")}`);
				}

				case "mark_read": {
					const msgIds = params.ids ?? (params.id ? [params.id] : []);
					if (msgIds.length === 0) return text("Missing required field: id or ids");
					await client.batchModifyMessages(settings, agentDir, msgIds, [], ["UNREAD"]);
					return text(`✓ Marked ${msgIds.length} message(s) as read.`);
				}

				case "mark_unread": {
					const msgIds = params.ids ?? (params.id ? [params.id] : []);
					if (msgIds.length === 0) return text("Missing required field: id or ids");
					await client.batchModifyMessages(settings, agentDir, msgIds, ["UNREAD"], []);
					return text(`✓ Marked ${msgIds.length} message(s) as unread.`);
				}

				// ── Attachments ─────────────────────────────────

				case "download_attachment": {
					if (!params.id) return text("Missing required field: id (message ID)");
					if (!params.attachment_id) return text("Missing required field: attachment_id");

					const attachment = await client.getAttachment(
						settings,
						agentDir,
						params.id,
						params.attachment_id,
					);

					// Decode the attachment data
					const data = Buffer.from(
						attachment.data.replace(/-/g, "+").replace(/_/g, "/"),
						"base64",
					);

					// Determine save path
					let savePath = params.save_path;
					if (!savePath) {
						// Try to get filename from the message
						const msg = await client.getMessage(settings, agentDir, params.id);
						const filename = findAttachmentFilename(msg, params.attachment_id) ?? `attachment-${params.attachment_id}`;
						savePath = path.join(ctx.cwd, filename);
					}

					// Resolve path
					savePath = savePath.replace(/^@/, "");
					if (!path.isAbsolute(savePath)) {
						savePath = path.resolve(ctx.cwd, savePath);
					}

					fs.mkdirSync(path.dirname(savePath), { recursive: true });
					fs.writeFileSync(savePath, data);

					return text(`✓ Attachment saved to: ${savePath} (${formatAttachmentSize(data.length)})`);
				}

				default:
					return text(`Unknown action: ${(params as any).action}`);
			}
		},
	});
}

// ── Helpers ─────────────────────────────────────────────────────

async function fetchMessages(
	settings: GmailSettings,
	agentDir: string,
	ids: string[],
): Promise<GmailMessage[]> {
	// Fetch messages in parallel (up to 10 concurrent)
	const results: GmailMessage[] = [];
	const batchSize = 10;

	for (let i = 0; i < ids.length; i += batchSize) {
		const batch = ids.slice(i, i + batchSize);
		const fetched = await Promise.all(
			batch.map((id) => client.getMessage(settings, agentDir, id, "metadata")),
		);
		results.push(...fetched);
	}

	return results;
}

function findAttachmentFilename(msg: GmailMessage, attachmentId: string): string | null {
	function search(part: any): string | null {
		if (part.body?.attachmentId === attachmentId && part.filename) {
			return part.filename;
		}
		if (part.parts) {
			for (const child of part.parts) {
				const found = search(child);
				if (found) return found;
			}
		}
		return null;
	}
	return msg.payload ? search(msg.payload) : null;
}

function formatAttachmentSize(bytes: number): string {
	if (bytes === 0) return "0B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)}${units[i]}`;
}
