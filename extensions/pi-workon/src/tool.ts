/**
 * pi-workon — Tool registration.
 *
 * Registers:
 *   - workon: Switch project context (switch/status/list)
 *   - project_init: Detect stack & scaffold (detect/init/batch)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { resolveProject, listProjectDirs } from "./resolver.ts";
import { detectStack, type ProjectProfile } from "./detector.ts";
import {
	generateAgentsMd,
	generatePiSettings,
	initProject,
} from "./scaffold.ts";
import type { WorkonSettings } from "./settings.ts";

const execFileAsync = promisify(execFile);

// ── Active project state ────────────────────────────────────────

let activeProject: {
	name: string;
	path: string;
	profile: ProjectProfile;
} | null = null;

/** Get the currently active project. */
export function getActiveProject() {
	return activeProject;
}

// ── Git helpers ─────────────────────────────────────────────────

async function exec(cmd: string, args: string[], dir: string, timeout = 5000): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(cmd, args, { cwd: dir, timeout });
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

async function getGitStatus(dir: string): Promise<string | null> {
	return exec("git", ["status", "--short", "--branch"], dir);
}

async function getGitLog(dir: string, count = 8): Promise<string | null> {
	return exec("git", ["log", "--oneline", "--decorate", `-${count}`], dir);
}

async function getGitStash(dir: string): Promise<string | null> {
	return exec("git", ["stash", "list"], dir);
}

async function getGitBranch(dir: string): Promise<string | null> {
	return exec("git", ["branch", "--show-current"], dir);
}

/** How many commits the current branch is behind/ahead of main/master. */
async function getBranchStaleness(dir: string): Promise<string | null> {
	const branch = await getGitBranch(dir);
	if (!branch || branch === "main" || branch === "master") return null;

	// Determine base branch
	const hasMain = await exec("git", ["rev-parse", "--verify", "main"], dir);
	const base = hasMain ? "main" : "master";

	// Fetch might be stale, but don't actually fetch (too slow)
	const result = await exec("git", ["rev-list", "--left-right", "--count", `${base}...${branch}`], dir);
	if (!result) return null;

	const [behind, ahead] = result.split(/\s+/).map(Number);
	const parts: string[] = [];
	if (ahead > 0) parts.push(`${ahead} ahead`);
	if (behind > 0) parts.push(`${behind} behind`);
	if (parts.length === 0) return null;
	return `\`${branch}\` is ${parts.join(", ")} \`${base}\``;
}

// ── td helpers ──────────────────────────────────────────────────

async function getTdIssues(dir: string): Promise<string | null> {
	if (!fs.existsSync(path.join(dir, ".todos"))) return null;
	try {
		const stdout = await exec("td", ["list", "--json"], dir, 10000);
		if (!stdout) return null;
		const issues = JSON.parse(stdout);
		if (!Array.isArray(issues) || issues.length === 0) return null;

		const open = issues.filter((i: any) => i.status !== "closed");
		const inProgress = issues.filter((i: any) => i.status === "in_progress");
		const inReview = issues.filter((i: any) => i.status === "in_review");
		const blocked = issues.filter((i: any) => i.status === "blocked");

		const lines: string[] = [];
		lines.push(`Total: ${issues.length} (${open.length} open)`);
		if (inProgress.length > 0) {
			lines.push(`\nIn Progress:`);
			for (const i of inProgress) lines.push(`  ${i.id} [${i.priority}] ${i.title}`);
		}
		if (inReview.length > 0) {
			lines.push(`\nIn Review:`);
			for (const i of inReview) lines.push(`  ${i.id} [${i.priority}] ${i.title}`);
		}
		if (blocked.length > 0) {
			lines.push(`\nBlocked:`);
			for (const i of blocked) lines.push(`  ${i.id} [${i.priority}] ${i.title}`);
		}
		const otherOpen = open.filter((i: any) =>
			i.status !== "in_progress" && i.status !== "in_review" && i.status !== "blocked");
		if (otherOpen.length > 0) {
			lines.push(`\nOpen:`);
			for (const i of otherOpen.slice(0, 10)) lines.push(`  ${i.id} [${i.priority}] ${i.title}`);
			if (otherOpen.length > 10) lines.push(`  ... and ${otherOpen.length - 10} more`);
		}
		return lines.join("\n");
	} catch {
		return null;
	}
}

