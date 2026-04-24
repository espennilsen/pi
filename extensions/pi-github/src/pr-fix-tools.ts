/**
 * pi-github — PR review thread tools for the agentic fix workflow.
 *
 * Registered as LLM tools so agents can reply to, resolve, and comment on
 * PR review threads reliably instead of constructing raw GraphQL/CLI commands.
 *
 * Tools:
 *   - github_review_thread_reply  — reply to a review thread
 *   - github_resolve_review_thread — mark a review thread as resolved
 *   - github_post_pr_comment    — post a top-level PR comment
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { ghGraphql, ghJson, gh } from "./gh.ts";

const REPLY_MUTATION = `
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: $threadId,
    body: $body
  }) { comment { id } }
}`;

const RESOLVE_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { isResolved }
  }
}`;

export function registerPrFixTools(pi: ExtensionAPI): void {
  // ── Tool 1: Reply to a review thread ──────────────────────────

  pi.registerTool({
    name: "github_review_thread_reply",
    label: "GitHub Review Thread Reply",
    description:
      "Reply to an unresolved PR review thread on GitHub. " +
      "Requires the GraphQL thread ID from the review thread (e.g. PRRT_kw...). " +
      "Use this after fixing code to tell the reviewer what was changed.",
    parameters: Type.Object({
      thread_id: Type.String({
        description: "GraphQL review thread ID (e.g. PRRT_kwDOROE4Hs58DgAS)",
      }),
      message: Type.String({
        description: "Reply body — brief description of the fix",
        minLength: 1,
      }),
    }) as any,

    async execute(_toolCallId, params: any) {
      const { thread_id, message } = params;

      const result = await ghGraphql<any>(REPLY_MUTATION, {
        threadId: thread_id,
        body: message,
      });

      if (!result) {
        return {
          content: [{ type: "text" as const, text: "❌ Failed to reply to review thread. The gh GraphQL call returned no response. Check gh auth status, network connectivity, or rate limits." }],
          details: { ok: false, thread_id },
        };
      }

      if (result.errors) {
        const errors = JSON.stringify(result.errors, null, 2);
        return {
          content: [{ type: "text" as const, text: `❌ Failed to reply to review thread.\n\nGraphQL errors:\n\`\`\`json\n${errors}\n\`\`\`` }],
          details: { ok: false, thread_id, errors: result.errors },
        };
      }

      const commentId = result.data?.addPullRequestReviewThreadReply?.comment?.id;
      return {
        content: [{ type: "text" as const, text: `✅ Replied to review thread. Comment ID: \`${commentId ?? "unknown"}\`` }],
        details: { ok: true, thread_id, commentId },
      };
    },
  });

  // ── Tool 2: Resolve a review thread ─────────────────────────────

  pi.registerTool({
    name: "github_resolve_review_thread",
    label: "GitHub Resolve Review Thread",
    description:
      "Mark a PR review thread as resolved on GitHub. " +
      "Requires the GraphQL thread ID from the review thread (e.g. PRRT_kw...). " +
      "Idempotent — resolving an already-resolved thread is a no-op.",
    parameters: Type.Object({
      thread_id: Type.String({
        description: "GraphQL review thread ID (e.g. PRRT_kwDOROE4Hs58DgAS)",
      }),
    }) as any,

    async execute(_toolCallId, params: any) {
      const { thread_id } = params;

      const result = await ghGraphql<any>(RESOLVE_MUTATION, {
        threadId: thread_id,
      });

      if (!result) {
        return {
          content: [{ type: "text" as const, text: "❌ Failed to resolve review thread. The gh GraphQL call returned no response. Check gh auth status, network connectivity, or rate limits." }],
          details: { ok: false, thread_id },
        };
      }

      if (result.errors) {
        const errors = JSON.stringify(result.errors, null, 2);
        return {
          content: [{ type: "text" as const, text: `❌ Failed to resolve review thread.\n\nGraphQL errors:\n\`\`\`json\n${errors}\n\`\`\`` }],
          details: { ok: false, thread_id, errors: result.errors },
        };
      }

      const isResolved = result.data?.resolveReviewThread?.thread?.isResolved;
      return {
        content: [{ type: "text" as const, text: `✅ Review thread ${isResolved ? "resolved" : "status unchanged"}.` }],
        details: { ok: true, thread_id, isResolved },
      };
    },
  });

  // ── Tool 3: Post a PR comment ────────────────────────────────

  pi.registerTool({
    name: "github_post_pr_comment",
    label: "GitHub Post PR Comment",
    description:
      "Post a top-level comment on a GitHub pull request. " +
      "Use this for summary comments after fixing review feedback.",
    parameters: Type.Object({
      owner: Type.String({ description: "Repository owner (e.g. espennilsen)" }),
      repo: Type.String({ description: "Repository name (e.g. pi)" }),
      pr_number: Type.Integer({ description: "Pull request number", minimum: 1 }),
      body: Type.String({ description: "Comment body (supports markdown)", minLength: 1 }),
    }) as any,

    async execute(_toolCallId, params: any) {
      const { owner, repo, pr_number, body } = params;

      const result = await gh(
        ["pr", "comment", String(pr_number), "-R", `${owner}/${repo}`, "--body", body],
      );

      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `❌ Failed to post PR comment. The gh CLI call failed: ${result.stderr}` }],
          details: { ok: false, owner, repo, pr_number },
        };
      }

      return {
        content: [{ type: "text" as const, text: `✅ Posted comment on PR #${pr_number}.` }],
        details: { ok: true, owner, repo, pr_number },
      };
    },
  });
}
