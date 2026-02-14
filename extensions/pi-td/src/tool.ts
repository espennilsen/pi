/**
 * pi-td — LLM tool for task management via td CLI.
 *
 * Exposes td operations as a structured tool so the agent can
 * create, track, and manage tasks without raw bash commands.
 */

import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }], details: {} });

export function registerTdTool(pi: ExtensionAPI, getCwd: () => string): void {

	// ── System prompt injection ───────────────────────────────

	pi.on("before_agent_start", async (event: any) => {
		return {
			systemPrompt:
				event.systemPrompt +
				"\n\n---\n\n" +
				"## Task Management (td tool) — MANDATORY\n\n" +
				"You MUST use the `td` tool for all task management. Every code change requires a task.\n\n" +
				"### Required workflow — follow every time:\n" +
				"1. `td({ action: \"status\" })` — check current state\n" +
				"2. `td({ action: \"create\", title: \"description\", type: \"task\" })` — create task (use `minor: true` for trivial changes)\n" +
				"3. `td({ action: \"start\", id: \"td-xxx\" })` — start the task\n" +
				"4. Create a git feature branch: `git checkout -b <task-id>/<short-description>`\n" +
				"5. Do the work, commit to the feature branch\n" +
				"6. `td({ action: \"log\", id: \"td-xxx\", message: \"what you did\" })` — log progress\n" +
				"7. `td({ action: \"handoff\", id: \"td-xxx\", done: [\"...\"] })` — record handoff\n" +
				"8. Push branch and create PR: `git push origin <branch>` then `gh pr create --fill`\n" +
				"9. `td({ action: \"review\", id: \"td-xxx\" })` — submit for review\n\n" +
				"### Minor tasks:\n" +
				"Create with `minor: true` for trivial/small changes. Minor tasks allow self-review:\n" +
				"after handoff, use `td({ action: \"approve\", id: \"td-xxx\" })` to close directly.\n\n" +
				"### Rules:\n" +
				"- **Never commit to main** — always use a feature branch named `<task-id>/<short-name>`\n" +
				"- **Every change needs a task** — no exceptions\n" +
				"- **Always create a PR** after pushing the branch\n" +
				"- **PR review fixes go on the PR branch** — don't create a new branch\n\n" +
				"### Actions:\n" +
				"- **Query:** status, list, show, ready, next, reviewable\n" +
				"- **Lifecycle:** create, start, log, handoff, review, approve, reject, close\n" +
				"- **Other:** block, unblock, reopen, comment\n",
		};
	});

	// ── Tool registration ────────────────────────────────────

	pi.registerTool({
		name: "td",
		label: "Task Management",
		description: "Create, track, and manage tasks. Every code change MUST have a task. Use this instead of running td in bash.",
		parameters: Type.Object({
			action: StringEnum([
				// Query
				"status", "list", "show", "ready", "next", "reviewable",
				// Lifecycle
				"create", "start", "log", "handoff", "review", "approve", "reject", "close",
				// Other
				"block", "unblock", "reopen", "comment",
			] as const, { description: "Task action to perform" }),

			// Target issue
			id: Type.Optional(Type.String({ description: "Issue ID (e.g. td-abc123)" })),

			// Create fields
			title: Type.Optional(Type.String({ description: "Task title (for create)" })),
			type: Type.Optional(StringEnum(
				["task", "bug", "feature", "epic", "chore"] as const,
				{ description: "Issue type (default: task)" },
			)),
			priority: Type.Optional(StringEnum(
				["P0", "P1", "P2", "P3", "P4"] as const,
				{ description: "Priority: P0=critical, P1=high, P2=default, P3=low, P4=minimal" },
			)),
			description: Type.Optional(Type.String({ description: "Description (for create/comment)" })),
			labels: Type.Optional(Type.String({ description: "Comma-separated labels" })),
			parent: Type.Optional(Type.String({ description: "Parent epic ID" })),
			minor: Type.Optional(Type.Boolean({ description: "Mark as minor task — allows self-review/approve" })),

			// Log fields
			message: Type.Optional(Type.String({ description: "Log message or comment text" })),
			log_type: Type.Optional(StringEnum(
				["progress", "blocker", "decision", "hypothesis", "tried", "result"] as const,
				{ description: "Log entry type (default: progress)" },
			)),

			// Handoff fields
			done: Type.Optional(Type.Array(Type.String(), { description: "What was completed" })),
			remaining: Type.Optional(Type.Array(Type.String(), { description: "What remains to do" })),
			decisions: Type.Optional(Type.Array(Type.String(), { description: "Key decisions made" })),
			uncertain: Type.Optional(Type.Array(Type.String(), { description: "Open questions" })),

			// Reject/close fields
			reason: Type.Optional(Type.String({ description: "Reason for reject/close/block/approve" })),

			// List filters
			show_all: Type.Optional(Type.Boolean({ description: "Include closed issues in list" })),
			filter_type: Type.Optional(Type.String({ description: "Filter by issue type" })),
			filter_priority: Type.Optional(Type.String({ description: "Filter by priority" })),
			filter_status: Type.Optional(Type.String({ description: "Filter by status" })),
		}),

		execute: async (_toolCallId: string, params: any) => {
			const action = params.action as string;
			if (!action) return text("❌ Missing required parameter: `action`.");
			const cwd = getCwd();

			try {
				switch (action) {
					// ── Query actions ─────────────────────────

					case "status": {
						const result = await exec(pi, ["status"], cwd);
						return text(result);
					}

					case "list": {
						const args = ["list"];
						if (params.show_all) args.push("--all");
						if (params.filter_type) args.push("--type", params.filter_type);
						if (params.filter_priority) args.push("--priority", params.filter_priority);
						if (params.filter_status) args.push("--status", params.filter_status);
						const result = await exec(pi, args, cwd);
						return text(result);
					}

					case "show": {
						if (!params.id) return text("❌ `id` is required for show.");
						const result = await exec(pi, ["show", params.id], cwd);
						return text(result);
					}

					case "ready": {
						const result = await exec(pi, ["ready"], cwd);
						return text(result || "No issues ready to start.");
					}

					case "next": {
						const result = await exec(pi, ["next"], cwd);
						return text(result || "No issues available.");
					}

					case "reviewable": {
						const result = await exec(pi, ["reviewable"], cwd);
						return text(result || "No issues available for review.");
					}

					// ── Lifecycle actions ─────────────────────

					case "create": {
						if (!params.title) return text("❌ `title` is required for create.");
						const args = ["create", params.title];
						if (params.type) args.push("--type", params.type);
						if (params.priority) args.push("--priority", params.priority);
						if (params.description) args.push("--description", params.description);
						if (params.labels) args.push("--labels", params.labels);
						if (params.parent) args.push("--parent", params.parent);
						if (params.minor) args.push("--minor");
						const result = await exec(pi, args, cwd);
						return text(result);
					}

					case "start": {
						if (!params.id) return text("❌ `id` is required for start.");
						const result = await exec(pi, ["start", params.id], cwd);
						return text(result);
					}

					case "log": {
						if (!params.message) return text("❌ `message` is required for log.");
						const args = ["log"];
						if (params.id) args.push("--issue", params.id);
						if (params.log_type) args.push("--type", params.log_type);
						args.push(params.message);
						const result = await exec(pi, args, cwd);
						return text(result);
					}

					case "handoff": {
						if (!params.id) return text("❌ `id` is required for handoff.");
						const args = ["handoff", params.id];
						if (params.done) for (const item of params.done) args.push("--done", item);
						if (params.remaining) for (const item of params.remaining) args.push("--remaining", item);
						if (params.decisions) for (const item of params.decisions) args.push("--decision", item);
						if (params.uncertain) for (const item of params.uncertain) args.push("--uncertain", item);
						if (params.message) args.push("--note", params.message);
						const result = await exec(pi, args, cwd);
						return text(result);
					}

					case "review": {
						if (!params.id) return text("❌ `id` is required for review.");
						const result = await exec(pi, ["review", params.id], cwd);
						return text(result);
					}

					case "approve": {
						if (!params.id) return text("❌ `id` is required for approve.");
						const args = ["approve", params.id];
						if (params.reason) args.push("--reason", params.reason);
						const result = await exec(pi, args, cwd);
						return text(result);
					}

					case "reject": {
						if (!params.id) return text("❌ `id` is required for reject.");
						if (!params.reason) return text("❌ `reason` is required for reject.");
						const args = ["reject", params.id, "--reason", params.reason];
						const result = await exec(pi, args, cwd);
						return text(result);
					}

					case "close": {
						if (!params.id) return text("❌ `id` is required for close.");
						const args = ["close", params.id];
						if (params.reason) args.push("--reason", params.reason);
						const result = await exec(pi, args, cwd);
						return text(result);
					}

					// ── Other actions ─────────────────────────

					case "block": {
						if (!params.id) return text("❌ `id` is required for block.");
						const args = ["block", params.id];
						if (params.reason) args.push("--reason", params.reason);
						const result = await exec(pi, args, cwd);
						return text(result);
					}

					case "unblock": {
						if (!params.id) return text("❌ `id` is required for unblock.");
						const result = await exec(pi, ["unblock", params.id], cwd);
						return text(result);
					}

					case "reopen": {
						if (!params.id) return text("❌ `id` is required for reopen.");
						const result = await exec(pi, ["reopen", params.id], cwd);
						return text(result);
					}

					case "comment": {
						if (!params.id) return text("❌ `id` is required for comment.");
						if (!params.message) return text("❌ `message` is required for comment.");
						const result = await exec(pi, ["comment", params.id, params.message], cwd);
						return text(result);
					}

					default:
						return text(`❌ Unknown action: ${action}`);
				}
			} catch (err: any) {
				return text(`❌ td error: ${err.message}`);
			}
		},
	});
}

// ── Helpers ─────────────────────────────────────────────────────

async function exec(pi: ExtensionAPI, args: string[], cwd?: string): Promise<string> {
	const result = await pi.exec("td", args, { timeout: 30_000, cwd });
	const stdout = result.stdout?.trim() ?? "";
	const stderr = result.stderr?.trim() ?? "";
	if (result.code !== 0) {
		throw new Error(stderr || stdout || `td exited with code ${result.code}`);
	}
	// td can exit 0 while reporting errors in stdout
	if (stdout.startsWith("ERROR:") || stdout.startsWith("Warning: cannot")) {
		throw new Error(stdout);
	}
	return stdout;
}
