/**
 * pi-github — GitHub integration extension for pi.
 *
 * Provides /gh-* and /github-* commands:
 *   - /gh-prs          — List open pull requests
 *   - /gh-issues       — List open issues
 *   - /gh-status       — Repo status summary
 *   - /gh-notifications — GitHub notifications
 *   - /gh-pr-create    — Create PR for current branch
 *   - /gh-pr-review    — Show PR review feedback
 *   - /gh-pr-fix       — Fix PR review feedback (validates with user, fixes, resolves)
 *   - /gh-pr-merge     — Merge PR, delete remote/local branch, pull base
 *   - /gh-actions      — List recent workflow runs
 *
 * All commands also available as /github-* variants.
 * Requires gh CLI installed and authenticated.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommands, setSessionCwd } from "./commands.ts";
import { registerPrFixCommand, resetPrFixState } from "./pr-fix.ts";
import { registerPrMergeCommand } from "./pr-merge.ts";
import { createLogger } from "./logger.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let cwd = process.cwd();

	// ── Register commands ─────────────────────────────────────

	registerCommands(pi, log);
	registerPrFixCommand(pi, log, () => cwd);
	registerPrMergeCommand(pi, log, () => cwd);

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		setSessionCwd(ctx.cwd);
	});

	pi.on("session_switch", async (_event, ctx) => {
		cwd = ctx.cwd;
		setSessionCwd(ctx.cwd);
		resetPrFixState();
	});

	pi.on("session_fork", async (_event, ctx) => {
		cwd = ctx.cwd;
		setSessionCwd(ctx.cwd);
		resetPrFixState();
	});

	pi.on("session_shutdown", async () => {
		resetPrFixState();
	});
}
