/**
 * pi-workon — Tool registration.
 *
 * Registers two tools:
 *   - workon: Switch project context (switch/status/list)
 *   - project_init: Detect stack & scaffold (detect/init/batch)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

async function getGitStatus(dir: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["status", "--short", "--branch"],
			{ cwd: dir, timeout: 5000 },
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

async function getGitLog(
	dir: string,
	count: number = 8,
): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["log", "--oneline", "--decorate", `-${count}`],
			{ cwd: dir, timeout: 5000 },
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

async function getGitStash(dir: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["stash", "list"], {
			cwd: dir,
			timeout: 5000,
		});
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

// ── td helpers ──────────────────────────────────────────────────

async function getTdIssues(dir: string): Promise<string | null> {
	if (!fs.existsSync(path.join(dir, ".todos"))) return null;
	try {
		const { stdout } = await execFileAsync("td", ["list", "--json"], {
			cwd: dir,
			timeout: 10000,
		});
		const issues = JSON.parse(stdout);
		if (!Array.isArray(issues) || issues.length === 0) return null;

		const open = issues.filter((i: any) => i.status !== "closed");
		const inProgress = issues.filter(
			(i: any) => i.status === "in_progress",
		);
		const inReview = issues.filter(
			(i: any) => i.status === "in_review",
		);
		const blocked = issues.filter(
			(i: any) => i.status === "blocked",
		);

		const lines: string[] = [];
		lines.push(`Total: ${issues.length} (${open.length} open)`);
		if (inProgress.length > 0) {
			lines.push(`\nIn Progress:`);
			for (const i of inProgress) {
				lines.push(`  ${i.id} [${i.priority}] ${i.title}`);
			}
		}
		if (inReview.length > 0) {
			lines.push(`\nIn Review:`);
			for (const i of inReview) {
				lines.push(`  ${i.id} [${i.priority}] ${i.title}`);
			}
		}
		if (blocked.length > 0) {
			lines.push(`\nBlocked:`);
			for (const i of blocked) {
				lines.push(`  ${i.id} [${i.priority}] ${i.title}`);
			}
		}

		const otherOpen = open.filter(
			(i: any) =>
				i.status !== "in_progress" &&
				i.status !== "in_review" &&
				i.status !== "blocked",
		);
		if (otherOpen.length > 0) {
			lines.push(`\nOpen:`);
			for (const i of otherOpen.slice(0, 10)) {
				lines.push(`  ${i.id} [${i.priority}] ${i.title}`);
			}
			if (otherOpen.length > 10) {
				lines.push(`  ... and ${otherOpen.length - 10} more`);
			}
		}

		return lines.join("\n");
	} catch {
		return null;
	}
}

// ── Context builder ─────────────────────────────────────────────

async function buildProjectContext(projectPath: string): Promise<string> {
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
	sections.push(`**Path:** ${profile.path}`);
	if (stackParts.length > 0)
		sections.push(`**Stack:** ${stackParts.join(" · ")}`);
	if (profile.monorepo)
		sections.push(
			`**Monorepo:** ${profile.workspaces.join(", ")}`,
		);

	// AGENTS.md
	if (profile.hasAgentsMd) {
		try {
			const agentsMd = fs.readFileSync(
				path.join(projectPath, "AGENTS.md"),
				"utf-8",
			);
			const content =
				agentsMd.length > 4000
					? agentsMd.slice(0, 4000) +
						"\n\n... (truncated, use read tool for full file)"
					: agentsMd;
			sections.push(`\n## AGENTS.md\n\n${content}`);
		} catch {
			sections.push(
				`\n⚠️ AGENTS.md exists but couldn't be read`,
			);
		}
	} else {
		sections.push(
			`\n⚠️ No AGENTS.md found — run \`project_init\` with action="init" to create one`,
		);
	}

	// Git
	const [gitStatus, gitLog, gitStash] = await Promise.all([
		getGitStatus(projectPath),
		getGitLog(projectPath),
		getGitStash(projectPath),
	]);

	if (gitStatus || gitLog) {
		sections.push(`\n## Git`);
		if (gitStatus) sections.push(`\`\`\`\n${gitStatus}\n\`\`\``);
		if (gitLog)
			sections.push(
				`### Recent commits\n\`\`\`\n${gitLog}\n\`\`\``,
			);
		if (gitStash)
			sections.push(
				`### Stashes\n\`\`\`\n${gitStash}\n\`\`\``,
			);
	} else if (!profile.git) {
		sections.push(`\n📝 Not a git repository`);
	}

	// td issues
	const tdSummary = await getTdIssues(projectPath);
	if (tdSummary) {
		sections.push(`\n## Tasks (td)\n\n${tdSummary}`);
	} else if (profile.hasTd) {
		sections.push(`\n## Tasks (td)\n\nNo open issues.`);
	} else {
		sections.push(
			`\n📝 td not initialized — run \`project_init\` with action="init" to set up`,
		);
	}

	sections.push(
		`\n---\n**⚡ Working in ${profile.name}:** Prefix bash commands with \`cd ${projectPath} &&\` to operate in this project.`,
	);

	activeProject = { name: profile.name, path: projectPath, profile };

	return sections.join("\n");
}

// ── List projects ───────────────────────────────────────────────

async function listProjects(devDir: string): Promise<string> {
	const entries = listProjectDirs(devDir);

	const projectInfos = await Promise.all(
		entries.map(async (entry) => {
			const p = path.join(devDir, entry);
			const hasGit = fs.existsSync(path.join(p, ".git"));
			const hasAgents = fs.existsSync(path.join(p, "AGENTS.md"));
			const hasTd = fs.existsSync(path.join(p, ".todos"));

			let branch = "";
			if (hasGit) {
				try {
					const { stdout } = await execFileAsync(
						"git",
						["branch", "--show-current"],
						{ cwd: p, timeout: 3000 },
					);
					branch = stdout.trim();
				} catch {
					/* ignore */
				}
			}

			return { entry, p, hasGit, hasAgents, hasTd, branch };
		}),
	);

	const lines: string[] = [`# Projects in ${devDir}\n`];

	for (const {
		entry,
		p,
		hasGit,
		hasAgents,
		hasTd,
		branch,
	} of projectInfos) {
		const badges = [
			hasAgents ? "📋" : "",
			hasTd ? "✅" : "",
			hasGit ? `🌿 ${branch}` : "📁",
		]
			.filter(Boolean)
			.join(" ");

		const isActive = activeProject?.path === p ? " ← active" : "";
		lines.push(`- **${entry}** ${badges}${isActive}`);
	}

	lines.push(
		`\n📋 = AGENTS.md  ✅ = td  🌿 = git branch  📁 = no git`,
	);
	lines.push(`\nUse \`workon <name>\` to switch context.`);

	return lines.join("\n");
}