// ── GitHub PR helpers ───────────────────────────────────────────

async function getOpenPrSummary(dir: string): Promise<string | null> {
	const stdout = await exec("gh", [
		"pr", "list", "--state", "open",
		"--json", "number,title,headRefName,reviewDecision,isDraft",
		"--limit", "10",
	], dir, 10000);
	if (!stdout) return null;

	try {
		const prs = JSON.parse(stdout);
		if (!Array.isArray(prs) || prs.length === 0) return null;

		const lines: string[] = [`${prs.length} open PR${prs.length !== 1 ? "s" : ""}:`];
		for (const pr of prs) {
			const draft = pr.isDraft ? " 📝" : "";
			const review = pr.reviewDecision === "APPROVED" ? " ✅"
				: pr.reviewDecision === "CHANGES_REQUESTED" ? " 🔴"
				: "";
			lines.push(`  #${pr.number}${draft}${review} ${pr.title} (${pr.headRefName})`);
		}

		const needsWork = prs.filter((p: any) => p.reviewDecision === "CHANGES_REQUESTED");
		if (needsWork.length > 0) {
			lines.push(`\n⚠️ ${needsWork.length} PR${needsWork.length !== 1 ? "s" : ""} with changes requested`);
		}

		return lines.join("\n");
	} catch {
		return null;
	}
}

// ── Session history ─────────────────────────────────────────────

