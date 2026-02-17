/**
 * pi-github — /gh-pr-fix command.
 *
 * Single-step workflow:
 *   1. Find the PR for the current branch (or specified PR number)
 *   2. Fetch all unresolved review threads from the PR
 *   3. Present them to the agent with thread IDs and instructions
 *   4. Agent validates with user, fixes code, commits, pushes,
 *      resolves threads via gh CLI, and posts summary comment
 *
 * No second invocation needed — thread IDs are included in the output
 * so the agent can resolve them directly via `gh api graphql`.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ghJson, ghGraphql, gitExec, getCurrentBranch } from "./gh.ts";
import { registerDualCommand } from "./commands.ts";

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
query($owner: String!, $repo: String!, $prNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      number
      title
      headRefName
      url
      reviewThreads(first: 100) {
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

async function getRepoOwnerAndName(cwd: string): Promise<{ owner: string; repo: string } | null> {
	const result = await ghJson<{ owner: { login: string }; name: string }>(
		["repo", "view", "--json", "owner,name"],
		cwd,
	);
	if (!result) return null;
	return { owner: result.owner.login, repo: result.name };
}

async function getPrForBranch(branch: string, cwd: string): Promise<number | null> {
	const prs = await ghJson<any[]>(["pr", "list", "--head", branch, "--json", "number"], cwd);
	if (!prs || prs.length === 0) return null;
	return prs[0].number;
}

async function getUnresolvedThreads(owner: string, repo: string, prNumber: number, cwd: string): Promise<ReviewThread[]> {
	const data = await ghGraphql<any>(REVIEW_THREADS_QUERY, { owner, repo, prNumber }, cwd);
	if (!data?.data?.repository?.pullRequest?.reviewThreads?.nodes) return [];

	const threads: ReviewThread[] = [];
	for (const node of data.data.repository.pullRequest.reviewThreads.nodes) {
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

	return threads;
}



// ── Format review feedback for the agent ────────────────────────

function formatThreadsForAgent(threads: ReviewThread[], prInfo: PrInfo): string {
	const lines: string[] = [];

	lines.push(`## PR #${prInfo.number}: ${prInfo.title}`);
	lines.push(`Branch: \`${prInfo.headRefName}\``);
	lines.push(`URL: ${prInfo.url}`);
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

	lines.push("**Instructions:**");
	lines.push("1. Present each thread above to the user as a numbered list with a brief summary of the feedback and your assessment (agree/disagree/needs discussion).");
	lines.push("2. If any feedback is ambiguous, subjective, or you disagree with it, flag it and ask the user what they want to do.");
	lines.push("3. Wait for the user to confirm which threads to fix before making any code changes.");
	lines.push("4. After fixing, commit the changes, push the branch, then resolve each addressed thread on GitHub and post a summary comment.");
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
	lines.push(`**Finally, post a summary comment on the PR:** \`gh pr comment ${prInfo.number} --body '...'\``);

	return lines.join("\n");
}



// ── Register the command ────────────────────────────────────────

export function registerPrFixCommand(pi: ExtensionAPI, log: LogFn, getCwd: () => string): void {
	const sendUserMessage = pi.sendUserMessage.bind(pi);

	registerDualCommand(pi, "gh-pr-fix", "github-pr-fix", {
		description: "Fix PR review feedback: /gh-pr-fix [pr-number] [/path/to/repo]. Fetches unresolved threads, presents them for review, and provides thread IDs for resolution after fixing.",
		handler: async (args: string, ctx: any) => {
			const argStr = args.replace(/^#/, "").trim();

			// Parse args: optional PR number and optional repo path
			let prNumber: number | null = null;
			let cwd = getCwd();
			const parts = argStr.split(/\s+/).filter(Boolean);

			for (const part of parts) {
				if (/^\d+$/.test(part)) {
					prNumber = parseInt(part, 10);
				} else {
					// Treat as a filesystem path to a repo
					const path = await import("node:path");
					const { existsSync } = await import("node:fs");
					const resolved = part.startsWith("/") ? part : path.resolve(getCwd(), part);
					if (existsSync(resolved)) {
						const isGit = await gitExec(["rev-parse", "--is-inside-work-tree"], resolved);
						if (isGit.ok) {
							cwd = resolved;
							ctx.ui.notify(`Using repo at ${cwd}`, "info");
						}
					}
				}
			}

			// ── Step 1: Find PR ─────────────────────────────────

			if (!prNumber) {
				const branch = await getCurrentBranch(cwd);
				if (!branch) {
					ctx.ui.notify("❌ Not in a git repo.", "error");
					return;
				}
				if (branch === "main" || branch === "master") {
					ctx.ui.notify("On main — looking for open PRs with changes requested…", "info");
					const prs = await ghJson<any[]>(["pr", "list", "--state", "open", "--search", "review:changes-requested", "--json", "number,title,headRefName", "--limit", "10"], cwd);
					if (!prs || prs.length === 0) {
						const allPrs = await ghJson<any[]>(["pr", "list", "--state", "open", "--json", "number,title,headRefName", "--limit", "10"], cwd);
						if (!allPrs || allPrs.length === 0) {
							ctx.ui.notify("❌ No open PRs found.", "error");
							return;
						}
						prNumber = allPrs[0].number;
						ctx.ui.notify(`No PRs with changes requested — using most recent open PR #${prNumber} (${allPrs[0].title}).`, "info");
					} else {
						prNumber = prs[0].number;
						ctx.ui.notify(`Found PR #${prNumber} (${prs[0].title}) — checking out \`${prs[0].headRefName}\`…`, "info");
					}
				} else {
					prNumber = await getPrForBranch(branch, cwd);
					if (!prNumber) {
						ctx.ui.notify(`❌ No PR found for branch \`${branch}\`.`, "error");
						return;
					}
				}
			}

			if (!prNumber) {
				ctx.ui.notify("❌ Could not determine PR number.", "error");
				return;
			}

			// ── Step 2: Get repo info ───────────────────────────
			const repoInfo = await getRepoOwnerAndName(cwd);
			if (!repoInfo) {
				ctx.ui.notify("❌ Could not determine repo owner/name.", "error");
				return;
			}

			// ── Step 3: Fetch unresolved threads ────────────────
			ctx.ui.notify(`Fetching review feedback for PR #${prNumber}…`, "info");

			let threads = await getUnresolvedThreads(repoInfo.owner, repoInfo.repo, prNumber!, cwd);

			// If no threads on current PR and user didn't specify a PR number,
			// scan other open PRs for unresolved feedback
			if (threads.length === 0 && !(argStr && !isNaN(parseInt(argStr, 10)))) {
				const allPrs = await ghJson<any[]>(["pr", "list", "--state", "open", "--json", "number,title,headRefName", "--limit", "20"], cwd);
				if (allPrs && allPrs.length > 0) {
					for (const pr of allPrs) {
						if (pr.number === prNumber) continue;
						const otherThreads = await getUnresolvedThreads(repoInfo.owner, repoInfo.repo, pr.number, cwd);
						if (otherThreads.length > 0) {
							ctx.ui.notify(`PR #${prNumber} is clean — found ${otherThreads.length} unresolved thread(s) on PR #${pr.number} (${pr.title}).`, "info");
							prNumber = pr.number;
							threads = otherThreads;
							break;
						}
					}
				}
			}

			if (threads.length === 0) {
				ctx.ui.notify(`✅ No open PRs have unresolved review threads!`, "info");
				return;
			}

			// ── Step 4: Get PR info + ensure we're on the PR branch ─
			const prData = await ghJson<any>(["pr", "view", String(prNumber), "--json", "headRefName,number,title,url"], cwd);
			if (!prData?.headRefName) {
				ctx.ui.notify(`❌ Could not fetch PR #${prNumber} branch info (network error or auth failure).`, "error");
				return;
			}

			const prInfo: PrInfo = {
				number: prNumber!,
				title: prData.title ?? `PR #${prNumber}`,
				headRefName: prData.headRefName ?? "unknown",
				url: prData.url ?? "",
				owner: repoInfo.owner,
				repo: repoInfo.repo,
			};

			{
				const prBranch = prData.headRefName;
				const currentBranch = await getCurrentBranch(cwd);
				if (currentBranch !== prBranch) {
					const status = await gitExec(["status", "--porcelain"], cwd);
					if (status.ok && status.stdout.length > 0) {
						ctx.ui.notify(`❌ Working tree has uncommitted changes. Commit or stash them before running /gh-pr-fix.\n\n${status.stdout}`, "error");
						return;
					}

					ctx.ui.notify(`Switching to branch \`${prBranch}\`…`, "info");
					const checkout = await gitExec(["checkout", prBranch], cwd);
					if (!checkout.ok) {
						const localExists = await gitExec(["branch", "--list", prBranch], cwd);
						if (localExists.ok && localExists.stdout.length > 0) {
							ctx.ui.notify(`❌ Could not checkout branch \`${prBranch}\`: ${checkout.stderr}`, "error");
							return;
						}
						const fetchResult = await gitExec(["fetch", "origin", prBranch], cwd, 30_000);
						if (!fetchResult.ok) {
							ctx.ui.notify(`❌ Failed to fetch branch \`${prBranch}\` from origin: ${fetchResult.stderr}`, "error");
							return;
						}
						const retry = await gitExec(["checkout", "-b", prBranch, `origin/${prBranch}`], cwd);
						if (!retry.ok) {
							ctx.ui.notify(`❌ Could not checkout branch \`${prBranch}\`: ${retry.stderr}`, "error");
							return;
						}
					}
				}
			}

			log("pr-fix-start", { prNumber, threadCount: threads.length });

			// ── Step 5: Send feedback to agent for validation ───
			const prompt = formatThreadsForAgent(threads, prInfo);
			ctx.ui.notify(`Found ${threads.length} unresolved thread${threads.length !== 1 ? "s" : ""} on PR #${prNumber}. Presenting for review…`, "info");

			sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});

}
