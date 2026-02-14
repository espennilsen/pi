/**
 * pi-github — /gh-pr-fix command.
 *
 * Workflow:
 *   1. Find the PR for the current branch (or specified PR number)
 *   2. Fetch all unresolved review threads from the PR
 *   3. Present them as a structured prompt to the agent
 *   4. After the agent fixes and commits, resolve the threads on GitHub
 *   5. Post a summary comment on the PR linking the fix commit
 *
 * Uses gh CLI + GraphQL for thread resolution.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { gh, ghJson, ghGraphql, getCurrentBranch } from "./gh.ts";

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

const RESOLVE_THREAD_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
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

async function resolveThread(threadId: string, cwd: string): Promise<boolean> {
	const result = await ghGraphql<any>(RESOLVE_THREAD_MUTATION, { threadId }, cwd);
	return !!result?.data?.resolveReviewThread?.thread?.isResolved;
}

async function gitExec(args: string[], cwd: string, timeoutMs = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
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

async function getLatestCommitSha(cwd: string): Promise<string | null> {
	const result = await gitExec(["rev-parse", "HEAD"], cwd);
	return result.ok ? result.stdout : null;
}

async function postPrComment(prNumber: number, body: string, cwd: string): Promise<boolean> {
	const result = await gh(["pr", "comment", String(prNumber), "--body", body], cwd);
	return result.ok;
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

	lines.push("**Instructions:** Fix each issue above. After fixing, I will commit the changes, resolve the threads on GitHub, and post a summary comment.");

	return lines.join("\n");
}

// ── Build summary comment for GitHub ────────────────────────────

function buildSummaryComment(threads: ReviewThread[], commitSha: string, resolvedCount: number, resolvedIds: Set<string>): string {
	const lines: string[] = [];

	lines.push(`### 🔧 Review feedback addressed in ${commitSha.slice(0, 7)}`);
	lines.push("");
	lines.push(`Resolved ${resolvedCount}/${threads.length} review thread${threads.length !== 1 ? "s" : ""}:`);
	lines.push("");

	for (const t of threads) {
		const location = t.path ? `\`${t.path}\`${t.line ? `:${t.line}` : ""}` : "General";
		const icon = resolvedIds.has(t.id) ? "✅" : "❌";
		lines.push(`- ${icon} ${location} — ${t.body.split("\n")[0].slice(0, 120)}`);
	}

	lines.push("");
	lines.push(`_Addressed by pi-github /gh-pr-fix_`);

	return lines.join("\n");
}

// ── Register the command ────────────────────────────────────────

export function registerPrFixCommand(pi: ExtensionAPI, log: LogFn, getCwd: () => string): void {
	const sendUserMessage = pi.sendUserMessage.bind(pi);

	function registerDual(shortName: string, longName: string, def: any): void {
		pi.registerCommand(shortName, def);
		pi.registerCommand(longName, def);
	}

	registerDual("gh-pr-fix", "github-pr-fix", {
		description: "Fix PR review feedback: /gh-pr-fix [pr-number]. Fetches unresolved threads, sends to agent, then resolves them.",
		handler: async (args: string | undefined, ctx: any) => {
			const cwd = getCwd();
			const argStr = args?.trim().replace(/^#/, "") ?? "";

			// ── Step 1: Find PR ─────────────────────────────────
			let prNumber: number | null = null;

			if (argStr && !isNaN(parseInt(argStr, 10))) {
				prNumber = parseInt(argStr, 10);
			} else {
				const branch = await getCurrentBranch(cwd);
				if (!branch) {
					ctx.ui.notify("❌ Not in a git repo.", "error");
					return;
				}
				if (branch === "main" || branch === "master") {
					// On main/master — find the most recent open PR with changes requested
					ctx.ui.notify("On main — looking for open PRs with changes requested…", "info");
					const prs = await ghJson<any[]>(["pr", "list", "--state", "open", "--search", "review:changes-requested", "--json", "number,title,headRefName", "--limit", "10"], cwd);
					if (!prs || prs.length === 0) {
						// Fall back to most recent open PR
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

			// ── Step 3: Fetch unresolved threads BEFORE switching branches ──
			ctx.ui.notify(`Fetching review feedback for PR #${prNumber}…`, "info");

			const threads = await getUnresolvedThreads(repoInfo.owner, repoInfo.repo, prNumber, cwd);
			if (threads.length === 0) {
				ctx.ui.notify(`✅ PR #${prNumber} has no unresolved review threads!`, "info");
				return;
			}

			// ── Step 4: Get PR info + ensure we're on the PR branch ─
			// Single gh pr view call for all needed fields
			const prData = await ghJson<any>(["pr", "view", String(prNumber), "--json", "headRefName,number,title,url"], cwd);
			if (!prData?.headRefName) {
				ctx.ui.notify(`❌ Could not fetch PR #${prNumber} branch info (network error or auth failure).`, "error");
				return;
			}

			const prInfo: PrInfo = {
				number: prNumber,
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
					// Check for dirty working tree before switching
					const status = await gitExec(["status", "--porcelain"], cwd);
					if (status.ok && status.stdout.length > 0) {
						ctx.ui.notify(`❌ Working tree has uncommitted changes. Commit or stash them before running /gh-pr-fix.\n\n${status.stdout}`, "error");
						return;
					}

					ctx.ui.notify(`Switching to branch \`${prBranch}\`…`, "info");
					const checkout = await gitExec(["checkout", prBranch], cwd);
					if (!checkout.ok) {
						// Branch might not exist locally — fetch it, then create a tracking branch
						const localExists = await gitExec(["branch", "--list", prBranch], cwd);
						if (localExists.ok && localExists.stdout.length > 0) {
							// Branch exists locally but checkout failed for another reason
							ctx.ui.notify(`❌ Could not checkout branch \`${prBranch}\`: ${checkout.stderr}`, "error");
							return;
						}
						// Branch doesn't exist locally — fetch and create tracking branch
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

			// ── Step 5: Send feedback to agent as user message ──
			const prompt = formatThreadsForAgent(threads, prInfo);
			ctx.ui.notify(`Found ${threads.length} unresolved thread${threads.length !== 1 ? "s" : ""} on PR #${prNumber}. Sending to agent…`, "info");

			// Send as a follow-up user message that the agent will process
			sendUserMessage(prompt, { deliverAs: "followUp" });

			// ── Step 6: Store threads for resolution ────────────
			// The agent will process the feedback. We store the threads
			// so /gh-pr-resolve can resolve them after the agent commits.
			pendingThreads = { prInfo, threads };

			ctx.ui.notify(
				`💡 After fixing the issues, run \`/gh-pr-resolve\` to resolve the threads on GitHub and post a summary comment.`,
				"info",
			);
		},
	});

	// ── /gh-pr-resolve · /github-pr-resolve ─────────────────────
	// Called after agent has fixed and committed the feedback.

	registerDual("gh-pr-resolve", "github-pr-resolve", {
		description: "Resolve pending PR review threads and post summary comment. Run after /gh-pr-fix.",
		handler: async (_args: string | undefined, ctx: any) => {
			const cwd = getCwd();

			if (!pendingThreads) {
				ctx.ui.notify("❌ No pending review threads. Run /gh-pr-fix first.", "error");
				return;
			}

			const { prInfo, threads } = pendingThreads;

			// Verify we're still on the PR branch before pushing
			const currentBranch = await getCurrentBranch(cwd);
			if (currentBranch !== prInfo.headRefName) {
				ctx.ui.notify(
					`❌ Current branch \`${currentBranch}\` does not match PR branch \`${prInfo.headRefName}\`.\n` +
					`Checkout \`${prInfo.headRefName}\` first, or run /gh-pr-fix again.`,
					"error",
				);
				return;
			}

			ctx.ui.notify(`Resolving ${threads.length} thread${threads.length !== 1 ? "s" : ""} on PR #${prInfo.number}…`, "info");

			// Get the latest commit SHA for the summary
			const commitSha = await getLatestCommitSha(cwd);
			if (!commitSha) {
				ctx.ui.notify("⚠️ Could not get latest commit SHA.", "warning");
			}

			const errors: string[] = [];

			// Push the branch FIRST — abort if it fails so we don't
			// resolve threads / post comments referencing a non-existent remote commit
			const pushResult = await gitExec(["push", "origin", "HEAD"], cwd, 30_000);
			if (!pushResult.ok) {
				errors.push(`git push failed: ${pushResult.stderr}`);
				ctx.ui.notify(`❌ git push failed — threads not resolved.\n${pushResult.stderr}`, "error");
				// Don't clear pendingThreads so the user can retry
				log("pr-fix-resolve", { prNumber: prInfo.number, resolved: 0, total: threads.length, errors: 1, pushFailed: true });
				return;
			}

			// Resolve each thread
			let resolved = 0;
			const resolvedIds = new Set<string>();

			for (const thread of threads) {
				try {
					const ok = await resolveThread(thread.id, cwd);
					if (ok) {
						resolved++;
						resolvedIds.add(thread.id);
					} else {
						errors.push(`Thread at ${thread.path}:${thread.line ?? "?"} — failed to resolve`);
					}
				} catch (err: any) {
					errors.push(`Thread at ${thread.path}:${thread.line ?? "?"} — ${err.message}`);
				}
			}

			// Post summary comment
			if (commitSha) {
				const comment = buildSummaryComment(threads, commitSha, resolved, resolvedIds);
				const posted = await postPrComment(prInfo.number, comment, cwd);
				if (!posted) {
					errors.push("Failed to post summary comment");
				}
			}

			pendingThreads = null;

			const lines: string[] = [];
			lines.push(`✅ Resolved ${resolved}/${threads.length} threads on PR #${prInfo.number}`);
			if (commitSha) lines.push(`Commit: ${commitSha.slice(0, 7)}`);
			if (errors.length > 0) {
				lines.push("");
				lines.push(`⚠️ ${errors.length} issue${errors.length !== 1 ? "s" : ""}:`);
				lines.push(...errors.map(e => `  - ${e}`));
			}

			ctx.ui.notify(lines.join("\n"), errors.length > 0 ? "warning" : "info");
			log("pr-fix-resolve", { prNumber: prInfo.number, resolved, total: threads.length, errors: errors.length });
		},
	});
}

// ── State ───────────────────────────────────────────────────────

let pendingThreads: { prInfo: PrInfo; threads: ReviewThread[] } | null = null;

export function resetPendingThreads(): void {
	pendingThreads = null;
}
