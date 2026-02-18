/**
 * pi-github — Command registrations.
 *
 * All commands are registered as /gh-* (short) and /github-* (long).
 * Commands use the gh CLI for all GitHub interactions.
 * All commands accept optional repo ref: owner/repo, repo (with default owner),
 * or GitHub URL — in addition to their normal arguments.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { gh, ghJson, getCurrentBranch } from "./gh.ts";
import { extractRepoRef, resolveRepo, repoFlag } from "./repo-ref.ts";

type LogFn = (event: string, data: unknown, level?: string) => void;

// ── Helpers ─────────────────────────────────────────────────────

export function registerDualCommand(
	pi: ExtensionAPI,
	shortName: string,
	longName: string,
	opts: {
		description: string;
		completions?: string[];
		handler: (args: string, ctx: any) => Promise<void>;
	},
) {
	const def = {
		description: opts.description,
		getArgumentCompletions: opts.completions
			? (prefix: string) => opts.completions!.filter(c => c.startsWith(prefix)).map(c => ({ value: c, label: c }))
			: undefined,
		handler: async (args: string | undefined, ctx: any) => {
			await opts.handler(args?.trim() ?? "", ctx);
		},
	};
	pi.registerCommand(shortName, def);
	pi.registerCommand(longName, def);
}

let sessionCwd = process.cwd();

export function setSessionCwd(cwd: string): void {
	sessionCwd = cwd;
}

// ── Register all commands ───────────────────────────────────────

export function registerCommands(pi: ExtensionAPI, log: LogFn): void {
	const sendUserMessage = pi.sendUserMessage.bind(pi);

	// ── /gh-prs · /github-prs ─────────────────────────────────

	registerDualCommand(pi, "gh-prs", "github-prs", {
		description: "List open pull requests: /gh-prs [author|review-requested|all] [owner/repo]",
		completions: ["", "mine", "review-requested", "all"],
		handler: async (args, ctx) => {
			const { ref, remaining: filter } = extractRepoRef(args);
			const resolved = await resolveRepo(ref, sessionCwd);
			if (!resolved) {
				ctx.ui.notify("❌ Could not determine repo. Specify owner/repo or run from a git repo.", "error");
				return;
			}
			const rFlag = repoFlag(resolved.owner, resolved.repo);

			const ghArgs = ["pr", "list", ...rFlag, "--json", "number,title,author,headRefName,createdAt,reviewDecision,isDraft,url", "--limit", "25"];

			if (filter === "mine") {
				ghArgs.push("--author", "@me");
			} else if (filter === "review-requested") {
				ghArgs.push("--search", "review-requested:@me");
			}

			const prs = await ghJson<any[]>(ghArgs);
			if (!prs || prs.length === 0) {
				ctx.ui.notify(`No open pull requests on ${resolved.slug}.`, "info");
				return;
			}

			const lines = prs.map((pr: any) => {
				const draft = pr.isDraft ? " 📝" : "";
				const review = pr.reviewDecision === "APPROVED" ? " ✅" : pr.reviewDecision === "CHANGES_REQUESTED" ? " 🔴" : "";
				return `#${pr.number}${draft}${review} ${pr.title} (${pr.headRefName}) — ${pr.author?.login ?? "?"}`;
			});

			ctx.ui.notify(`**Open PRs on ${resolved.slug}** (${prs.length})\n${lines.join("\n")}`, "info");
			log("prs", { repo: resolved.slug, count: prs.length, filter });
		},
	});

	// ── /gh-issues · /github-issues ───────────────────────────

	registerDualCommand(pi, "gh-issues", "github-issues", {
		description: "List open issues: /gh-issues [mine|label:bug|all] [owner/repo]",
		completions: ["", "mine", "all"],
		handler: async (args, ctx) => {
			const { ref, remaining: filter } = extractRepoRef(args);
			const resolved = await resolveRepo(ref, sessionCwd);
			if (!resolved) {
				ctx.ui.notify("❌ Could not determine repo. Specify owner/repo or run from a git repo.", "error");
				return;
			}
			const rFlag = repoFlag(resolved.owner, resolved.repo);

			const ghArgs = ["issue", "list", ...rFlag, "--json", "number,title,author,labels,createdAt,assignees,url", "--limit", "25"];

			if (filter === "mine") {
				ghArgs.push("--assignee", "@me");
			} else if (filter.startsWith("label:")) {
				ghArgs.push("--label", filter.slice(6));
			}

			const issues = await ghJson<any[]>(ghArgs);
			if (!issues || issues.length === 0) {
				ctx.ui.notify(`No open issues on ${resolved.slug}.`, "info");
				return;
			}

			const lines = issues.map((i: any) => {
				const labels = i.labels?.map((l: any) => l.name).join(", ") || "";
				const labelStr = labels ? ` [${labels}]` : "";
				return `#${i.number}${labelStr} ${i.title} — ${i.author?.login ?? "?"}`;
			});

			ctx.ui.notify(`**Open Issues on ${resolved.slug}** (${issues.length})\n${lines.join("\n")}`, "info");
			log("issues", { repo: resolved.slug, count: issues.length, filter });
		},
	});

	// ── /gh-status · /github-status ───────────────────────────

	registerDualCommand(pi, "gh-status", "github-status", {
		description: "Show repo status: PRs, issues, CI, branch: /gh-status [owner/repo]",
		handler: async (args, ctx) => {
			const { ref } = extractRepoRef(args);
			const resolved = await resolveRepo(ref, sessionCwd);
			if (!resolved) {
				ctx.ui.notify("❌ Could not determine repo. Specify owner/repo or run from a git repo.", "error");
				return;
			}
			const rFlag = repoFlag(resolved.owner, resolved.repo);

			// Only show local branch when targeting the cwd repo (not a remote repo)
			const isLocalRepo = rFlag.length === 0;
			const branch = isLocalRepo ? await getCurrentBranch(sessionCwd) : null;

			const lines: string[] = [];
			lines.push(`**Repo:** ${resolved.slug}`);
			if (branch) lines.push(`**Branch:** ${branch}`);
			lines.push("");

			// Open PRs count
			const prs = await ghJson<any[]>(["pr", "list", ...rFlag, "--json", "number", "--limit", "100"]);
			lines.push(`**Open PRs:** ${prs?.length ?? "?"}`);

			// My PRs needing attention
			const myPrs = await ghJson<any[]>(["pr", "list", ...rFlag, "--author", "@me", "--json", "number,title,reviewDecision"]);
			if (myPrs && myPrs.length > 0) {
				const needsWork = myPrs.filter((p: any) => p.reviewDecision === "CHANGES_REQUESTED");
				const approved = myPrs.filter((p: any) => p.reviewDecision === "APPROVED");
				lines.push(`  Mine: ${myPrs.length} open (${approved.length} approved, ${needsWork.length} changes requested)`);
			}

			// Review requests
			const reviewReqs = await ghJson<any[]>(["pr", "list", ...rFlag, "--search", "review-requested:@me", "--json", "number"]);
			if (reviewReqs && reviewReqs.length > 0) {
				lines.push(`  Review requested: ${reviewReqs.length}`);
			}

			// Open issues count
			const issues = await ghJson<any[]>(["issue", "list", ...rFlag, "--json", "number", "--limit", "100"]);
			lines.push(`**Open Issues:** ${issues?.length ?? "?"}`);

			// Current branch PR (only for local repos)
			if (isLocalRepo && branch && branch !== "main" && branch !== "master") {
				const branchPr = await ghJson<any[]>(["pr", "list", ...rFlag, "--head", branch, "--json", "number,title,state,reviewDecision,url"]);
				if (branchPr && branchPr.length > 0) {
					const pr = branchPr[0];
					const review = pr.reviewDecision === "APPROVED" ? "✅" : pr.reviewDecision === "CHANGES_REQUESTED" ? "🔴" : "⏳";
					lines.push("");
					lines.push(`**Current branch PR:** #${pr.number} ${review} ${pr.title}`);
					lines.push(`  ${pr.url}`);
				}
			}

			// CI status (branch-scoped for local repos only)
			if (isLocalRepo && branch) {
				const ci = await gh(["run", "list", ...rFlag, "--branch", branch, "--limit", "1", "--json", "status,conclusion,name,url"]);
				if (ci.ok) {
					try {
						const runs = JSON.parse(ci.stdout);
						if (runs.length > 0) {
							const run = runs[0];
							const icon = run.conclusion === "success" ? "✅" : run.conclusion === "failure" ? "❌" : "🔄";
							lines.push(`**CI:** ${icon} ${run.name} (${run.conclusion ?? run.status})`);
						}
					} catch { /* ignore */ }
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
			log("status", { repo: resolved.slug, branch });
		},
	});

	// ── /gh-notifications · /github-notifications ─────────────

	registerDualCommand(pi, "gh-notifications", "github-notifications", {
		description: "Show unread GitHub notifications: /gh-notifications [all]",
		completions: ["", "all"],
		handler: async (args, ctx) => {
			const ghArgs = ["api", "/notifications", "--jq", ".[] | {id: .id, reason: .reason, title: .subject.title, type: .subject.type, repo: .repository.full_name, updated: .updated_at}"];

			const result = await gh(ghArgs);
			if (!result.ok || !result.stdout) {
				ctx.ui.notify("No unread notifications.", "info");
				return;
			}

			// Parse JSONL output
			const notifications = result.stdout.split("\n").filter(Boolean).map(line => {
				try { return JSON.parse(line); } catch { return null; }
			}).filter(Boolean);

			if (notifications.length === 0) {
				ctx.ui.notify("No unread notifications.", "info");
				return;
			}

			const lines = notifications.slice(0, 20).map((n: any) => {
				const icon = n.type === "PullRequest" ? "🔀" : n.type === "Issue" ? "🐛" : "📋";
				return `${icon} [${n.reason}] ${n.title} (${n.repo})`;
			});

			const more = notifications.length > 20 ? `\n_… and ${notifications.length - 20} more_` : "";
			ctx.ui.notify(`**Notifications** (${notifications.length})\n${lines.join("\n")}${more}`, "info");
			log("notifications", { count: notifications.length });
		},
	});

	// ── /gh-pr-create · /github-pr-create ─────────────────────

	registerDualCommand(pi, "gh-pr-create", "github-pr-create", {
		description: "Create a PR for the current branch with an LLM-generated summary: /gh-pr-create [base-branch]",
		handler: async (args, ctx) => {
			const branch = await getCurrentBranch(sessionCwd);
			if (!branch || branch === "main" || branch === "master") {
				ctx.ui.notify("❌ Cannot create PR from main/master branch.", "error");
				return;
			}

			const base = args.trim() || "main";

			// Check if a PR already exists for this branch
			const existing = await ghJson<any[]>(["pr", "list", "--head", branch, "--json", "number,url"], sessionCwd);
			if (existing && existing.length > 0) {
				ctx.ui.notify(`❌ PR already exists for branch \`${branch}\`: ${existing[0].url}`, "error");
				return;
			}

			// Push the branch first
			const pushResult = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
				execFile("git", ["push", "-u", "origin", branch], { cwd: sessionCwd, timeout: 30_000 }, (err, _stdout, stderr) => {
					resolve({ ok: !err, stderr: stderr?.trim() ?? "" });
				});
			});
			if (!pushResult.ok) {
				ctx.ui.notify(`❌ Failed to push branch \`${branch}\`: ${pushResult.stderr}`, "error");
				return;
			}

			// Gather context: commits and diff summary
			ctx.ui.notify(`📝 Gathering diff for \`${branch}\` → \`${base}\`…`, "info");

			const commitsResult = await new Promise<{ ok: boolean; stdout: string }>((resolve) => {
				execFile("git", ["log", `${base}..${branch}`, "--pretty=format:%h %s", "--reverse"], { cwd: sessionCwd, timeout: 10_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
					resolve({ ok: !err, stdout: stdout?.trim() ?? "" });
				});
			});

			const diffStatResult = await new Promise<{ ok: boolean; stdout: string }>((resolve) => {
				execFile("git", ["diff", `${base}...${branch}`, "--stat"], { cwd: sessionCwd, timeout: 10_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
					resolve({ ok: !err, stdout: stdout?.trim() ?? "" });
				});
			});

			const diffResult = await new Promise<{ ok: boolean; stdout: string }>((resolve) => {
				execFile("git", ["diff", `${base}...${branch}`], { cwd: sessionCwd, timeout: 15_000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
					resolve({ ok: !err, stdout: stdout?.trim() ?? "" });
				});
			});

			// Truncate diff if too large
			const maxDiffLen = 50_000;
			let diff = diffResult.ok ? diffResult.stdout : "";
			if (diff.length > maxDiffLen) {
				diff = diff.slice(0, maxDiffLen) + "\n\n… (diff truncated)";
			}

			const prompt = [
				`Create a GitHub pull request for branch \`${branch}\` → \`${base}\`.`,
				"",
				"## Commits",
				"```",
				commitsResult.ok ? commitsResult.stdout : "(no commits found)",
				"```",
				"",
				"## Diff stat",
				"```",
				diffStatResult.ok ? diffStatResult.stdout : "(unavailable)",
				"```",
				"",
				"## Diff",
				"```diff",
				diff || "(empty diff)",
				"```",
				"",
				"## Instructions",
				"",
				"Based on the commits and diff above, write a clear PR title and description.",
				"Then create the PR by running:",
				"```bash",
				`gh pr create --base ${base} --title "YOUR TITLE" --body "YOUR DESCRIPTION"`,
				"```",
				"",
				"Guidelines for the PR description:",
				"- Start with a concise summary of what the PR does and why",
				"- List key changes as bullet points",
				"- Keep it factual — don't pad with filler",
				"- Use markdown formatting",
				"- If there are breaking changes, call them out explicitly",
				"",
				"**Before creating the PR, present your draft title and description to the user and ask if they have any input or changes.** Only run the `gh pr create` command after they confirm.",
			].join("\n");

			sendUserMessage(prompt, { deliverAs: "followUp" });
			log("pr-create", { branch, base });
		},
	});

	// ── /gh-actions · /github-actions ─────────────────────────

	registerDualCommand(pi, "gh-actions", "github-actions", {
		description: "List recent workflow runs: /gh-actions [branch] [owner/repo]",
		handler: async (args, ctx) => {
			const { ref, remaining } = extractRepoRef(args);
			const resolved = await resolveRepo(ref, sessionCwd);
			if (!resolved) {
				ctx.ui.notify("❌ Could not determine repo. Specify owner/repo or run from a git repo.", "error");
				return;
			}
			const rFlag = repoFlag(resolved.owner, resolved.repo);

			const ghArgs = ["run", "list", ...rFlag, "--limit", "10", "--json", "status,conclusion,name,headBranch,createdAt,url,event"];
			if (remaining) {
				ghArgs.push("--branch", remaining);
			}

			const runs = await ghJson<any[]>(ghArgs);
			if (!runs || runs.length === 0) {
				ctx.ui.notify(`No recent workflow runs on ${resolved.slug}.`, "info");
				return;
			}

			const lines = runs.map((r: any) => {
				const icon = r.conclusion === "success" ? "✅" : r.conclusion === "failure" ? "❌" : r.status === "in_progress" ? "🔄" : "⏳";
				return `${icon} ${r.name} (${r.headBranch}) — ${r.conclusion ?? r.status}`;
			});

			ctx.ui.notify(`**Workflow Runs on ${resolved.slug}** (${runs.length})\n${lines.join("\n")}`, "info");
			log("actions", { repo: resolved.slug, count: runs.length });
		},
	});

	// ── /gh-pr-review · /github-pr-review ─────────────────────

	registerDualCommand(pi, "gh-pr-review", "github-pr-review", {
		description: "Show PR review feedback: /gh-pr-review [pr-number | owner/repo#N | PR-URL]",
		handler: async (args, ctx) => {
			const { ref } = extractRepoRef(args);
			const resolved = await resolveRepo(ref, sessionCwd);
			if (!resolved) {
				ctx.ui.notify("❌ Could not determine repo. Specify owner/repo or run from a git repo.", "error");
				return;
			}
			const rFlag = repoFlag(resolved.owner, resolved.repo);

			let prNum = ref.prNumber;

			if (!prNum) {
				const branch = await getCurrentBranch(sessionCwd);
				if (!branch) {
					ctx.ui.notify("❌ Not in a git repo. Specify a PR number or owner/repo#N.", "error");
					return;
				}
				const branchPrs = await ghJson<any[]>(["pr", "list", ...rFlag, "--head", branch, "--json", "number"]);
				if (!branchPrs || branchPrs.length === 0) {
					ctx.ui.notify(`No PR found for branch \`${branch}\` on ${resolved.slug}.`, "info");
					return;
				}
				prNum = branchPrs[0].number;
			}

			const reviews = await ghJson<any>(["pr", "view", String(prNum), ...rFlag, "--json", "reviews,reviewRequests,title,state,reviewDecision"]);
			if (!reviews) {
				ctx.ui.notify(`❌ Could not fetch PR #${prNum} on ${resolved.slug}`, "error");
				return;
			}

			const lines: string[] = [];
			lines.push(`**PR #${prNum}: ${reviews.title}** (${resolved.slug})`);
			lines.push(`State: ${reviews.state} · Review: ${reviews.reviewDecision ?? "pending"}`);
			lines.push("");

			if (reviews.reviews?.length > 0) {
				for (const r of reviews.reviews) {
					const icon = r.state === "APPROVED" ? "✅" : r.state === "CHANGES_REQUESTED" ? "🔴" : "💬";
					lines.push(`${icon} **${r.author?.login ?? "?"}** — ${r.state}`);
					if (r.body) lines.push(`  ${r.body.slice(0, 300)}`);
				}
			} else {
				lines.push("No reviews yet.");
			}

			ctx.ui.notify(lines.join("\n"), "info");
			log("pr-review", { repo: resolved.slug, prNum });
		},
	});
}
