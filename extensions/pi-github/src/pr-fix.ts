/**
 * pi-github — /gh-pr-fix command.
 *
 * Single-step workflow:
 *   1. Find the PR (by argument, current branch, or list PRs with feedback)
 *   2. Fetch all unresolved review threads from the PR
 *   3. Present them to the agent with thread IDs and instructions
 *   4. Agent validates with user, fixes code, commits, pushes,
 *      resolves threads via gh CLI, and posts summary comment
 *
 * Supports: /gh-pr-fix [number | owner/repo#N | PR-URL]
 * With defaultOwner setting: /gh-pr-fix repo#N
 * No args: auto-detect from branch, or list PRs with feedback
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ghJson, ghGraphql, gitExec, getCurrentBranch, findWorktreeForBranch } from "./gh.ts";
import { registerDualCommand } from "./commands.ts";
import { extractRepoRef, resolveRepo, resolveLocalClone, repoFlag } from "./repo-ref.ts";

type LogFn = (event: string, data: unknown, level?: string) => void;

// ── Types ───────────────────────────────────────────────────────

interface ReviewThread {
	id: string;
	isResolved: boolean;
	path: string;
	line: number | null;
	body: string;
	author: string;
	comments: { author: string; body: string; createdAt: string }[];
}

interface PrInfo {
	number: number;
	title: string;
	headRefName: string;
	url: string;
	owner: string;
	repo: string;
}

// ── GraphQL Queries ─────────────────────────────────────────────

const REVIEW_THREADS_QUERY = `
query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      number
      title
      headRefName
      url
      reviewThreads(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          isResolved
          path
          line
          comments(first: 20) {
            nodes {
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}`;



// ── Helpers ─────────────────────────────────────────────────────

async function getUnresolvedThreads(owner: string, repo: string, prNumber: number, cwd: string): Promise<ReviewThread[]> {
	const threads: ReviewThread[] = [];
	let cursor: string | null = null;
	const MAX_PAGES = 50;

	// Paginate through all review threads (100 per page, max 50 pages = 5000 threads)
	for (let page = 0; page < MAX_PAGES; page++) {
		const variables: Record<string, any> = { owner, repo, prNumber };
		if (cursor) variables.cursor = cursor;

		const data = await ghGraphql<any>(REVIEW_THREADS_QUERY, variables, cwd);
		const reviewThreads = data?.data?.repository?.pullRequest?.reviewThreads;
		if (!reviewThreads?.nodes) break;

		for (const node of reviewThreads.nodes) {
			if (node.isResolved) continue;

			const comments = (node.comments?.nodes ?? []).map((c: any) => ({
				author: c.author?.login ?? "unknown",
				body: c.body,
				createdAt: c.createdAt,
			}));

			if (comments.length === 0) continue;

			threads.push({
				id: node.id,
				isResolved: false,
				path: node.path ?? "",
				line: node.line,
				body: comments[0].body,
				author: comments[0].author,
				comments,
			});
		}

		if (!reviewThreads.pageInfo?.hasNextPage) break;
		cursor = reviewThreads.pageInfo.endCursor;
	}

	return threads;
}

/**
 * Scan open PRs for unresolved review threads.
 * Returns list of { number, title, headRefName, threadCount }.
 */
async function findPrsWithFeedback(
	owner: string,
	repo: string,
	cwd: string,
): Promise<{ number: number; title: string; headRefName: string; threadCount: number }[]> {
	const slug = `${owner}/${repo}`;
	const allPrs = await ghJson<any[]>(["pr", "list", "-R", slug, "--state", "open", "--json", "number,title,headRefName", "--limit", "20"]);
	if (!allPrs || allPrs.length === 0) return [];

	const results = (await Promise.all(
		allPrs.map(async (pr) => {
			const threads = await getUnresolvedThreads(owner, repo, pr.number, cwd);
			if (threads.length > 0) {
				return {
					number: pr.number as number,
					title: pr.title as string,
					headRefName: pr.headRefName as string,
					threadCount: threads.length,
				};
			}
			return null;
		}),
	)).filter((r): r is NonNullable<typeof r> => r !== null);

	return results;
}



