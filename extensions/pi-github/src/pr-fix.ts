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
	lines.push(`**Finally, post a summary comment on the PR:** \`gh pr comment ${prInfo.number} -R ${prInfo.owner}/${prInfo.repo} --body '...'\``);

	return lines.join("\n");
}



// ── Arg Parsing ─────────────────────────────────────────────────

interface ParsedPrRef {
	owner: string | null;
	repo: string | null;
	prNumber: number | null;
}

/**
 * Parse PR reference from args. Supports:
 *   - GitHub URL:       https://github.com/owner/repo/pull/123
 *   - Owner/repo#N:     owner/repo#123
 *   - Plain number:     123
 *   - Empty (auto-detect from branch)
 */
function parsePrRef(argStr: string): ParsedPrRef {
	const result: ParsedPrRef = { owner: null, repo: null, prNumber: null };
	if (!argStr) return result;

	// GitHub URL: https://github.com/owner/repo/pull/123
	const urlMatch = argStr.match(
		/(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
	);
	if (urlMatch) {
		result.owner = urlMatch[1];
		result.repo = urlMatch[2];
		result.prNumber = parseInt(urlMatch[3], 10);
		return result;
	}

	// owner/repo#N
	const refMatch = argStr.match(/^([^/]+)\/([^#]+)#(\d+)$/);
	if (refMatch) {
		result.owner = refMatch[1];
		result.repo = refMatch[2];
		result.prNumber = parseInt(refMatch[3], 10);
		return result;
	}

	// Plain number
	if (/^\d+$/.test(argStr)) {
		result.prNumber = parseInt(argStr, 10);
		return result;
	}

	return result;
}

/**
 * Resolve local clone path for a repo name.
 * Checks ~/Dev/<repo> first, then scans ~/Dev for a matching git remote.
 */
async function resolveLocalClone(repoName: string, owner: string): Promise<string | null> {
	const { existsSync } = await import("node:fs");
	const { readdir } = await import("node:fs/promises");
	const path = await import("node:path");
	const homeDir = process.env.HOME || process.env.USERPROFILE || "";
	const devDir = path.join(homeDir, "Dev");

	// Direct match: ~/Dev/<repo>
	const direct = path.join(devDir, repoName);
	if (existsSync(direct)) {
		const isGit = await gitExec(["rev-parse", "--is-inside-work-tree"], direct);
		if (isGit.ok) return direct;
	}

	// Scan ~/Dev for a repo with matching remote
	const fullSlug = `${owner}/${repoName}`;
	try {
		const entries = await readdir(devDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dir = path.join(devDir, entry.name);
			const remote = await gitExec(["remote", "get-url", "origin"], dir);
			if (remote.ok && remote.stdout.includes(fullSlug)) {
				return dir;
			}
		}
	} catch {
		// devDir doesn't exist or not readable
	}

	return null;
}


// ── Register the command ────────────────────────────────────────

export function registerPrFixCommand(pi: ExtensionAPI, log: LogFn, getCwd: () => string): void {
	const sendUserMessage = pi.sendUserMessage.bind(pi);

	registerDualCommand(pi, "gh-pr-fix", "github-pr-fix", {
		description: "Fix PR review feedback. Usage: /gh-pr-fix [number | owner/repo#number | PR-URL]",
		handler: async (args: string, ctx: any) => {
			const cwd = getCwd();
			const argStr = args.replace(/^#/, "").trim();
			const ref = parsePrRef(argStr);

			// ── Step 1: Resolve owner/repo and PR number ────────
			let owner = ref.owner;
			let repo = ref.repo;
			let prNumber = ref.prNumber;

			// If owner/repo not provided, detect from cwd
			if (!owner || !repo) {
				const repoInfo = await getRepoOwnerAndName(cwd);
				if (repoInfo) {
					owner = repoInfo.owner;
					repo = repoInfo.repo;
				}
			}

			// If PR number not provided, detect from branch
			if (!prNumber) {
				if (!owner || !repo) {
					ctx.ui.notify("❌ Could not determine repo. Use: /gh-pr-fix owner/repo#N or a PR URL.", "error");
					return;
				}
				const branch = await getCurrentBranch(cwd);
				if (!branch) {
					ctx.ui.notify("❌ Not in a git repo. Use: /gh-pr-fix owner/repo#N or a PR URL.", "error");
					return;
				}
				if (branch === "main" || branch === "master") {
					ctx.ui.notify("On main — looking for open PRs with changes requested…", "info");
					const prs = await ghJson<any[]>(["pr", "list", "-R", `${owner}/${repo}`, "--state", "open", "--search", "review:changes-requested", "--json", "number,title,headRefName", "--limit", "10"]);
					if (!prs || prs.length === 0) {
						const allPrs = await ghJson<any[]>(["pr", "list", "-R", `${owner}/${repo}`, "--state", "open", "--json", "number,title,headRefName", "--limit", "10"]);
						if (!allPrs || allPrs.length === 0) {
							ctx.ui.notify("❌ No open PRs found.", "error");
							return;
						}
						prNumber = allPrs[0].number;
						ctx.ui.notify(`No PRs with changes requested — using most recent open PR #${prNumber} (${allPrs[0].title}).`, "info");
					} else {
						prNumber = prs[0].number;
						ctx.ui.notify(`Found PR #${prNumber} (${prs[0].title}).`, "info");
					}
				} else {
					const prs = await ghJson<any[]>(["pr", "list", "-R", `${owner}/${repo}`, "--head", branch, "--json", "number"]);
					prNumber = prs?.[0]?.number ?? null;
					if (!prNumber) {
						ctx.ui.notify(`❌ No PR found for branch \`${branch}\`.`, "error");
						return;
					}
				}
			}

			if (!prNumber || !owner || !repo) {
				ctx.ui.notify("❌ Could not determine PR. Use: /gh-pr-fix owner/repo#N or a PR URL.", "error");
				return;
			}

			const repoSlug = `${owner}/${repo}`;

			// ── Step 2: Fetch unresolved threads ────────────────
			ctx.ui.notify(`Fetching review feedback for ${repoSlug}#${prNumber}…`, "info");

			const threads = await getUnresolvedThreads(owner, repo, prNumber, cwd);
			if (threads.length === 0) {
				ctx.ui.notify(`✅ ${repoSlug}#${prNumber} has no unresolved review threads!`, "info");
				return;
			}

			// ── Step 3: Get PR info ─────────────────────────────
			const prData = await ghJson<any>(["pr", "view", String(prNumber), "-R", repoSlug, "--json", "headRefName,number,title,url"]);
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

			// ── Step 4: Ensure we're on the PR branch ───────────
			// Resolve local clone (may differ from session cwd)
			const localPath = await resolveLocalClone(repo, owner) ?? cwd;
			const prBranch = prData.headRefName;
			const currentBranch = await getCurrentBranch(localPath);

			if (currentBranch !== prBranch) {
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

			log("pr-fix-start", { repo: repoSlug, prNumber, threadCount: threads.length, localPath });

			// ── Step 5: Send feedback to agent for validation ───
			const prompt = formatThreadsForAgent(threads, prInfo, localPath);
			ctx.ui.notify(`Found ${threads.length} unresolved thread${threads.length !== 1 ? "s" : ""} on ${repoSlug}#${prNumber}. Presenting for review…`, "info");

			sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});

}