// ── Tool Registration ───────────────────────────────────────────

export function registerWorkonTool(
	pi: ExtensionAPI,
	devDir: string,
): void {
	pi.registerTool({
		name: "workon",
		label: "Work On",
		description:
			"Switch working context to a project. Resolves the project name, reads AGENTS.md, checks git status, loads td issues, and returns a full context summary. Use action='switch' to change projects, 'status' to check current project context, or 'list' to see all projects.",
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
				return text(await listProjects(devDir));
			}

			if (input.action === "status") {
				if (!activeProject) {
					return text(
						"No active project. Use `workon` with action='switch' to select a project.",
					);
				}
				const context = await buildProjectContext(
					activeProject.path,
				);
				return text(context);
			}

			// Switch
			if (!input.project) {
				return text(
					"Error: project name is required for switch action",
				);
			}

			const resolution = resolveProject(input.project, devDir);
			if ("error" in resolution) {
				const msg =
					resolution.suggestions.length > 0
						? `${resolution.error}\nSuggestions: ${resolution.suggestions.join(", ")}`
						: resolution.error;
				return text(msg);
			}

			const context = await buildProjectContext(
				resolution.resolved.path,
			);
			return text(context);
		},
	});
}

export function registerProjectInitTool(
	pi: ExtensionAPI,
	devDir: string,
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
					description:
						"Project name, alias, or path. Required for detect/init.",
				}),
			),
			force: Type.Optional(
				Type.Boolean({
					description:
						"Overwrite existing AGENTS.md if present (default: false)",
				}),
			),
			skip_td: Type.Optional(
				Type.Boolean({
					description: "Skip td init (default: false)",
				}),
			),
			skip_agents_md: Type.Optional(
				Type.Boolean({
					description:
						"Skip AGENTS.md generation (default: false)",
				}),
			),
			skip_pi_dir: Type.Optional(
				Type.Boolean({
					description:
						"Skip .pi/ directory scaffolding (default: false)",
				}),
			),
		}),
		async execute(_toolCallId, input, _signal) {
			const text = (t: string) => ({
				content: [{ type: "text" as const, text: t }],
				details: {},
			});

			// Batch
			if (input.action === "batch") {
				const entries = listProjectDirs(devDir);
				const projects: Array<{
					name: string;
					language: string;
					frameworks: string;
					hasAgentsMd: boolean;
					hasPiDir: boolean;
					hasTd: boolean;
					status: string;
				}> = [];

				for (const entry of entries) {
					const profile = await detectStack(
						path.join(devDir, entry),
					);
					projects.push({
						name: profile.name,
						language: profile.language,
						frameworks:
							profile.frameworks.slice(0, 3).join(", ") ||
							"-",
						hasAgentsMd: profile.hasAgentsMd,
						hasPiDir: profile.hasPiDir,
						hasTd: profile.hasTd,
						status:
							profile.hasAgentsMd &&
							profile.hasPiDir &&
							profile.hasTd
								? "✅ ready"
								: [
										!profile.hasAgentsMd
											? "needs AGENTS.md"
											: "",
										!profile.hasPiDir
											? "needs .pi/"
											: "",
										!profile.hasTd ? "needs td" : "",
									]
										.filter(Boolean)
										.join(", "),
					});
				}

				const needsInit = projects.filter(
					(p) => p.status !== "✅ ready",
				);
				return text(
					JSON.stringify(
						{
							total: projects.length,
							ready: projects.length - needsInit.length,
							needs_init: needsInit.length,
							projects,
						},
						null,
						2,
					),
				);
			}

			// Single project
			if (!input.project) {
				return text(
					"Error: project is required for detect/init actions",
				);
			}

			const resolution = resolveProject(input.project, devDir);
			if ("error" in resolution) {
				const msg =
					resolution.suggestions.length > 0
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
						agents_md:
							profile.hasAgentsMd && !input.force
								? "(exists, use force=true to overwrite)"
								: generateAgentsMd(profile).slice(0, 500) +
									"...",
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