// ── Format review feedback for the agent ────────────────────────

function formatThreadsForAgent(threads: ReviewThread[], prInfo: PrInfo, localPath?: string): string {
	const lines: string[] = [];

	lines.push(`## PR #${prInfo.number}: ${prInfo.title}`);
	lines.push(`**Repo:** ${prInfo.owner}/${prInfo.repo}`);
	lines.push(`**Branch:** \`${prInfo.headRefName}\``);
	if (localPath) lines.push(`**Local path:** \`${localPath}\``);
	lines.push(`**URL:** ${prInfo.url}`);
	lines.push("");
	lines.push(`### ${threads.length} unresolved review thread${threads.length !== 1 ? "s" : ""}:`);
	lines.push("");

	for (let i = 0; i < threads.length; i++) {
		const t = threads[i];
		const location = t.path ? `\`${t.path}\`${t.line ? `:${t.line}` : ""}` : "General";

		lines.push(`#### Thread ${i + 1} — ${location}`);
		lines.push(`**${t.author}:**`);
		lines.push(t.body);

		// Show follow-up comments if any
		if (t.comments.length > 1) {
			for (let j = 1; j < t.comments.length; j++) {
				const c = t.comments[j];
				lines.push("");
				lines.push(`**${c.author}** (follow-up):`);
				lines.push(c.body);
			}
		}
		lines.push("");
		lines.push("---");
		lines.push("");
	}

	const repoSlug = `${prInfo.owner}/${prInfo.repo}`;

	lines.push("**Instructions:**");
	lines.push("1. Present each thread above to the user as a numbered list with a brief summary of the feedback and your assessment (agree/disagree/needs discussion).");
	lines.push("2. If any feedback is ambiguous, subjective, or you disagree with it, flag it and ask the user what they want to do.");
	lines.push("3. Wait for the user to confirm which threads to fix before making any code changes.");
	lines.push(`4. After fixing, commit the changes (in \`${localPath ?? "the repo"}\`), push the branch, then resolve each addressed thread on GitHub and post a summary comment.`);
	lines.push("");
	lines.push("**Thread IDs for resolution (use after fixing):**");
	lines.push("```");
	for (let i = 0; i < threads.length; i++) {
		lines.push(`Thread ${i + 1}: ${threads[i].id}`);
	}
	lines.push("```");
	lines.push("");
	lines.push("**After pushing, for each addressed thread:**");
	lines.push("1. Reply to the thread with a short summary of the fix:");
	lines.push("```bash");
	lines.push(`gh api graphql -f query='mutation { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: "THREAD_ID", body: "Fixed — <brief description of what was done>"}) { comment { id } } }'`);
	lines.push("```");
	lines.push("2. Then resolve the thread:");
	lines.push("```bash");
	lines.push(`gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "THREAD_ID"}) { thread { isResolved } } }'`);
	lines.push("```");
	lines.push("");
	lines.push(`**Finally, post a summary comment on the PR:** \`gh pr comment ${prInfo.number} -R ${repoSlug} --body '...'\``);

	return lines.join("\n");
}

/**
 * Format a list of PRs with feedback for the agent to present to the user.
 */
function formatPrListForAgent(
	prsWithFeedback: { number: number; title: string; headRefName: string; threadCount: number }[],
	repoSlug: string,
): string {
	const lines: string[] = [];
	lines.push(`## PRs with unresolved review feedback on ${repoSlug}`);
	lines.push("");
	lines.push("Ask the user which PR to work on:");
	lines.push("");
	for (const pr of prsWithFeedback) {
		lines.push(`- **PR #${pr.number}**: ${pr.title} — ${pr.threadCount} unresolved thread${pr.threadCount !== 1 ? "s" : ""} (\`${pr.headRefName}\`)`);
	}
	lines.push("");
	lines.push(`Once confirmed, run: \`/gh-pr-fix ${repoSlug}#<number>\``);
	return lines.join("\n");
}


