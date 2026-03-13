/**
 * pi-github — /gh-pr-merge command.
 *
 * Workflow:
 *   1. Find the PR (by argument or current branch)
 *   2. Get PR details
 *   3. Post pre-merge summary (title, changes, body preview)
 *   4. Merge the PR (squash by default, configurable)
 *   5. Post summary comment on the PR (strategy, stats, file list)
 *   6. Clean up: delete remote/local branch, pull base, prune
 */

import { rmdir } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { gh, ghJson, gitExec, gitExecRetry, getCurrentBranch, findWorktreeForBranch } from "./gh.ts";
import { registerDualCommand } from "./commands.ts";
import { extractRepoRef, resolveRepo, repoFlag } from "./repo-ref.ts";

type LogFn = (event: string, data: unknown, level?: string) => void;

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
	files: { path: string; additions: number; deletions: number }[];
}

// ── Register the command ────────────────────────────────────────

export function registerPrMergeCommand(pi: ExtensionAPI, log: LogFn, getCwd: () => string): void {

	registerDualCommand(pi, "gh-pr-merge", "github-pr-merge", {
		description: "Merge a PR: /gh-pr-merge [number | owner/repo#N | PR-URL] [--merge|--rebase|--squash]",
		handler: async (args: string, ctx: any) => {
			const cwd = getCwd();

			// Separate strategy flags from the rest
			const parts = args.split(/\s+/).filter(Boolean);
			let strategy: "squash" | "merge" | "rebase" = "squash";
			const nonFlags: string[] = [];

			for (const part of parts) {
				if (part === "--merge") strategy = "merge";
				else if (part === "--rebase") strategy = "rebase";
				else if (part === "--squash") strategy = "squash";
				else nonFlags.push(part);
			}

			const { ref } = extractRepoRef(nonFlags.join(" "));
			const resolved = await resolveRepo(ref, cwd);
			if (!resolved) {
				ctx.ui.notify("❌ Could not determine repo. Specify owner/repo or run from a git repo.", "error");
				return;
			}
			const rFlag = repoFlag(resolved.owner, resolved.repo);
			let prNumber = ref.prNumber;

			// ── Step 1: Find the PR ─────────────────────────────
			if (!prNumber) {
				const branch = await getCurrentBranch(cwd);
				if (!branch) {
					ctx.ui.notify("❌ Not in a git repo. Specify a PR: /gh-pr-merge owner/repo#N", "error");
					return;
				}
				if (branch === "main" || branch === "master") {
					ctx.ui.notify(`❌ On main/master — specify a PR: \`/gh-pr-merge ${resolved.slug}#N\``, "error");
					return;
				}
				const prs = await ghJson<any[]>(["pr", "list", ...rFlag, "--head", branch, "--json", "number"]);
				if (!prs || prs.length === 0) {
					ctx.ui.notify(`❌ No open PR found for branch \`${branch}\` on ${resolved.slug}.`, "error");
					return;
				}
				prNumber = prs[0].number;
			}

			// ── Step 2: Get PR details ──────────────────────────
			const prData = await ghJson<any>(
				["pr", "view", String(prNumber), ...rFlag, "--json", "number,title,headRefName,baseRefName,url,commits,additions,deletions,changedFiles,body,state,files"],
			);

			if (!prData) {
				ctx.ui.notify(`❌ Could not fetch PR #${prNumber}.`, "error");
				return;
			}

			if (prData.state === "MERGED") {
				ctx.ui.notify(`PR #${prNumber} is already merged.`, "info");
				// Still clean up branches below
				await cleanupBranches(prData.headRefName ?? "", prData.baseRefName ?? "main", cwd, ctx, log, prNumber!, undefined);
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
				files: (prData.files ?? []).map((f: any) => ({
					path: f.path ?? "",
					additions: f.additions ?? 0,
					deletions: f.deletions ?? 0,
				})),
			};

			// ── Step 3: Pre-merge summary ───────────────────────
			const preview = buildPreMergeSummary(prInfo, strategy);
			ctx.ui.notify(preview, "info");

			// ── Step 4: Merge the PR ────────────────────────────
			const mergeArgs = ["pr", "merge", String(prNumber), ...rFlag, `--${strategy}`];
			const mergeResult = await gh(mergeArgs, cwd);

			if (!mergeResult.ok) {
				ctx.ui.notify(`❌ Merge failed: ${mergeResult.stderr || mergeResult.stdout}`, "error");
				return;
			}

			// Verify the merge actually happened — gh pr merge can exit 0 without merging
			const verifyData = await ghJson<any>(
				["pr", "view", String(prNumber), ...rFlag, "--json", "state"],
			);
			if (verifyData === null) {
				ctx.ui.notify(`⚠️ Could not verify merge state for PR #${prNumber} — the API call failed. The merge may have succeeded; check GitHub manually.`, "warning");
				return;
			} else if (verifyData.state !== "MERGED") {
				const stateHint = verifyData.state === "OPEN"
					? "The merge may require approvals or CI checks to pass."
					: `Unexpected state: ${verifyData.state}.`;
				ctx.ui.notify(`❌ PR #${prNumber} was not merged (state: ${verifyData.state}). ${stateHint}`, "error");
				return;
			}

			ctx.ui.notify(`✅ PR #${prInfo.number} merged via ${strategy}.`, "info");

			// ── Step 5: Post summary comment on PR ──────────────
			const comment = buildMergeComment(prInfo, strategy);
			const commentResult = await gh(["pr", "comment", String(prNumber), ...rFlag, "--body", comment]);
			if (commentResult.ok) {
				ctx.ui.notify("💬 Posted merge summary comment on PR.", "info");
			} else {
				ctx.ui.notify(`⚠️ Could not post summary comment: ${commentResult.stderr}`, "warning");
			}

			// ── Step 6: Clean up branches ───────────────────────
			await cleanupBranches(prInfo.headRefName, prInfo.baseRefName, cwd, ctx, log, prInfo.number, strategy);

			log("pr-merge", {
				prNumber: prInfo.number,
				strategy,
				branch: prInfo.headRefName,
				base: prInfo.baseRefName,
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
	strategy?: string,
): Promise<void> {
	if (!headBranch) {
		ctx.ui.notify("⚠️ Head branch unknown — skipping branch cleanup.", "warning");
		return;
	}

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

	// ── Remove head-branch worktree (if any) ────────────────
	// Do this BEFORE checkout/pull so the branch is unlocked and
	// we don't fail trying to checkout or delete it later.
	let worktreeBlocking = false;
	const headWorktree = await findWorktreeForBranch(headBranch, cwd);
	if (headWorktree) {
		const resolvedCwd = resolvePath(cwd);
		const resolvedWorktree = resolvePath(headWorktree);
		if (resolvedCwd === resolvedWorktree || resolvedCwd.startsWith(resolvedWorktree + "/")) {
			// We're running from inside the worktree — can't remove it
			worktreeBlocking = true;
			ctx.ui.notify(`⚠️ Branch \`${headBranch}\` is checked out in the current worktree at \`${headWorktree}\`. Can't auto-remove — run from the main repo or remove manually: \`git worktree remove ${headWorktree}\``, "warning");
		} else {
			// Safe to auto-remove the worktree
			const wtRemove = await gitExec(["worktree", "remove", headWorktree], cwd, 15_000);
			if (wtRemove.ok) {
				ctx.ui.notify(`🗑️ Removed worktree at \`${headWorktree}\`.`, "info");

				// Try to clean up the empty parent directory (e.g. ../pi-worktrees/td-xxx/)
				try {
					const parentDir = resolvePath(headWorktree, "..");
					await rmdir(parentDir); // only succeeds if empty
				} catch {
					// Not empty or doesn't exist — fine
				}
			} else {
				worktreeBlocking = true;
				errors.push(`Could not remove worktree at \`${headWorktree}\`: ${wtRemove.stderr}`);
			}
		}
	}

	// ── Switch to base branch and pull ──────────────────────
	let onBaseBranch = false;
	let pullCwd = cwd; // where to run pull — may differ if base is in a worktree
	const currentBranch = await getCurrentBranch(cwd);
	if (currentBranch === baseBranch) {
		onBaseBranch = true;
	} else {
		const checkout = await gitExecRetry(["checkout", baseBranch], cwd);
		if (checkout.ok) {
			onBaseBranch = true;
		} else {
			// Check if the base branch is checked out in a worktree
			const baseWorktree = await findWorktreeForBranch(baseBranch, cwd);
			if (baseWorktree) {
				onBaseBranch = true;
				pullCwd = baseWorktree;
				ctx.ui.notify(`Branch \`${baseBranch}\` is in worktree at \`${baseWorktree}\`. Pulling there.`, "info");
			} else {
				errors.push(`Failed to checkout ${baseBranch}: ${checkout.stderr}`);
			}
		}
	}

	if (onBaseBranch) {
		const pull = await gitExecRetry(["pull", "--ff-only"], pullCwd, { timeoutMs: 30_000 });
		if (pull.ok) {
			ctx.ui.notify(`⬇️ Pulled latest \`${baseBranch}\`.`, "info");
		} else {
			errors.push(`Failed to pull ${baseBranch}: ${pull.stderr}`);
		}

		// ── Delete local head branch ────────────────────────
		// Use -D (force) because squash/rebase merges on GitHub don't create
		// a local merge commit, so git branch -d thinks it's "not fully merged".
		// Skip if the worktree couldn't be removed (branch is still locked).
		if (!worktreeBlocking) {
			const nowOn = await getCurrentBranch(cwd);
			if (nowOn !== headBranch) {
				// Guard: warn about local-only commits before force-deleting.
				// Only warn for true merge strategy where SHAs are preserved.
				// Squash/rebase always diverge (different SHAs), so just log at debug level.
				if (strategy === "merge") {
					const localOnly = await gitExec(["log", `${baseBranch}..${headBranch}`, "--oneline"], cwd);
					if (localOnly.ok && localOnly.stdout.trim().length > 0) {
						const localCommits = localOnly.stdout.split("\n").filter(Boolean);
						if (localCommits.length > 0) {
							ctx.ui.notify(`⚠️ Local branch \`${headBranch}\` has ${localCommits.length} commit(s) not in \`${baseBranch}\`:\n${localCommits.map(c => `  ${c}`).join("\n")}`, "warning");
						}
					}
				} else {
					log("pr-merge-local-commits", { prNumber, headBranch, baseBranch, strategy, note: "skipped local-only check (squash/rebase SHAs diverge)" });
				}

				const localDelete = await gitExecRetry(["branch", "-D", headBranch], cwd);
				if (localDelete.ok) {
					ctx.ui.notify(`🗑️ Deleted local branch \`${headBranch}\`.`, "info");
				} else if (localDelete.stderr.includes("not found")) {
					// Branch doesn't exist locally — fine
				} else {
					errors.push(`Could not delete local branch \`${headBranch}\` (branch is still safe): ${localDelete.stderr}`);
				}
			}
		}
	}

	// Prune stale remote-tracking refs
	await gitExec(["fetch", "--prune"], cwd, 30_000);

	if (errors.length > 0) {
		ctx.ui.notify(`⚠️ Branch cleanup incomplete (no data was lost):\n${errors.map(e => `  - ${e}`).join("\n")}`, "warning");
		log("pr-merge-cleanup-errors", { prNumber, errors });
	}
}

// ── Summary builders ────────────────────────────────────────────

function buildMergeComment(pr: PrMergeInfo, strategy: string): string {
	const lines: string[] = [];

	lines.push("## 🔀 Merge Summary");
	lines.push("");
	lines.push(`| | |`);
	lines.push(`|---|---|`);
	lines.push(`| **Strategy** | ${strategy} |`);
	lines.push(`| **Branch** | \`${pr.headRefName}\` → \`${pr.baseRefName}\` |`);

	if (pr.commits) {
		lines.push(`| **Commits** | ${pr.commits} |`);
	}
	if (pr.additions || pr.deletions || pr.changedFiles) {
		lines.push(`| **Changed files** | ${pr.changedFiles} |`);
		lines.push(`| **Diff** | +${pr.additions} −${pr.deletions} |`);
	}

	if (pr.files.length > 0) {
		const maxFiles = 50;
		const displayFiles = pr.files.slice(0, maxFiles);
		const remaining = pr.files.length - displayFiles.length;

		lines.push("");
		lines.push("<details>");
		lines.push("<summary>📁 Changed files</summary>");
		lines.push("");
		for (const f of displayFiles) {
			const stat = `+${f.additions} −${f.deletions}`;
			lines.push(`- \`${f.path}\` (${stat})`);
		}
		if (remaining > 0) {
			lines.push(`- …and ${remaining} more file${remaining !== 1 ? "s" : ""}`);
		}
		lines.push("");
		lines.push("</details>");
	}

	return lines.join("\n");
}

function buildPreMergeSummary(pr: PrMergeInfo, strategy: string): string {
	const lines: string[] = [];

	lines.push(`### 🔀 Merging PR #${pr.number}: ${pr.title}`);
	lines.push("");
	lines.push(`**Strategy:** ${strategy} into \`${pr.baseRefName}\``);
	lines.push(`**Branch:** \`${pr.headRefName}\``);

	if (pr.additions || pr.deletions || pr.changedFiles) {
		lines.push(`**Changes:** ${pr.changedFiles} file${pr.changedFiles !== 1 ? "s" : ""} (+${pr.additions} -${pr.deletions})`);
	}

	if (pr.commits) {
		lines.push(`**Commits:** ${pr.commits}`);
	}

	lines.push(`**URL:** ${pr.url}`);

	if (pr.body) {
		const trimmed = pr.body.trim();
		if (trimmed.length > 0) {
			const preview = trimmed.length > 300 ? trimmed.slice(0, 300) + "…" : trimmed;
			lines.push("");
			lines.push(preview);
		}
	}

	return lines.join("\n");
}
