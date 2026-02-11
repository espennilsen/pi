/**
 * pi-workon — Tech stack detection.
 *
 * Scans a project directory and returns a full profile: language, frameworks,
 * package manager, scripts, monorepo info, Docker, CI, testing, linting.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────────

export interface ProjectProfile {
	name: string;
	path: string;
	language:
		| "typescript"
		| "javascript"
		| "python"
		| "rust"
		| "go"
		| "unknown";
	packageManager:
		| "npm"
		| "pnpm"
		| "yarn"
		| "bun"
		| "pip"
		| "poetry"
		| "cargo"
		| "go"
		| "none";
	frameworks: string[];
	scripts: Record<string, string>;
	monorepo: boolean;
	workspaces: string[];
	docker: boolean;
	ci: boolean;
	git: boolean;
	gitBranch: string | null;
	configFiles: string[];
	directories: string[];
	hasAgentsMd: boolean;
	hasPiDir: boolean;
	hasTd: boolean;
	testFramework: string | null;
	linting: string[];
	description: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────

function readJson(filePath: string): any | null {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return null;
	}
}

function exists(base: string, ...segments: string[]): boolean {
	return fs.existsSync(path.join(base, ...segments));
}

function listDir(dir: string): string[] {
	try {
		return fs.readdirSync(dir).filter(
			(e) =>
				!e.startsWith(".") &&
				e !== "node_modules" &&
				e !== "__pycache__" &&
				e !== "dist" &&
				e !== "build" &&
				e !== ".next" &&
				e !== "target",
		);
	} catch {
		return [];
	}
}

// ── Framework Detection ─────────────────────────────────────────

function detectFrameworks(deps: Record<string, string>): string[] {
	const frameworks: string[] = [];
	const checks: [string, string[]][] = [
		["Eleventy", ["@11ty/eleventy"]],
		["TanStack Start", ["@tanstack/react-start"]],
		["TanStack Router", ["@tanstack/react-router"]],
		["TanStack Query", ["@tanstack/react-query"]],
		["Next.js", ["next"]],
		["React Native", ["react-native"]],
		["Expo", ["expo"]],
		["Vue", ["vue"]],
		["Svelte", ["svelte"]],
		["SvelteKit", ["@sveltejs/kit"]],
		["Astro", ["astro"]],
		["Express", ["express"]],
		["Fastify", ["fastify"]],
		["Hono", ["hono"]],
		["React", ["react"]],
		["Clerk", ["@clerk/express", "@clerk/tanstack-react-start", "@clerk/nextjs"]],
		["Prisma", ["@prisma/client", "prisma"]],
		["Drizzle", ["drizzle-orm"]],
		["Firebase", ["firebase", "firebase-admin"]],
		["Tailwind CSS", ["tailwindcss"]],
		["Vite", ["vite"]],
		["oRPC", ["@orpc/tanstack-query", "@orpc/server"]],
		["Radix UI", ["@radix-ui/react-dialog", "@radix-ui/themes"]],
		["Sentry", ["@sentry/tanstackstart-react", "@sentry/nextjs", "@sentry/node"]],
		["tRPC", ["@trpc/next", "@trpc/server"]],
		["Auth.js", ["next-auth", "@auth/prisma-adapter"]],
		["Framer Motion", ["framer-motion"]],
		["Vitest", ["vitest"]],
		["Jest", ["jest"]],
		["LlamaIndex", ["llamaindex"]],
	];

	for (const [name, pkgs] of checks) {
		if (pkgs.some((p) => p in deps)) {
			frameworks.push(name);
		}
	}
	return frameworks;
}

// ── Package Manager ─────────────────────────────────────────────

function detectPackageManager(
	dir: string,
): ProjectProfile["packageManager"] {
	if (exists(dir, "pnpm-lock.yaml") || exists(dir, "pnpm-workspace.yaml"))
		return "pnpm";
	if (exists(dir, "yarn.lock")) return "yarn";
	if (exists(dir, "bun.lockb") || exists(dir, "bun.lock")) return "bun";
	if (exists(dir, "package-lock.json")) return "npm";
	if (exists(dir, "poetry.lock") || exists(dir, "pyproject.toml"))
		return "poetry";
	if (exists(dir, "requirements.txt") || exists(dir, "setup.py"))
		return "pip";
	if (exists(dir, "Cargo.lock") || exists(dir, "Cargo.toml")) return "cargo";
	if (exists(dir, "go.mod")) return "go";
	if (exists(dir, "package.json")) return "npm";
	return "none";
}

// ── Test Framework ──────────────────────────────────────────────

function detectTestFramework(
	dir: string,
	deps: Record<string, string>,
): string | null {
	if ("vitest" in deps) return "vitest";
	if ("jest" in deps) return "jest";
	if ("mocha" in deps) return "mocha";
	if ("ava" in deps) return "ava";
	if (exists(dir, "pytest.ini") || exists(dir, "conftest.py"))
		return "pytest";
	if (exists(dir, "pyproject.toml")) {
		try {
			const content = fs.readFileSync(
				path.join(dir, "pyproject.toml"),
				"utf-8",
			);
			if (content.includes("[tool.pytest")) return "pytest";
		} catch {
			/* ignore */
		}
	}
	return null;
}

// ── Linting/Formatting ─────────────────────────────────────────