// ── Register the command ────────────────────────────────────────

export function registerPrFixCommand(pi: ExtensionAPI, log: LogFn, getCwd: () => string): void {
	const sendUserMessage = pi.sendUserMessage.bind(pi);

	registerDualCommand(pi, "gh-pr-fix", "github-pr-fix", {
		description: "Fix PR review feedback. Usage: /gh-pr-fix [number | owner/repo#N | repo#N | PR-URL]",
		handler: async (args: string, ctx: any) => {
			const cwd = getCwd();
			const { ref, remaining } = extractRepoRef(args);

			// Warn if input was provided but couldn't be parsed as a repo/PR ref
			if (args.trim() && !ref.owner && !ref.repo && ref.prNumber === null) {
				ctx.ui.notify(`⚠️ Could not parse "${args.trim()}" as a PR reference. Falling back to auto-detection.`, "warn");
			}

			// ── Step 1: Resolve repo ────────────────────────────
			const resolved = await resolveRepo(ref, cwd);
			if (!resolved) {
				ctx.ui.notify("❌ Could not determine repo. Use: /gh-pr-fix owner/repo#N or a PR URL.", "error");
				return;
			}
			const { owner, repo, slug: repoSlug } = resolved;
			const rFlag = repoFlag(owner, repo);

			// ── Step 2: Resolve PR number ───────────────────────
			let prNumber = ref.prNumber;

			if (!prNumber) {
				// Try to detect from current branch
				const branch = await getCurrentBranch(cwd);
				if (branch && branch !== "main" && branch !== "master") {
					const prs = await ghJson<any[]>(["pr", "list", ...rFlag, "--head", branch, "--json", "number"]);
					prNumber = prs?.[0]?.number ?? null;
				}

				// No PR from branch — scan all open PRs for feedback
				if (!prNumber) {
					ctx.ui.notify(`Scanning open PRs on ${repoSlug} for unresolved review threads…`, "info");
					const prsWithFeedback = await findPrsWithFeedback(owner, repo, cwd);

					if (prsWithFeedback.length === 0) {
						ctx.ui.notify(`✅ No open PRs on ${repoSlug} have unresolved review threads!`, "info");
						return;
					}

					if (prsWithFeedback.length === 1) {
						// Only one PR has feedback — use it directly
						prNumber = prsWithFeedback[0].number;
						ctx.ui.notify(`Found feedback on PR #${prNumber} (${prsWithFeedback[0].title}).`, "info");
					} else {
						// Multiple PRs — ask the user
						const prompt = formatPrListForAgent(prsWithFeedback, repoSlug);
						ctx.ui.notify(`Found ${prsWithFeedback.length} PRs with unresolved feedback. Asking which to work on…`, "info");
						sendUserMessage(prompt, { deliverAs: "followUp" });
						return;
					}
				}
			}

			if (!prNumber) {
				ctx.ui.notify("❌ Could not determine PR number.", "error");
				return;
			}

			// ── Step 3: Fetch unresolved threads ────────────────
			ctx.ui.notify(`Fetching review feedback for ${repoSlug}#${prNumber}…`, "info");

			const threads = await getUnresolvedThreads(owner, repo, prNumber, cwd);
			if (threads.length === 0) {
				ctx.ui.notify(`✅ ${repoSlug}#${prNumber} has no unresolved review threads!`, "info");
				return;
			}

			// ── Step 4: Get PR info ─────────────────────────────
			const prData = await ghJson<any>(["pr", "view", String(prNumber), ...rFlag, "--json", "headRefName,number,title,url"]);
			if (!prData?.headRefName) {
				ctx.ui.notify(`❌ Could not fetch PR #${prNumber} info from ${repoSlug}.`, "error");
				return;
			}

			const prInfo: PrInfo = {
				number: prNumber,
				title: prData.title ?? `PR #${prNumber}`,
				headRefName: prData.headRefName ?? "unknown",
				url: prData.url ?? "",
				owner,
				repo,
			};

			// ── Step 5: Ensure we're on the PR branch ───────────
			let localPath = await resolveLocalClone(repo, owner);
			if (!localPath) {
				// Verify cwd is actually the target repo before falling back
				const cwdRepo = await ghJson<{ owner: { login: string }; name: string }>(
					["repo", "view", "--json", "owner,name"],
					cwd,
				);
				if (!cwdRepo) {
					ctx.ui.notify(
						`❌ No local clone found for ${repoSlug} and current directory is not a git repository. Clone ${repoSlug} or cd into it first.`,
						"error",
					);
					return;
				}
				if (cwdRepo.owner.login !== owner || cwdRepo.name !== repo) {
					ctx.ui.notify(
						`❌ No local clone found for ${repoSlug} and current directory is a different repo (${cwdRepo.owner.login}/${cwdRepo.name}). Clone ${repoSlug} or cd into it first.`,
						"error",
					);
					return;
				}
				localPath = cwd;
			}
			const prBranch = prData.headRefName;
			const currentBranch = await getCurrentBranch(localPath);

			if (currentBranch !== prBranch) {
				// Check if the branch is checked out in a worktree
				const worktreePath = await findWorktreeForBranch(prBranch, localPath);
				if (worktreePath) {
					localPath = worktreePath;
					ctx.ui.notify(`Branch \`${prBranch}\` is in worktree at \`${worktreePath}\`. Working there.`, "info");
				} else {
					const status = await gitExec(["status", "--porcelain"], localPath);
					if (status.ok && status.stdout.length > 0) {
						ctx.ui.notify(`❌ Working tree at ${localPath} has uncommitted changes. Commit or stash before running /gh-pr-fix.`, "error");
						return;
					}

					ctx.ui.notify(`Switching to branch \`${prBranch}\` in ${localPath}…`, "info");
					const checkout = await gitExec(["checkout", prBranch], localPath);
					if (!checkout.ok) {
						const localExists = await gitExec(["branch", "--list", prBranch], localPath);
						if (localExists.ok && localExists.stdout.length > 0) {
							ctx.ui.notify(`❌ Could not checkout branch \`${prBranch}\`: ${checkout.stderr}`, "error");
							return;
						}
						const fetchResult = await gitExec(["fetch", "origin", prBranch], localPath, 30_000);
						if (!fetchResult.ok) {
							ctx.ui.notify(`❌ Failed to fetch branch \`${prBranch}\` from origin: ${fetchResult.stderr}`, "error");
							return;
						}
						const retry = await gitExec(["checkout", "-b", prBranch, `origin/${prBranch}`], localPath);
						if (!retry.ok) {
							ctx.ui.notify(`❌ Could not checkout branch \`${prBranch}\`: ${retry.stderr}`, "error");
							return;
						}
					}
				}
			}

			// ── Step 5b: Pull latest from origin ────────────
			const pullStatus = await gitExec(["status", "--porcelain"], localPath);
			if (pullStatus.ok && pullStatus.stdout.length > 0) {
				ctx.ui.notify(`⚠️ Working tree at \`${localPath}\` has uncommitted changes — skipping pull.`, "warning");
			} else {
				ctx.ui.notify(`Pulling latest \`${prBranch}\` from origin…`, "info");
				const pull = await gitExec(["pull", "--ff-only", "origin", prBranch], localPath, 30_000);
				if (!pull.ok) {
					// Non-fatal — local might have unpushed commits, warn and continue
					ctx.ui.notify(`⚠️ Could not fast-forward \`${prBranch}\`: ${pull.stderr}. Continuing with local state.`, "warning");
				}
			}

			log("pr-fix-start", { repo: repoSlug, prNumber, threadCount: threads.length, localPath });

			// ── Step 6: Send feedback to agent for validation ───
			const prompt = formatThreadsForAgent(threads, prInfo, localPath);
			ctx.ui.notify(`Found ${threads.length} unresolved thread${threads.length !== 1 ? "s" : ""} on ${repoSlug}#${prNumber}. Presenting for review…`, "info");

			sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});

}
