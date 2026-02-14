/**
 * pi-github — /gh-pr-merge command.
 *
 * Workflow:
 *   1. Find the PR (by argument or current branch)
 *   2. Merge the PR (squash by default, configurable)
 *   3. Delete the remote branch
 *   4. Pull main locally and delete the local branch
 *   5. Post a summary to the agent
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { gh, ghJson, getCurrentBranch } from "./gh.ts";

type LogFn = (event: string, data: unknown, level?: string) => void;

// ── Helpers ─────────────────────────────────────────────────────

function gitExec(args: string[], cwd: string, timeoutMs = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		execFile("git", args, { cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
			resolve({
				ok: !err,
				stdout: stdout?.trim() ?? "",
				stderr: stderr?.trim() ?? "",
			});
		});
	});
}

interface PrMergeInfo {
	number: number;
	title: string;
	headRefName: string;
	baseRefName: string;
	url: string;
	commits: number;
	additions: number;
	deletions: number;
	changedFiles: number;
	body: string;
}

// ── Register the command ────────────────────────────────────────

export function registerPrMergeCommand(pi: ExtensionAPI, log: LogFn, getCwd: () => string): void {

	function registerDual(shortName: string, longName: string, def: any): void {
		pi.registerCommand(shortName, def);
		pi.registerCommand(longName, def);
	}

	registerDual("gh-pr-merge", "github-pr-merge", {
		description: "Merge a PR, delete remote branch, pull main, clean up local branch: /gh-pr-merge [pr-number] [--merge|--rebase|--squash]",
		handler: async (args: string | undefined, ctx: any) => {
			const cwd = getCwd();
			const parts = (args?.trim() ?? "").split(/\s+/).filter(Boolean);

			// Parse args: optional PR number and optional merge strategy
			let prNumber: number | null = null;
			let strategy: "squash" | "merge" | "rebase" = "squash";

			for (const part of parts) {
				if (part === "--merge") strategy = "merge";
				else if (part === "--rebase") strategy = "rebase";
				else if (part === "--squash") strategy = "squash";
				else if (!isNaN(parseInt(part.replace(/^#/, ""), 10))) {
					prNumber = parseInt(part.replace(/^#/, ""), 10);
				}
			}

			// ── Step 1: Find the PR ─────────────────────────────
			if (!prNumber) {
				const branch = await getCurrentBranch(cwd);
				if (!branch) {
					ctx.ui.notify("❌ Not in a git repo.", "error");
					return;
				}
				if (branch === "main" || branch === "master") {
					ctx.ui.notify("❌ On main/master — specify a PR number: `/gh-pr-merge 14`", "error");
					return;
				}
				const prs = await ghJson<any[]>(["pr", "list", "--head", branch, "--json", "number"], cwd);
				if (!prs || prs.length === 0) {
					ctx.ui.notify(`❌ No open PR found for branch \`${branch}\`.`, "error");
					return;
				}
				prNumber = prs[0].number;
			}

			// ── Step 2: Get PR details ──────────────────────────
			const prData = await ghJson<any>(
				["pr", "view", String(prNumber), "--json", "number,title,headRefName,baseRefName,url,commits,additions,deletions,changedFiles,body,state"],
				cwd,
			);

			if (!prData) {
				ctx.ui.notify(`❌ Could not fetch PR #${prNumber}.`, "error");
				return;
			}

			if (prData.state === "MERGED") {
				ctx.ui.notify(`PR #${prNumber} is already merged.`, "info");
				// Still clean up branches below
				await cleanupBranches(prData.headRefName, prData.baseRefName, cwd, ctx, log, prNumber!);
				return;
			}

			if (prData.state === "CLOSED") {
				ctx.ui.notify(`❌ PR #${prNumber} is closed (not merged).`, "error");
				return;
			}

			const prInfo: PrMergeInfo = {
				number: prData.number,
				title: prData.title ?? "",
				headRefName: prData.headRefName ?? "",
				baseRefName: prData.baseRefName ?? "main",
				url: prData.url ?? "",
				commits: prData.commits?.totalCount ?? prData.commits?.length ?? 0,
				additions: prData.additions ?? 0,
				deletions: prData.deletions ?? 0,
				changedFiles: prData.changedFiles ?? 0,
				body: prData.body ?? "",
			};

			ctx.ui.notify(`Merging PR #${prInfo.number} (${prInfo.title}) via ${strategy}…`, "info");

			// ── Step 3: Merge the PR ────────────────────────────
			const mergeArgs = ["pr", "merge", String(prNumber), `--${strategy}`];
			const mergeResult = await gh(mergeArgs, cwd);

			if (!mergeResult.ok) {
				ctx.ui.notify(`❌ Merge failed: ${mergeResult.stderr || mergeResult.stdout}`, "error");
				return;
			}

			ctx.ui.notify(`✅ PR #${prInfo.number} merged via ${strategy}.`, "info");

			// ── Step 4: Clean up branches ───────────────────────
			await cleanupBranches(prInfo.headRefName, prInfo.baseRefName, cwd, ctx, log, prInfo.number);

			// ── Step 5: Summary ─────────────────────────────────
			const summary = buildSummary(prInfo, strategy);
			ctx.ui.notify(summary, "info");

			log("pr-merge", {
				prNumber: prInfo.number,
				strategy,
				branch: prInfo.headRefName,
				commits: prInfo.commits,
				additions: prInfo.additions,
				deletions: prInfo.deletions,
				changedFiles: prInfo.changedFiles,
			});
		},
	});
}

// ── Branch cleanup ──────────────────────────────────────────────

async function cleanupBranches(
	headBranch: string,
	baseBranch: string,
	cwd: string,
	ctx: any,
	log: LogFn,
	prNumber: number,
): Promise<void> {
	const errors: string[] = [];

	// Delete remote branch
	const remoteDelete = await gitExec(["push", "origin", "--delete", headBranch], cwd, 30_000);
	if (remoteDelete.ok) {
		ctx.ui.notify(`🗑️ Deleted remote branch \`origin/${headBranch}\`.`, "info");
	} else if (remoteDelete.stderr.includes("remote ref does not exist")) {
		ctx.ui.notify(`Remote branch \`origin/${headBranch}\` already deleted.`, "info");
	} else {
		errors.push(`Failed to delete remote branch: ${remoteDelete.stderr}`);
	}

	// Switch to base branch and pull
	const currentBranch = await getCurrentBranch(cwd);
	if (currentBranch !== baseBranch) {
		const checkout = await gitExec(["checkout", baseBranch], cwd);
		if (!checkout.ok) {
			errors.push(`Failed to checkout ${baseBranch}: ${checkout.stderr}`);
		}
	}

	const pull = await gitExec(["pull", "--ff-only"], cwd, 30_000);
	if (pull.ok) {
		ctx.ui.notify(`⬇️ Pulled latest \`${baseBranch}\`.`, "info");
	} else {
		errors.push(`Failed to pull ${baseBranch}: ${pull.stderr}`);
	}

	// Delete local branch (if it exists and we're not on it)
	const nowOn = await getCurrentBranch(cwd);
	if (nowOn !== headBranch) {
		const localDelete = await gitExec(["branch", "-d", headBranch], cwd);
		if (localDelete.ok) {
			ctx.ui.notify(`🗑️ Deleted local branch \`${headBranch}\`.`, "info");
		} else if (localDelete.stderr.includes("not found")) {
			// Branch doesn't exist locally — fine
		} else {
			errors.push(`Failed to delete local branch: ${localDelete.stderr}`);
		}
	}

	// Prune stale remote-tracking refs
	await gitExec(["fetch", "--prune"], cwd, 30_000);

	if (errors.length > 0) {
		ctx.ui.notify(`⚠️ Cleanup issues:\n${errors.map(e => `  - ${e}`).join("\n")}`, "warning");
		log("pr-merge-cleanup-errors", { prNumber, errors });
	}
}

// ── Summary builder ─────────────────────────────────────────────

function buildSummary(pr: PrMergeInfo, strategy: string): string {
	const lines: string[] = [];

	lines.push(`### ✅ Merged PR #${pr.number}: ${pr.title}`);
	lines.push("");
	lines.push(`**Strategy:** ${strategy} into \`${pr.baseRefName}\``);
	lines.push(`**Branch:** \`${pr.headRefName}\` → deleted`);

	if (pr.additions || pr.deletions || pr.changedFiles) {
		lines.push(`**Changes:** ${pr.changedFiles} file${pr.changedFiles !== 1 ? "s" : ""} (+${pr.additions} -${pr.deletions})`);
	}

	lines.push(`**URL:** ${pr.url}`);

	return lines.join("\n");
}
