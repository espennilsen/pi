/**
 * pi-github — GitHub integration extension for pi.
 *
 * Provides /gh-* and /github-* commands:
 *   - /gh-prs          — List open pull requests
 *   - /gh-issues       — List open issues
 *   - /gh-status       — Repo status summary
 *   - /gh-notifications — GitHub notifications
 *   - /gh-pr-create    — Create PR with LLM-generated summary
 *   - /gh-pr-review    — Show PR review feedback
 *   - /gh-pr-fix       — Fix PR review feedback (validates with user, fixes, resolves)
 *   - /gh-pr-merge     — Merge PR, delete remote/local branch, pull base
 *   - /gh-actions      — List recent workflow runs
 *
 * All commands also available as /github-* variants.
 * Requires gh CLI installed and authenticated.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SettingsManager, getAgentDir } from "@mariozechner/pi-coding-agent";
import { registerCommands, setSessionCwd } from "./commands.ts";
import { registerPrFixCommand } from "./pr-fix.ts";
import { registerPrMergeCommand } from "./pr-merge.ts";
import { createLogger } from "./logger.ts";
import { setDefaultOwner } from "./repo-ref.ts";

function loadSettings(cwd: string): void {
	setDefaultOwner(null);
	try {
		const sm = SettingsManager.create(cwd, getAgentDir());
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...global?.["pi-github"], ...project?.["pi-github"] };
		if (cfg?.defaultOwner && typeof cfg.defaultOwner === "string") {
			setDefaultOwner(cfg.defaultOwner);
		}
	} catch {
		// No settings — that's fine
	}
}

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
		loadSettings(ctx.cwd);
	});

	pi.on("session_switch", async (_event, ctx) => {
		cwd = ctx.cwd;
		setSessionCwd(ctx.cwd);
		loadSettings(ctx.cwd);
	});

	pi.on("session_fork", async (_event, ctx) => {
		cwd = ctx.cwd;
		setSessionCwd(ctx.cwd);
		loadSettings(ctx.cwd);
	});
}
