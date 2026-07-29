/**
 * pi-workon — AGENTS.md and .pi/ scaffolding.
 *
 * Generates project-specific AGENTS.md and .pi/settings.json based on
 * the detected stack profile.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectProfile } from "./detector.ts";

const execFileAsync = promisify(execFile);

// ── AGENTS.md Generator ─────────────────────────────────────────

export function generateAgentsMd(profile: ProjectProfile): string {
	const lines: string[] = [];

	lines.push(`# AGENTS.md — ${profile.name}`);
	lines.push("");

	// td mandate
	lines.push("## MANDATORY: Use td for Task Management");
	lines.push("");
	lines.push(
		"Run td usage --new-session at conversation start (or after /clear). This tells you what to work on next.",
	);
	lines.push("");
	lines.push(
		"Sessions are automatic (based on terminal/agent context). Optional:",
	);
	lines.push('- td session "name" to label the current session');
	lines.push(
		"- td session --new to force a new session in the same context",
	);
	lines.push("");
	lines.push("Use td usage -q after first read.");
	lines.push("");

	// Project overview
	lines.push("## Project Overview");
	lines.push("");
	const stackParts: string[] = [];
	if (profile.language !== "unknown") {
		const langName =
			profile.language === "typescript"
				? "TypeScript"
				: profile.language === "javascript"
					? "JavaScript"
					: profile.language.charAt(0).toUpperCase() +
						profile.language.slice(1);
		stackParts.push(langName);
	}
	if (profile.frameworks.length > 0)
		stackParts.push(profile.frameworks.slice(0, 5).join(", "));
	if (profile.docker) stackParts.push("Docker");

	if (profile.description) {
		lines.push(profile.description);
		lines.push("");
	}
	if (stackParts.length > 0) {
		lines.push(`**Stack:** ${stackParts.join(" · ")}`);
	}
	if (profile.monorepo) {
		lines.push(`**Monorepo:** ${profile.workspaces.join(", ")}`);
	}
	if (profile.packageManager !== "none") {
		lines.push(`**Package Manager:** ${profile.packageManager}`);
	}
	lines.push("");

	// Quick start
	const hasScripts = Object.keys(profile.scripts).length > 0;
	if (hasScripts || profile.language === "python") {
		lines.push("## Quick Start");
		lines.push("");
		lines.push("```bash");

		if (profile.language === "python") {
			if (profile.packageManager === "poetry") {
				lines.push("poetry install");
				if (profile.scripts["dev"]) lines.push("poetry run dev");
			} else {
				lines.push("pip install -r requirements.txt");
			}
		} else {
			const install =
				profile.packageManager === "pnpm"
					? "pnpm install"
					: profile.packageManager === "yarn"
						? "yarn"
						: profile.packageManager === "bun"
							? "bun install"
							: "npm install";
			lines.push(install);
		}

		const pm =
			profile.packageManager === "pnpm"
				? "pnpm"
				: profile.packageManager === "yarn"
					? "yarn"
					: profile.packageManager === "bun"
						? "bun run"
						: "npm run";

		if (profile.scripts["dev"]) lines.push(`${pm} dev`);
		else if (profile.scripts["start"]) lines.push(`${pm} start`);

		if (profile.scripts["build"]) lines.push(`${pm} build`);
		if (profile.scripts["test"]) lines.push(`${pm} test`);
		if (profile.scripts["lint"]) lines.push(`${pm} lint`);

		lines.push("```");
		lines.push("");

		if (hasScripts) {
			lines.push("### Available Scripts");
			lines.push("");
			const scriptNames = Object.keys(profile.scripts);
			const important = [
				"dev",
				"build",
				"start",
				"test",
				"lint",
				"format",
				"typecheck",
				"check",
			];
			const primaryScripts = scriptNames.filter((s) =>
				important.includes(s),
			);
			const otherScripts = scriptNames.filter(
				(s) => !important.includes(s),
			);

			for (const s of primaryScripts) {
				lines.push(`- \`${pm} ${s}\` — ${profile.scripts[s]}`);
			}
			if (otherScripts.length > 0) {
				lines.push(
					`- Other: ${otherScripts.map((s) => `\`${s}\``).join(", ")}`,
				);
			}
			lines.push("");
		}
	}

	// Docker
	if (profile.docker) {
		const dockerScripts = Object.entries(profile.scripts).filter(
			([k]) => k.startsWith("docker"),
		);
		lines.push("### Docker");
		lines.push("");
		if (dockerScripts.length > 0) {
			const pm =
				profile.packageManager === "pnpm"
					? "pnpm"
					: profile.packageManager === "yarn"
						? "yarn"
						: "npm run";
			for (const [name, cmd] of dockerScripts) {
				lines.push(`- \`${pm} ${name}\` — ${cmd}`);
			}
		} else {
			lines.push("```bash");
			if (
				fs.existsSync(
					path.join(profile.path, "docker-compose.yml"),
				) ||
				fs.existsSync(
					path.join(profile.path, "docker-compose.yaml"),
				)
			) {
				lines.push("docker compose up -d");
				lines.push("docker compose down");
			} else {
				lines.push(
					"docker build -t " +
						profile.name.toLowerCase().replace(/\s+/g, "-") +
						" .",
				);
			}
			lines.push("```");
		}
		lines.push("");
	}

	// Directory layout
	if (profile.directories.length > 0) {
		lines.push("## Directory Layout");
		lines.push("");
		lines.push("```");
		for (const d of profile.directories.sort()) {
			lines.push(`${d}/`);
		}
		lines.push("```");
		lines.push("");
	}

	// Conventions
	const conventions: string[] = [];
	if (profile.linting.length > 0) {
		conventions.push(
			`**Linting/Formatting:** ${profile.linting.join(", ")}`,
		);
	}
	if (profile.testFramework) {
		conventions.push(`**Testing:** ${profile.testFramework}`);
	}
	if (profile.language === "typescript") {
		conventions.push("**Language:** TypeScript strict mode preferred");
	}

	if (conventions.length > 0) {
		lines.push("## Conventions");
		lines.push("");
		for (const c of conventions) {
			lines.push(`- ${c}`);
		}
		lines.push("");
	}

	// Key files
	const keyFiles = profile.configFiles.filter(
		(f) => !["AGENTS.md", "CLAUDE.md"].includes(f),
	);
	if (keyFiles.length > 0) {
		lines.push("## Key Files");
		lines.push("");
		for (const f of keyFiles) {
			lines.push(`- \`${f}\``);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ── .pi/ Scaffolding ────────────────────────────────────────────

function detectSkills(profile: ProjectProfile): string[] {
	const skills: string[] = ["td"];
	if (profile.language !== "unknown") skills.push("code-review");
	if (profile.git) skills.push("github");
	if (profile.frameworks.includes("Eleventy")) skills.push("blog-post");
	return skills;
}

export function generatePiSettings(
	profile: ProjectProfile,
): Record<string, unknown> {
	return {
		skills: detectSkills(profile),
	};
}

// ── Init Runner ─────────────────────────────────────────────────

export interface InitResult {
	agentsMd: string;
	piSettings: string;
	tdInit: string;
}

export async function initProject(
	projectPath: string,
	profile: ProjectProfile,
	options: {
		force?: boolean;
		skipAgentsMd?: boolean;
		skipPiDir?: boolean;
		skipTd?: boolean;
	} = {},
): Promise<InitResult> {
	const results: InitResult = { agentsMd: "", piSettings: "", tdInit: "" };

	// AGENTS.md
	if (!options.skipAgentsMd) {
		if (profile.hasAgentsMd && !options.force) {
			results.agentsMd =
				"⏭ AGENTS.md already exists (use force=true to overwrite)";
		} else {
			const content = generateAgentsMd(profile);
			fs.writeFileSync(
				path.join(projectPath, "AGENTS.md"),
				content,
				"utf-8",
			);
			results.agentsMd = `✅ Created AGENTS.md (${content.split("\n").length} lines)`;
		}
	}

	// .pi/settings.json
	if (!options.skipPiDir) {
		const piDir = path.join(projectPath, ".pi");
		const settingsPath = path.join(piDir, "settings.json");
		if (profile.hasPiDir) {
			results.piSettings = "⏭ .pi/ directory already exists";
		} else {
			fs.mkdirSync(piDir, { recursive: true });
			const settings = generatePiSettings(profile);
			fs.writeFileSync(
				settingsPath,
				JSON.stringify(settings, null, 2) + "\n",
				"utf-8",
			);
			results.piSettings = `✅ Created .pi/settings.json (skills: ${detectSkills(profile).join(", ")})`;
		}
	}

	// td init
	if (!options.skipTd) {
		if (profile.hasTd) {
			results.tdInit = "⏭ td already initialized (.todos/ exists)";
		} else {
			try {
				await execFileAsync("td", ["init"], {
					cwd: projectPath,
					timeout: 10_000,
				});
				results.tdInit = "✅ Initialized td task tracking";
			} catch (err: any) {
				results.tdInit = `❌ td init failed: ${err.message}`;
			}
		}
	}

	return results;
}