function getLastSessionInfo(projectPath: string): string | null {
	const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
	// Session dirs are path-encoded: /Users/espen/Dev/foo → --Users-espen-Dev-foo--
	const encoded = "--" + projectPath.replace(/\//g, "-").replace(/^-/, "") + "--";

	const sessionDir = path.join(sessionsDir, encoded);
	if (!fs.existsSync(sessionDir)) return null;

	try {
		const files = fs.readdirSync(sessionDir)
			.filter((f) => f.endsWith(".jsonl"))
			.sort()
			.reverse();

		if (files.length === 0) return null;

		const latest = files[0];
		// Filename format: 2026-02-17T09-33-29-898Z_uuid.jsonl
		const tsMatch = latest.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
		if (!tsMatch) return null;

		const date = `${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]}`;
		const time = `${tsMatch[4]}:${tsMatch[5]}`;

		// Try to read first user message for context
		const filePath = path.join(sessionDir, latest);
		const stat = fs.statSync(filePath);
		const sizeKB = Math.round(stat.size / 1024);

		let firstUserMsg = "";
		try {
			// Read just the first few KB to find the first user message
			const fd = fs.openSync(filePath, "r");
			const buf = Buffer.alloc(Math.min(8192, stat.size));
			fs.readSync(fd, buf, 0, buf.length, 0);
			fs.closeSync(fd);
			const content = buf.toString("utf-8");
			for (const line of content.split("\n")) {
				if (!line) continue;
				try {
					const entry = JSON.parse(line);
					if (entry.type === "message" && entry.message?.role === "user") {
						const textBlock = entry.message.content?.find?.((b: any) => b.type === "text");
						if (textBlock?.text) {
							firstUserMsg = textBlock.text.slice(0, 100);
							if (textBlock.text.length > 100) firstUserMsg += "…";
							break;
						}
					}
				} catch { /* skip malformed lines */ }
			}
		} catch { /* ignore */ }

		const parts = [`Last session: ${date} ${time} (${sizeKB}KB, ${files.length} total sessions)`];
		if (firstUserMsg) parts.push(`  Started with: "${firstUserMsg}"`);
		return parts.join("\n");
	} catch {
		return null;
	}
}

// ── Dependency health ───────────────────────────────────────────

async function getDependencyHealth(dir: string, profile: ProjectProfile): Promise<string | null> {
	if (profile.packageManager === "none") return null;

	const parts: string[] = [];

	// npm/pnpm/yarn outdated
	if (["npm", "pnpm", "yarn"].includes(profile.packageManager)) {
		const pm = profile.packageManager;
		const outdated = await exec(pm, ["outdated", "--json"], dir, 15000);
		if (outdated) {
			try {
				const data = JSON.parse(outdated);
				const count = typeof data === "object" ? Object.keys(data).length : 0;
				if (count > 0) parts.push(`${count} outdated package${count !== 1 ? "s" : ""}`);
			} catch {
				// Some package managers output non-JSON on outdated
			}
		}

		// npm audit
		const audit = await exec(pm, ["audit", "--json"], dir, 15000);
		if (audit) {
			try {
				const data = JSON.parse(audit);
				const vulns = data.metadata?.vulnerabilities;
				if (vulns) {
					const critical = (vulns.critical ?? 0) + (vulns.high ?? 0);
					const moderate = vulns.moderate ?? 0;
					if (critical > 0) parts.push(`${critical} critical/high vulnerabilities`);
					else if (moderate > 0) parts.push(`${moderate} moderate vulnerabilities`);
				}
			} catch { /* ignore */ }
		}
	}

	return parts.length > 0 ? `⚠️ ${parts.join(", ")}` : null;
}

// ── Typecheck / lint ────────────────────────────────────────────

async function getTypecheckStatus(dir: string, profile: ProjectProfile): Promise<string | null> {
	// Determine the right command
	let cmd: string | null = null;
	let args: string[] = [];

	if (profile.scripts?.typecheck) {
		cmd = profile.packageManager !== "none" ? profile.packageManager : "npm";
		args = ["run", "typecheck"];
	} else if (profile.scripts?.check) {
		cmd = profile.packageManager !== "none" ? profile.packageManager : "npm";
		args = ["run", "check"];
	} else if (profile.language === "typescript") {
		// Check for tsc in node_modules
		const tscPath = path.join(dir, "node_modules", ".bin", "tsc");
		if (fs.existsSync(tscPath)) {
			cmd = tscPath;
			args = ["--noEmit"];
		}
	}

	if (!cmd) return null;

	try {
		const { stderr, stdout } = await execFileAsync(cmd, args, {
			cwd: dir,
			timeout: 30000,
			env: { ...process.env, FORCE_COLOR: "0" },
		});
		// Exit 0 = no errors
		return null;
	} catch (err: any) {
		// tsc exits with code 2 on type errors
		const output = (err.stdout ?? "") + (err.stderr ?? "");
		const errorLines = output.split("\n").filter((l: string) => /error TS\d+/.test(l));
		if (errorLines.length > 0) {
			return `⚠️ ${errorLines.length} type error${errorLines.length !== 1 ? "s" : ""}`;
		}
		// svelte-check or other tools
		const errorMatch = output.match(/(\d+)\s+error/i);
		if (errorMatch) {
			return `⚠️ ${errorMatch[1]} error${errorMatch[1] !== "1" ? "s" : ""}`;
		}
		return null;
	}
}

// ── AGENTS.md staleness ─────────────────────────────────────────

async function getAgentsMdStaleness(dir: string): Promise<string | null> {
	const agentsPath = path.join(dir, "AGENTS.md");
	if (!fs.existsSync(agentsPath)) return null;

	try {
		const agentsStat = fs.statSync(agentsPath);
		const agentsMtime = agentsStat.mtimeMs;

		// Count commits since AGENTS.md was last modified
		const since = new Date(agentsMtime).toISOString();
		const result = await exec("git", [
			"rev-list", "--count", `--since=${since}`, "HEAD",
		], dir);

		if (!result) return null;
		const commits = parseInt(result, 10);
		if (commits > 20) {
			return `📋 AGENTS.md may be stale — ${commits} commits since last update`;
		}
		return null;
	} catch {
		return null;
	}
}

// ── Context builder ─────────────────────────────────────────────

async function buildProjectContext(
	projectPath: string,
	pi: ExtensionAPI,
	settings: WorkonSettings,
): Promise<string> {
	const profile = await detectStack(projectPath);
	const sections: string[] = [];

	const stackParts: string[] = [];
	if (profile.language !== "unknown") stackParts.push(profile.language);
	if (profile.frameworks.length > 0)
		stackParts.push(profile.frameworks.slice(0, 4).join(", "));
	if (profile.packageManager !== "none")
		stackParts.push(profile.packageManager);
	if (profile.docker) stackParts.push("Docker");

	sections.push(`# 📂 ${profile.name}`);
	sections.push(`**Path:** ${projectPath}`);
	if (stackParts.length > 0)
		sections.push(`**Stack:** ${stackParts.join(" · ")}`);
	if (profile.monorepo)
		sections.push(`**Monorepo:** ${profile.workspaces.join(", ")}`);

	// AGENTS.md
	if (profile.hasAgentsMd) {
		try {
			const agentsMd = fs.readFileSync(path.join(projectPath, "AGENTS.md"), "utf-8");
			const content = agentsMd.length > 4000
				? agentsMd.slice(0, 4000) + "\n\n... (truncated, use read tool for full file)"
				: agentsMd;
			sections.push(`\n## AGENTS.md\n\n${content}`);
		} catch {
			sections.push(`\n⚠️ AGENTS.md exists but couldn't be read`);
		}
	} else {
		sections.push(`\n⚠️ No AGENTS.md found — run \`project_init\` with action="init" to create one`);
	}

	// Run enrichment checks in parallel
	const [
		gitStatus,
		gitLog,
		gitStash,
		branchStaleness,
		tdSummary,
		prSummary,
		sessionInfo,
		depHealth,
		typecheckStatus,
		agentsStaleness,
	] = await Promise.all([
		getGitStatus(projectPath),
		getGitLog(projectPath),
		getGitStash(projectPath),
		getBranchStaleness(projectPath),
		getTdIssues(projectPath),
		getOpenPrSummary(projectPath),
		Promise.resolve(getLastSessionInfo(projectPath)),
		getDependencyHealth(projectPath, profile),
		getTypecheckStatus(projectPath, profile),
		getAgentsMdStaleness(projectPath),
	]);

	// Git section
	if (gitStatus || gitLog) {
		sections.push(`\n## Git`);
		if (gitStatus) sections.push(`\`\`\`\n${gitStatus}\n\`\`\``);
		if (branchStaleness) sections.push(`📊 ${branchStaleness}`);
		if (gitLog) sections.push(`### Recent commits\n\`\`\`\n${gitLog}\n\`\`\``);
		if (gitStash) sections.push(`### Stashes\n\`\`\`\n${gitStash}\n\`\`\``);
	} else if (!profile.git) {
		sections.push(`\n📝 Not a git repository`);
	}

	// Tasks
	if (tdSummary) {
		sections.push(`\n## Tasks (td)\n\n${tdSummary}`);
	} else if (profile.hasTd) {
		sections.push(`\n## Tasks (td)\n\nNo open issues.`);
	} else {
		sections.push(`\n📝 td not initialized — run \`project_init\` with action="init" to set up`);
	}

	// GitHub PRs
	if (prSummary) {
		sections.push(`\n## GitHub PRs\n\n${prSummary}`);
	}

	// Health section (dep health, typecheck, AGENTS.md staleness)
	const healthItems = [depHealth, typecheckStatus, agentsStaleness].filter(Boolean);
	if (healthItems.length > 0) {
		sections.push(`\n## Health\n\n${healthItems.join("\n")}`);
	}

	// Session history
	if (sessionInfo) {
		sections.push(`\n## History\n\n${sessionInfo}`);
	}

	sections.push(
		`\n---\n**⚡ Working in ${profile.name}:** Prefix bash commands with \`cd ${projectPath} &&\` to operate in this project.`,
	);

	activeProject = { name: profile.name, path: projectPath, profile };

	// Emit workon:switch event for other extensions
	pi.events.emit("workon:switch", { path: projectPath, name: profile.name });

	return sections.join("\n");
}

// ── List projects ───────────────────────────────────────────────

async function listProjects(settings: WorkonSettings): Promise<string> {
	const entries = listProjectDirs(settings.devDirs);

	const projectInfos = await Promise.all(
		entries.map(async ({ name, path: p }) => {
			const hasGit = fs.existsSync(path.join(p, ".git"));
			const hasAgents = fs.existsSync(path.join(p, "AGENTS.md"));
			const hasTd = fs.existsSync(path.join(p, ".todos"));

			let branch = "";
			if (hasGit) {
				branch = (await exec("git", ["branch", "--show-current"], p, 3000)) ?? "";
			}

			return { name, path: p, hasGit, hasAgents, hasTd, branch };
		}),
	);

	const dirLabel = settings.devDirs.length === 1
		? settings.devDirs[0]
		: `${settings.devDirs.length} directories`;
	const lines: string[] = [`# Projects in ${dirLabel}\n`];

	for (const { name, path: p, hasGit, hasAgents, hasTd, branch } of projectInfos) {
		const badges = [
			hasAgents ? "📋" : "",
			hasTd ? "✅" : "",
			hasGit ? `🌿 ${branch}` : "📁",
		].filter(Boolean).join(" ");

		const isActive = activeProject?.path === p ? " ← active" : "";
		lines.push(`- **${name}** ${badges}${isActive}`);
	}

	lines.push(`\n📋 = AGENTS.md  ✅ = td  🌿 = git branch  📁 = no git`);

	// Show aliases if any
	const aliasEntries = Object.entries(settings.aliases);
	if (aliasEntries.length > 0) {
		lines.push(`\n### Aliases`);
		for (const [alias, target] of aliasEntries) {
			lines.push(`  ${alias} → ${target}`);
		}
	}

	lines.push(`\nUse \`workon <name>\` to switch context.`);

	return lines.join("\n");
}

// ── Tool Registration ───────────────────────────────────────────

export function registerWorkonTool(
	pi: ExtensionAPI,
	settings: WorkonSettings,
): void {
	pi.registerTool({
		name: "workon",
		label: "Work On",
		description:
			"Switch working context to a project. Resolves the project name, reads AGENTS.md, checks git status, loads td issues, PRs, dependency health, and returns a full context summary. Use action='switch' to change projects, 'status' to check current project context, or 'list' to see all projects.",
		parameters: Type.Object({
			action: StringEnum(["switch", "status", "list"], {
				description:
					"switch = change to a project, status = show current project context, list = show all projects",
			}),
			project: Type.Optional(
				Type.String({
					description:
						"Project name, alias, or path. Required for switch action.",
				}),
			),
		}),
		async execute(_toolCallId, input, _signal) {
			const text = (t: string) => ({
				content: [{ type: "text" as const, text: t }],
				details: {},
			});

			if (input.action === "list") {
				return text(await listProjects(settings));
			}

			if (input.action === "status") {
				if (!activeProject) {
					return text("No active project. Use `workon` with action='switch' to select a project.");
				}
				const context = await buildProjectContext(activeProject.path, pi, settings);
				return text(context);
			}

			// Switch
			if (!input.project) {
				return text("Error: project name is required for switch action");
			}

			const resolution = resolveProject(input.project, settings.devDirs, settings.aliases);
			if ("error" in resolution) {
				const msg = resolution.suggestions.length > 0
					? `${resolution.error}\nSuggestions: ${resolution.suggestions.join(", ")}`
					: resolution.error;
				return text(msg);
			}

			const context = await buildProjectContext(resolution.resolved.path, pi, settings);
			return text(context);
		},
	});
}

export function registerProjectInitTool(
	pi: ExtensionAPI,
	settings: WorkonSettings,
): void {
	pi.registerTool({
		name: "project_init",
		label: "Project Init",
		description:
			"Initialize a project for AI-assisted development. Scans the project directory, detects the tech stack, and scaffolds AGENTS.md, .pi/settings.json, and td task tracking. Use `action: detect` to preview what would be generated, `action: init` to create files, or `action: batch` to scan all projects.",
		parameters: Type.Object({
			action: StringEnum(["detect", "init", "batch"], {
				description:
					"detect = scan and return profile (dry run), init = create files, batch = scan all projects",
			}),
			project: Type.Optional(
				Type.String({
					description: "Project name, alias, or path. Required for detect/init.",
				}),
			),
			force: Type.Optional(
				Type.Boolean({ description: "Overwrite existing AGENTS.md if present (default: false)" }),
			),
			skip_td: Type.Optional(
				Type.Boolean({ description: "Skip td init (default: false)" }),
			),
			skip_agents_md: Type.Optional(
				Type.Boolean({ description: "Skip AGENTS.md generation (default: false)" }),
			),
			skip_pi_dir: Type.Optional(
				Type.Boolean({ description: "Skip .pi/ directory scaffolding (default: false)" }),
			),
		}),
		async execute(_toolCallId, input, _signal) {
			const text = (t: string) => ({
				content: [{ type: "text" as const, text: t }],
				details: {},
			});

			// Batch
			if (input.action === "batch") {
				const entries = listProjectDirs(settings.devDirs);
				const projects: Array<{
					name: string;
					language: string;
					frameworks: string;
					hasAgentsMd: boolean;
					hasPiDir: boolean;
					hasTd: boolean;
					status: string;
				}> = [];

				for (const { path: p, name } of entries) {
					const profile = await detectStack(p);
					projects.push({
						name: profile.name,
						language: profile.language,
						frameworks: profile.frameworks.slice(0, 3).join(", ") || "-",
						hasAgentsMd: profile.hasAgentsMd,
						hasPiDir: profile.hasPiDir,
						hasTd: profile.hasTd,
						status:
							profile.hasAgentsMd && profile.hasPiDir && profile.hasTd
								? "✅ ready"
								: [
										!profile.hasAgentsMd ? "needs AGENTS.md" : "",
										!profile.hasPiDir ? "needs .pi/" : "",
										!profile.hasTd ? "needs td" : "",
									].filter(Boolean).join(", "),
					});
				}

				const needsInit = projects.filter((p) => p.status !== "✅ ready");
				return text(JSON.stringify({
					total: projects.length,
					ready: projects.length - needsInit.length,
					needs_init: needsInit.length,
					projects,
				}, null, 2));
			}

			// Single project
			if (!input.project) {
				return text("Error: project is required for detect/init actions");
			}

			const resolution = resolveProject(input.project, settings.devDirs, settings.aliases);
			if ("error" in resolution) {
				const msg = resolution.suggestions.length > 0
					? `${resolution.error}\nSuggestions: ${resolution.suggestions.join(", ")}`
					: resolution.error;
				return text(msg);
			}

			const { resolved } = resolution;
			const profile = await detectStack(resolved.path);

			if (input.action === "detect") {
				const preview = {
					profile,
					preview: {
						agents_md: profile.hasAgentsMd && !input.force
							? "(exists, use force=true to overwrite)"
							: generateAgentsMd(profile).slice(0, 500) + "...",
						pi_settings: profile.hasPiDir
							? "(exists)"
							: generatePiSettings(profile),
						td_init: profile.hasTd
							? "(already initialized)"
							: "will run td init",
					},
				};
				return text(JSON.stringify(preview, null, 2));
			}

			// Init
			const results = await initProject(resolved.path, profile, {
				force: input.force ?? false,
				skipAgentsMd: input.skip_agents_md,
				skipPiDir: input.skip_pi_dir,
				skipTd: input.skip_td,
			});

			const summary = `Project: ${resolved.name}\nPath: ${resolved.path}\nStack: ${profile.language} · ${profile.frameworks.slice(0, 3).join(", ") || "no framework"} · ${profile.packageManager}\n\n${results.agentsMd}\n${results.piSettings}\n${results.tdInit}`;
			return text(summary);
		},
	});
}
