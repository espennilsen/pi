/**
 * pi-penpot — Comment & collaboration tool.
 *
 * Handles comment threads, replies, and thread management.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { apiPost, isClientReady } from "../client.ts";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@earendil-works/pi-coding-agent";
import type { CommentThread, Comment } from "../types.ts";

const ACTIONS = [
	"get-threads",
	"get-comments",
	"get-unread-threads",
	"create-thread",
	"reply",
	"update-comment",
	"delete-comment",
	"delete-thread",
	"update-thread-status",
	"update-thread-position",
	"mark-threads-read",
] as const;

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

function truncateOutput(s: string): string {
	const result = truncateHead(s, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	if (result.truncated) {
		return result.content + `\n\n[Output truncated: ${result.outputLines}/${result.totalLines} lines, ${formatSize(result.outputBytes)}/${formatSize(result.totalBytes)}]`;
	}
	return result.content;
}

export function registerPenpotCommentTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "penpot_comment",
		label: "Penpot Comment",
		description:
			"Penpot comments & collaboration — create/read/update/delete comment threads and replies on design files. " +
			"Use the main `penpot` tool to get fileId first.",
		promptSnippet:
			"Manage Penpot comment threads and replies on design files",
		promptGuidelines: [
			"Comment threads are anchored to a position on a specific page of a file.",
			"Use `create-thread` to start a new discussion at a position.",
			"Use `reply` to add comments to an existing thread.",
			"Use `get-threads` to list all threads on a file, `get-comments` to read a thread's replies.",
		],
		parameters: Type.Object({
			action: StringEnum(ACTIONS, { description: "Operation to perform" }),
			fileId: Type.Optional(Type.String({ description: "File UUID" })),
			teamId: Type.Optional(Type.String({ description: "Team UUID (for get-unread-threads)" })),
			threadId: Type.Optional(Type.String({ description: "Comment thread UUID" })),
			commentId: Type.Optional(Type.String({ description: "Comment UUID (for update/delete)" })),
			pageId: Type.Optional(Type.String({ description: "Page UUID (for create-thread)" })),
			frameId: Type.Optional(Type.String({ description: "Frame UUID (for create-thread)" })),
			content: Type.Optional(Type.String({ description: "Comment text content" })),
			position: Type.Optional(Type.Object({
				x: Type.Number({ description: "X position" }),
				y: Type.Number({ description: "Y position" }),
			}, { description: "Position on page (for create-thread, update-thread-position)" })),
			threadIds: Type.Optional(Type.Array(Type.String(), { description: "Thread UUIDs (for mark-threads-read)" })),
			shareId: Type.Optional(Type.String({ description: "Share link UUID (for shared access)" })),
		}),

		async execute(_toolCallId, params, signal) {
			if (!isClientReady()) {
				return text('❌ Penpot not configured. Add endpoint and accessToken to settings.json under "pi-penpot".');
			}

			try {
				switch (params.action) {
					case "get-threads":
						return await handleGetThreads(params, signal);
					case "get-comments":
						return await handleGetComments(params, signal);
					case "get-unread-threads":
						return await handleGetUnreadThreads(params, signal);
					case "create-thread":
						return await handleCreateThread(params, signal);
					case "reply":
						return await handleReply(params, signal);
					case "update-comment":
						return await handleUpdateComment(params, signal);
					case "delete-comment":
						return await handleDeleteComment(params, signal);
					case "delete-thread":
						return await handleDeleteThread(params, signal);
					case "update-thread-status":
						return await handleUpdateThreadStatus(params, signal);
					case "update-thread-position":
						return await handleUpdateThreadPosition(params, signal);
					case "mark-threads-read":
						return await handleMarkThreadsRead(params, signal);

					default:
						return text(`Unknown action: ${(params as any).action}`);
				}
			} catch (err: any) {
				return text(`❌ Penpot error: ${err.message}`);
			}
		},
	});
}

// ══════════════════════════════════════════════════════════════════
// Handlers
// ══════════════════════════════════════════════════════════════════

async function handleGetThreads(params: any, signal?: AbortSignal) {
	const body: Record<string, any> = {};
	if (params.fileId) body.fileId = params.fileId;
	if (params.teamId) body.teamId = params.teamId;
	if (params.shareId) body.shareId = params.shareId;

	if (!body.fileId && !body.teamId) return text("❌ 'fileId' or 'teamId' is required");

	const threads = await apiPost<CommentThread[]>("get-comment-threads", body, signal);
	if (threads.length === 0) return text("No comment threads found.");

	const lines = [
		`**Comment Threads** — ${threads.length} found`,
		"",
		"| # | Content | Page | Position | Comments | ID |",
		"|---|---------|------|----------|----------|----|",
		...threads.map(t => {
			const preview = (t.content ?? "").slice(0, 60).replace(/\n/g, " ");
			return `| ${t.seqn ?? "—"} | ${preview}${(t.content ?? "").length > 60 ? "…" : ""} | \`${t.pageId}\` | ${Math.round(t.position?.x ?? 0)},${Math.round(t.position?.y ?? 0)} | ${t.countComments ?? "—"} | \`${t.id}\` |`;
		}),
	];

	return text(truncateOutput(lines.join("\n")));
}

async function handleGetComments(params: any, signal?: AbortSignal) {
	if (!params.threadId) return text("❌ 'threadId' is required");

	const body: Record<string, any> = { threadId: params.threadId };
	if (params.shareId) body.shareId = params.shareId;

	const comments = await apiPost<Comment[]>("get-comments", body, signal);
	if (comments.length === 0) return text("No comments in this thread.");

	const lines = [
		`**Comments** — ${comments.length} in thread`,
		"",
		...comments.map(c => {
			const date = formatDate(c.createdAt);
			return `**${date}** (\`${c.id}\`):\n${c.content}\n`;
		}),
	];

	return text(truncateOutput(lines.join("\n")));
}

async function handleGetUnreadThreads(params: any, signal?: AbortSignal) {
	if (!params.teamId) return text("❌ 'teamId' is required");

	const threads = await apiPost<CommentThread[]>("get-unread-comment-threads", {
		teamId: params.teamId,
	}, signal);

	if (threads.length === 0) return text("No unread comment threads.");

	const lines = [
		`**Unread Threads** — ${threads.length} found`,
		"",
		...threads.map(t => {
			const preview = (t.content ?? "").slice(0, 80).replace(/\n/g, " ");
			return `- \`${t.id}\` in file \`${t.fileId}\`: ${preview}`;
		}),
	];

	return text(truncateOutput(lines.join("\n")));
}

async function handleCreateThread(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");
	if (!params.content) return text("❌ 'content' is required");
	if (!params.position) return text("❌ 'position' is required ({x, y})");

	const body: Record<string, any> = {
		fileId: params.fileId,
		pageId: params.pageId,
		content: params.content,
		position: params.position,
		frameId: params.frameId ?? "00000000-0000-0000-0000-000000000000",
	};
	if (params.shareId) body.shareId = params.shareId;

	const thread = await apiPost<CommentThread>("create-comment-thread", body, signal);

	return text(`✅ Comment thread created at (${params.position.x}, ${params.position.y})\nThread ID: \`${thread.id}\``);
}

async function handleReply(params: any, signal?: AbortSignal) {
	if (!params.threadId) return text("❌ 'threadId' is required");
	if (!params.content) return text("❌ 'content' is required");

	const body: Record<string, any> = {
		threadId: params.threadId,
		content: params.content,
	};
	if (params.shareId) body.shareId = params.shareId;

	const comment = await apiPost<Comment>("create-comment", body, signal);

	return text(`✅ Reply added to thread \`${params.threadId}\`\nComment ID: \`${comment.id}\``);
}

async function handleUpdateComment(params: any, signal?: AbortSignal) {
	if (!params.commentId) return text("❌ 'commentId' is required");
	if (!params.content) return text("❌ 'content' is required");

	const body: Record<string, any> = {
		id: params.commentId,
		content: params.content,
	};
	if (params.shareId) body.shareId = params.shareId;

	await apiPost("update-comment", body, signal);

	return text(`✅ Comment \`${params.commentId}\` updated`);
}

async function handleDeleteComment(params: any, signal?: AbortSignal) {
	if (!params.commentId) return text("❌ 'commentId' is required");

	const body: Record<string, any> = { id: params.commentId };
	if (params.shareId) body.shareId = params.shareId;

	await apiPost("delete-comment", body, signal);

	return text(`✅ Comment deleted`);
}

async function handleDeleteThread(params: any, signal?: AbortSignal) {
	if (!params.threadId) return text("❌ 'threadId' is required");

	const body: Record<string, any> = { id: params.threadId };
	if (params.shareId) body.shareId = params.shareId;

	await apiPost("delete-comment-thread", body, signal);

	return text(`✅ Comment thread deleted`);
}

async function handleUpdateThreadStatus(params: any, signal?: AbortSignal) {
	if (!params.threadId) return text("❌ 'threadId' is required");

	// Toggle resolved status — the API just takes id and shareId
	const body: Record<string, any> = { id: params.threadId };
	if (params.shareId) body.shareId = params.shareId;

	await apiPost("update-comment-thread-status", body, signal);

	return text(`✅ Thread \`${params.threadId}\` status updated`);
}

async function handleUpdateThreadPosition(params: any, signal?: AbortSignal) {
	if (!params.threadId) return text("❌ 'threadId' is required");
	if (!params.position) return text("❌ 'position' is required ({x, y})");

	const body: Record<string, any> = {
		id: params.threadId,
		position: params.position,
	};
	if (params.shareId) body.shareId = params.shareId;

	await apiPost("update-comment-thread-position", body, signal);

	return text(`✅ Thread \`${params.threadId}\` moved to (${params.position.x}, ${params.position.y})`);
}

async function handleMarkThreadsRead(params: any, signal?: AbortSignal) {
	if (!params.threadIds || params.threadIds.length === 0) return text("❌ 'threadIds' is required");

	await apiPost("mark-all-threads-as-read", { threads: params.threadIds }, signal);

	return text(`✅ Marked ${params.threadIds.length} thread(s) as read`);
}

// ── Helpers ─────────────────────────────────────────────────────

function formatDate(iso: string | undefined): string {
	if (!iso) return "—";
	try {
		const d = new Date(iso);
		return d.toISOString().replace("T", " ").slice(0, 16);
	} catch {
		return iso;
	}
}
