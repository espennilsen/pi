/**
 * pi-github — Command registrations.
 *
 * All commands are registered as /gh-* (short) and /github-* (long).
 * Commands use the gh CLI for all GitHub interactions.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { gh, ghJson, getCurrentBranch, getRepoSlug } from "./gh.ts";

type LogFn = (event: string, data: unknown, level?: string) => void;

// ── Helpers ─────────────────────────────────────────────────────

function registerDualCommand(
	pi: ExtensionAPI,
	shortName: string,
	longName: string,
	opts: {
		description: string;
		completions?: string[];
		handler: (args: string, ctx: any, cwd: string) => Promise<void>;
	},
) {
	const def = {
		description: opts.description,
		getArgumentCompletions: opts.completions
			? (prefix: string) => opts.completions!.filter(c => c.startsWith(prefix)).map(c => ({ value: c, label: c }))
			: undefined,
		handler: async (args: string | undefined, ctx: any) => {
			await opts.handler(args?.trim() ?? "", ctx, sessionCwd);
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

	// ── /gh-prs · /github-prs ─────────────────────────────────

	registerDualCommand(pi, "gh-prs", "github-prs", {
		description: "List open pull requests: /gh-prs [author|review-requested|all]",
		completions: ["", "mine", "review-requested", "all"],
		handler: async (args, ctx) => {
			const filter = args || "";
			const ghArgs = ["pr", "list", "--json", "number,title,author,headRefName,createdAt,reviewDecision,isDraft,url", "--limit", "25"];

			if (filter === "mine") {
				ghArgs.push("--author", "@me");
			} else if (filter === "review-requested") {
				ghArgs.push("--search", "review-requested:@me");
			} else if (filter !== "all") {
				// Default: show all open
			}

			const prs = await ghJson<any[]>(ghArgs, sessionCwd);
			if (!prs || prs.length === 0) {
				ctx.ui.notify("No open pull requests found.", "info");
				return;
			}

			const lines = prs.map((pr: any) => {
				const draft = pr.isDraft ? " 📝" : "";
				const review = pr.reviewDecision === "APPROVED" ? " ✅" : pr.reviewDecision === "CHANGES_REQUESTED" ? " 🔴" : "";
				return `#${pr.number}${draft}${review} ${pr.title} (${pr.headRefName}) — ${pr.author?.login ?? "?"}`;
			});

			ctx.ui.notify(`**Open PRs** (${prs.length})\n${lines.join("\n")}`, "info");
			log("prs", { count: prs.length, filter });
		},
	});

	// ── /gh-issues · /github-issues ───────────────────────────

	registerDualCommand(pi, "gh-issues", "github-issues", {
		description: "List open issues: /gh-issues [mine|label:bug|all]",
		completions: ["", "mine", "all"],
		handler: async (args, ctx) => {
			const filter = args || "";
			const ghArgs = ["issue", "list", "--json", "number,title,author,labels,createdAt,assignees,url", "--limit", "25"];

			if (filter === "mine") {
				ghArgs.push("--assignee", "@me");
			} else if (filter.startsWith("label:")) {
				ghArgs.push("--label", filter.slice(6));
			}

			const issues = await ghJson<any[]>(ghArgs, sessionCwd);
			if (!issues || issues.length === 0) {
				ctx.ui.notify("No open issues found.", "info");
				return;
			}

			const lines = issues.map((i: any) => {
				const labels = i.labels?.map((l: any) => l.name).join(", ") || "";
				const labelStr = labels ? ` [${labels}]` : "";
				return `#${i.number}${labelStr} ${i.title} — ${i.author?.login ?? "?"}`;
			});

			ctx.ui.notify(`**Open Issues** (${issues.length})\n${lines.join("\n")}`, "info");
			log("issues", { count: issues.length, filter });
		},
	});

	// ── /gh-status · /github-status ───────────────────────────

	registerDualCommand(pi, "gh-status", "github-status", {
		description: "Show repo status: PRs, issues, CI, branch",
		handler: async (_args, ctx) => {
			const slug = await getRepoSlug(sessionCwd);
			const branch = await getCurrentBranch(sessionCwd);

			const lines: string[] = [];
			lines.push(`**Repo:** ${slug ?? "unknown"}`);
			lines.push(`**Branch:** ${branch ?? "unknown"}`);
			lines.push("");

			// Open PRs count
			const prs = await ghJson<any[]>(["pr", "list", "--json", "number", "--limit", "100"], sessionCwd);
			lines.push(`**Open PRs:** ${prs?.length ?? "?"}`);

			// My PRs needing attention
			const myPrs = await ghJson<any[]>(["pr", "list", "--author", "@me", "--json", "number,title,reviewDecision"], sessionCwd);
			if (myPrs && myPrs.length > 0) {
				const needsWork = myPrs.filter((p: any) => p.reviewDecision === "CHANGES_REQUESTED");
				const approved = myPrs.filter((p: any) => p.reviewDecision === "APPROVED");
				lines.push(`  Mine: ${myPrs.length} open (${approved.length} approved, ${needsWork.length} changes requested)`);
			}

			// Review requests
			const reviewReqs = await ghJson<any[]>(["pr", "list", "--search", "review-requested:@me", "--json", "number"], sessionCwd);
			if (reviewReqs && reviewReqs.length > 0) {
				lines.push(`  Review requested: ${reviewReqs.length}`);
			}

			// Open issues count
			const issues = await ghJson<any[]>(["issue", "list", "--json", "number", "--limit", "100"], sessionCwd);
			lines.push(`**Open Issues:** ${issues?.length ?? "?"}`);

			// Current branch PR
			if (branch && branch !== "main" && branch !== "master") {
				const branchPr = await ghJson<any[]>(["pr", "list", "--head", branch, "--json", "number,title,state,reviewDecision,url"], sessionCwd);
				if (branchPr && branchPr.length > 0) {
					const pr = branchPr[0];
					const review = pr.reviewDecision === "APPROVED" ? "✅" : pr.reviewDecision === "CHANGES_REQUESTED" ? "🔴" : "⏳";
					lines.push("");
					lines.push(`**Current branch PR:** #${pr.number} ${review} ${pr.title}`);
					lines.push(`  ${pr.url}`);
				}
			}

			// CI status
			if (branch) {
				const ci = await gh(["run", "list", "--branch", branch, "--limit", "1", "--json", "status,conclusion,name,url"], sessionCwd);
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
			log("status", { slug, branch });
		},
	});

	// ── /gh-notifications · /github-notifications ─────────────

	registerDualCommand(pi, "gh-notifications", "github-notifications", {
		description: "Show unread GitHub notifications: /gh-notifications [all]",
		completions: ["", "all"],
		handler: async (args, ctx) => {
			const ghArgs = ["api", "/notifications", "--jq", ".[] | {id: .id, reason: .reason, title: .subject.title, type: .subject.type, repo: .repository.full_name, updated: .updated_at}"];
			if (args !== "all") {
				// Only unread (default)
			}

			const result = await gh(ghArgs, sessionCwd);
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
		description: "Create a PR for the current branch: /gh-pr-create [title]",
		handler: async (args, ctx) => {
			const branch = await getCurrentBranch(sessionCwd);
			if (!branch || branch === "main" || branch === "master") {
				ctx.ui.notify("❌ Cannot create PR from main/master branch.", "error");
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

			const ghArgs = ["pr", "create", "--fill"];
			if (args) {
				ghArgs.push("--title", args);
			}

			const result = await gh(ghArgs, sessionCwd);
			if (result.ok) {
				ctx.ui.notify(`✅ PR created: ${result.stdout}`, "info");
				log("pr-create", { branch, url: result.stdout });
			} else {
				ctx.ui.notify(`❌ Failed to create PR: ${result.stderr || result.stdout}`, "error");
			}
		},
	});

	// ── /gh-actions · /github-actions ─────────────────────────

	registerDualCommand(pi, "gh-actions", "github-actions", {
		description: "List recent workflow runs: /gh-actions [branch]",
		handler: async (args, ctx) => {
			const ghArgs = ["run", "list", "--limit", "10", "--json", "status,conclusion,name,headBranch,createdAt,url,event"];
			if (args) {
				ghArgs.push("--branch", args);
			}

			const runs = await ghJson<any[]>(ghArgs, sessionCwd);
			if (!runs || runs.length === 0) {
				ctx.ui.notify("No recent workflow runs.", "info");
				return;
			}

			const lines = runs.map((r: any) => {
				const icon = r.conclusion === "success" ? "✅" : r.conclusion === "failure" ? "❌" : r.status === "in_progress" ? "🔄" : "⏳";
				return `${icon} ${r.name} (${r.headBranch}) — ${r.conclusion ?? r.status}`;
			});

			ctx.ui.notify(`**Workflow Runs** (${runs.length})\n${lines.join("\n")}`, "info");
			log("actions", { count: runs.length });
		},
	});

	// ── /gh-pr-review · /github-pr-review ─────────────────────

	registerDualCommand(pi, "gh-pr-review", "github-pr-review", {
		description: "Show PR review feedback for current branch: /gh-pr-review [pr-number]",
		handler: async (args, ctx) => {
			const prNumber = args ? parseInt(args, 10) : null;
			let prNum: number;

			if (prNumber && !isNaN(prNumber)) {
				prNum = prNumber;
			} else {
				const branch = await getCurrentBranch(sessionCwd);
				if (!branch) {
					ctx.ui.notify("❌ Not in a git repo.", "error");
					return;
				}
				const branchPrs = await ghJson<any[]>(["pr", "list", "--head", branch, "--json", "number"], sessionCwd);
				if (!branchPrs || branchPrs.length === 0) {
					ctx.ui.notify(`No PR found for branch ${branch}.`, "info");
					return;
				}
				prNum = branchPrs[0].number;
			}

			const reviews = await ghJson<any>(["pr", "view", String(prNum), "--json", "reviews,reviewRequests,title,state,reviewDecision"], sessionCwd);
			if (!reviews) {
				ctx.ui.notify(`❌ Could not fetch PR #${prNum}`, "error");
				return;
			}

			const lines: string[] = [];
			lines.push(`**PR #${prNum}: ${reviews.title}**`);
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
			log("pr-review", { prNum });
		},
	});
}
