/**
 * pi-gmail — LLM tool registration (read operations).
 *
 * Actions:
 *   - inbox: List recent inbox messages
 *   - unread: List unread messages
 *   - search: Search with Gmail query syntax
 *   - read: Read a specific message by ID
 *   - thread: Read a full thread by ID
 *   - labels: List all labels
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { GmailClient } from "./client.ts";
import type { GmailMessage, GmailThread } from "./types.ts";

// ── Types ───────────────────────────────────────────────────────

interface GmailToolParams {
	action: "inbox" | "unread" | "search" | "read" | "thread" | "labels";
	query?: string;
	id?: string;
	maxResults?: number;
}

// ── Tool registration ───────────────────────────────────────────

export function registerGmailTool(
	pi: ExtensionAPI,
	getClient: () => GmailClient | null,
): void {
	pi.registerTool({
		name: "gmail",
		label: "Gmail",
		description:
			"Read and search Gmail. Actions: " +
			"inbox (recent inbox messages), " +
			"unread (unread messages), " +
			"search (Gmail query — from:, subject:, label:, is:, has:, before:, after:), " +
			"read (message by ID), " +
			"thread (full thread by ID), " +
			"labels (list all labels).",
		parameters: Type.Object({
			action: StringEnum(
				["inbox", "unread", "search", "read", "thread", "labels"] as const,
				{ description: "Action to perform" },
			) as any,
			query: Type.Optional(
				Type.String({
					description:
						"Gmail search query (for search action). Examples: 'from:john@example.com', 'subject:invoice after:2024/01/01', 'is:unread label:important'",
				}),
			),
			id: Type.Optional(
				Type.String({ description: "Message or thread ID (for read/thread actions)" }),
			),
			maxResults: Type.Optional(
				Type.Number({
					description: "Max results to return (default: 10, max: 50)",
					minimum: 1,
					maximum: 50,
				}),
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

// ── Helpers ─────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max) + "…";
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