function detectLinting(
	dir: string,
	deps: Record<string, string>,
): string[] {
	const tools: string[] = [];
	if (
		"eslint" in deps ||
		exists(dir, ".eslintrc.json") ||
		exists(dir, ".eslintrc.js") ||
		exists(dir, "eslint.config.js") ||
		exists(dir, "eslint.config.mjs")
	)
		tools.push("ESLint");
	if (
		"prettier" in deps ||
		exists(dir, ".prettierrc") ||
		exists(dir, ".prettierrc.json")
	)
		tools.push("Prettier");
	if (
		"biome" in deps ||
		exists(dir, "biome.json") ||
		exists(dir, "biome.jsonc")
	)
		tools.push("Biome");
	if (exists(dir, ".editorconfig")) tools.push("EditorConfig");
	if ("ruff" in deps || exists(dir, "ruff.toml")) tools.push("Ruff");
	if (exists(dir, ".flake8") || exists(dir, "setup.cfg"))
		tools.push("Flake8");
	if ("black" in deps) tools.push("Black");
	return tools;
}

// ── Workspaces / Monorepo ───────────────────────────────────────

function detectWorkspaces(dir: string): string[] {
	if (exists(dir, "pnpm-workspace.yaml")) {
		try {
			const content = fs.readFileSync(
				path.join(dir, "pnpm-workspace.yaml"),
				"utf-8",
			);
			const match = content.match(
				/packages:\s*\n((?:\s+-\s+.+\n?)+)/,
			);
			if (match) {
				return match[1]
					.split("\n")
					.map((l) =>
						l
							.replace(/^\s+-\s+['"]?/, "")
							.replace(/['"]?\s*$/, ""),
					)
					.filter(Boolean);
			}
		} catch {
			/* ignore */
		}
	}

	const pkg = readJson(path.join(dir, "package.json"));
	if (pkg?.workspaces) {
		const ws = Array.isArray(pkg.workspaces)
			? pkg.workspaces
			: pkg.workspaces.packages || [];
		return ws;
	}

	if (
		exists(dir, "turbo.json") ||
		exists(dir, "nx.json") ||
		exists(dir, "lerna.json")
	) {
		const candidates = ["packages", "apps", "libs", "services"];
		return candidates.filter((c) => exists(dir, c));
	}

	return [];
}

// ── Config Files ────────────────────────────────────────────────

function getConfigFiles(dir: string): string[] {
	const candidates = [
		"package.json",
		"tsconfig.json",
		"tsconfig.base.json",
		"vite.config.ts",
		"vite.config.js",
		"next.config.js",
		"next.config.mjs",
		"next.config.ts",
		"eleventy.config.js",
		"eleventy.config.cjs",
		"eleventy.config.mjs",
		".eleventy.js",
		"astro.config.mjs",
		"svelte.config.js",
		"docker-compose.yml",
		"docker-compose.yaml",
		"Dockerfile",
		"Makefile",
		"pyproject.toml",
		"requirements.txt",
		"setup.py",
		"Cargo.toml",
		"go.mod",
		"turbo.json",
		"nx.json",
		"lerna.json",
		"pnpm-workspace.yaml",
		".env.example",
		".env.local.example",
		"tailwind.config.js",
		"tailwind.config.ts",
		"postcss.config.js",
		"biome.json",
		"biome.jsonc",
		"eslint.config.js",
		"eslint.config.mjs",
		".eslintrc.json",
		".prettierrc",
		".prettierrc.json",
		"AGENTS.md",
		"CLAUDE.md",
		"README.md",
	];
	return candidates.filter((f) => exists(dir, f));
}

// ── Git Branch ──────────────────────────────────────────────────

async function getGitBranch(dir: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["branch", "--show-current"],
			{ cwd: dir, timeout: 5000 },
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

// ── Main Detection ──────────────────────────────────────────────

/**
 * Scan a project directory and build a full stack profile.
 */
export async function detectStack(
	projectPath: string,
): Promise<ProjectProfile> {
	const name = path.basename(projectPath);
	const pkg = readJson(path.join(projectPath, "package.json"));
	const allDeps = {
		...(pkg?.dependencies || {}),
		...(pkg?.devDependencies || {}),
	};

	let language: ProjectProfile["language"] = "unknown";
	if (
		exists(projectPath, "tsconfig.json") ||
		exists(projectPath, "tsconfig.base.json")
	) {
		language = "typescript";
	} else if (exists(projectPath, "package.json")) {
		language = "javascript";
	} else if (
		exists(projectPath, "pyproject.toml") ||
		exists(projectPath, "requirements.txt") ||
		exists(projectPath, "setup.py")
	) {
		language = "python";
	} else if (exists(projectPath, "Cargo.toml")) {
		language = "rust";
	} else if (exists(projectPath, "go.mod")) {
		language = "go";
	}

	const workspaces = detectWorkspaces(projectPath);
	const directories = listDir(projectPath).filter((e) => {
		try {
			return fs.statSync(path.join(projectPath, e)).isDirectory();
		} catch {
			return false;
		}
	});

	const gitBranch = await getGitBranch(projectPath);

	return {
		name,
		path: projectPath,
		language,
		packageManager: detectPackageManager(projectPath),
		frameworks: detectFrameworks(allDeps),
		scripts: pkg?.scripts || {},
		monorepo: workspaces.length > 0,
		workspaces,
		docker:
			exists(projectPath, "Dockerfile") ||
			exists(projectPath, "docker-compose.yml") ||
			exists(projectPath, "docker-compose.yaml"),
		ci:
			exists(projectPath, ".github", "workflows") ||
			exists(projectPath, ".gitlab-ci.yml"),
		git: exists(projectPath, ".git"),
		gitBranch,
		configFiles: getConfigFiles(projectPath),
		directories,
		hasAgentsMd: exists(projectPath, "AGENTS.md"),
		hasPiDir: exists(projectPath, ".pi"),
		hasTd: exists(projectPath, ".todos"),
		testFramework: detectTestFramework(projectPath, allDeps),
		linting: detectLinting(projectPath, allDeps),
		description: pkg?.description || null,
	};
}
