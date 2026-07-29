/**
 * pi-github — Repo reference parsing and resolution.
 *
 * Supports three formats:
 *   - GitHub URL:       https://github.com/owner/repo/pull/123
 *   - Owner/repo#N:     owner/repo#123  or  repo#123 (with default owner)
 *   - Plain number:     123 (requires cwd for repo detection)
 *
 * Settings (in .pi/settings.json or global settings.json under "pi-github"):
 *   { "pi-github": { "defaultOwner": "espennilsen" } }
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ghJson, gitExec } from "./gh.ts";

// ── Settings ────────────────────────────────────────────────────

let defaultOwner: string | null = null;

export function setDefaultOwner(owner: string | null): void {
	defaultOwner = owner;
}

export function getDefaultOwner(): string | null {
	return defaultOwner;
}

// ── Types ───────────────────────────────────────────────────────

export interface RepoRef {
	owner: string | null;
	repo: string | null;
	prNumber: number | null;
}

export interface ResolvedRepo {
	owner: string;
	repo: string;
	slug: string;
	localPath: string | null;
}

// ── Parsing ─────────────────────────────────────────────────────

/**
 * Parse a repo/PR reference from args. Supports:
 *   - GitHub URL:       https://github.com/owner/repo/pull/123
 *   - Owner/repo#N:     owner/repo#123
 *   - Repo#N:           repo#123 (uses default owner from settings)
 *   - Owner/repo:       owner/repo (no PR number)
 *   - Repo name:        repo (uses default owner)
 *   - Plain number:     123
 *   - Empty (auto-detect from branch)
 *
 * Returns extracted parts — nulls for anything not found.
 */
export function parseRepoRef(argStr: string): RepoRef {
	const result: RepoRef = { owner: null, repo: null, prNumber: null };
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

	// GitHub repo URL without PR: https://github.com/owner/repo
	const repoUrlMatch = argStr.match(
		/(?:https?:\/\/)?github\.com\/([^/]+)\/([^/\s]+)/,
	);
	if (repoUrlMatch) {
		result.owner = repoUrlMatch[1];
		result.repo = repoUrlMatch[2];
		return result;
	}

	// owner/repo#N
	const fullRefMatch = argStr.match(/^([^/]+)\/([^#]+)#(\d+)$/);
	if (fullRefMatch) {
		result.owner = fullRefMatch[1];
		result.repo = fullRefMatch[2];
		result.prNumber = parseInt(fullRefMatch[3], 10);
		return result;
	}

	// owner/repo (no PR number)
	const slashMatch = argStr.match(/^([^/#]+)\/([^/#\s]+)$/);
	if (slashMatch) {
		result.owner = slashMatch[1];
		result.repo = slashMatch[2];
		return result;
	}

	// repo#N (uses default owner)
	const repoRefMatch = argStr.match(/^([^/#\s]+)#(\d+)$/);
	if (repoRefMatch) {
		result.owner = defaultOwner;
		result.repo = repoRefMatch[1];
		result.prNumber = parseInt(repoRefMatch[2], 10);
		return result;
	}

	// Plain number
	if (/^\d+$/.test(argStr)) {
		result.prNumber = parseInt(argStr, 10);
		return result;
	}

	// Plain repo name (uses default owner)
	if (/^[a-zA-Z0-9._-]+$/.test(argStr) && defaultOwner) {
		result.owner = defaultOwner;
		result.repo = argStr;
		return result;
	}

	return result;
}

/**
 * Extract repo ref and remaining args from a full args string.
 * The repo ref can appear anywhere in the args.
 * Returns { ref, remaining } where remaining is the args without the repo ref part.
 */
export function extractRepoRef(args: string): { ref: RepoRef; remaining: string } {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const ref: RepoRef = { owner: null, repo: null, prNumber: null };
	const remaining: string[] = [];

	for (const part of parts) {
		const parsed = parseRepoRef(part.replace(/^#/, ""));
		// Only consume tokens that contain explicit repo indicators (/, #, URL, or are pure numbers)
		// Don't consume plain names as repos when mixed with other args
		const isExplicitRef = part.includes("/") || part.includes("#") || part.includes("github.com") || /^\d+$/.test(part);
		if (isExplicitRef && (parsed.owner || parsed.repo || parsed.prNumber !== null)) {
			// Merge into ref (later parts override earlier)
			if (parsed.owner) ref.owner = parsed.owner;
			if (parsed.repo) ref.repo = parsed.repo;
			if (parsed.prNumber !== null) ref.prNumber = parsed.prNumber;
		} else {
			remaining.push(part);
		}
	}

	// If no explicit ref was found and there's exactly one arg that looks like a repo name, use it
	if (!ref.owner && !ref.repo && ref.prNumber === null && parts.length === 1) {
		const parsed = parseRepoRef(parts[0].replace(/^#/, ""));
		if (parsed.owner || parsed.repo) {
			ref.owner = parsed.owner;
			ref.repo = parsed.repo;
			ref.prNumber = parsed.prNumber;
			return { ref, remaining: "" };
		}
	}

	return { ref, remaining: remaining.join(" ") };
}

// ── Repo Resolution ─────────────────────────────────────────────

/**
 * Resolve a repo reference to owner/repo/slug, falling back to cwd detection.
 */
export async function resolveRepo(
	ref: RepoRef,
	cwd: string,
): Promise<{ owner: string; repo: string; slug: string } | null> {
	let owner = ref.owner;
	let repo = ref.repo;

	if (!owner || !repo) {
		const repoInfo = await ghJson<{ owner: { login: string }; name: string }>(
			["repo", "view", "--json", "owner,name"],
			cwd,
		);
		if (repoInfo) {
			owner = owner ?? repoInfo.owner.login;
			repo = repo ?? repoInfo.name;
		}
	}

	if (!owner || !repo) return null;
	return { owner, repo, slug: `${owner}/${repo}` };
}

/**
 * Resolve local clone path for a repo name.
 * Checks ~/Dev/<repo> first, then scans ~/Dev for a matching git remote.
 */
export async function resolveLocalClone(repoName: string, owner: string): Promise<string | null> {
	const homeDir = process.env.HOME || process.env.USERPROFILE || "";
	const devDir = join(homeDir, "Dev");

	// Direct match: ~/Dev/<repo>
	const direct = join(devDir, repoName);
	if (existsSync(direct)) {
		const isGit = await gitExec(["rev-parse", "--is-inside-work-tree"], direct);
		if (isGit.ok) return direct;
	}

	// Also try with dots replaced (e.g. battleground.no -> battleground-no)
	const altName = repoName.replace(/\./g, "-");
	if (altName !== repoName) {
		const alt = join(devDir, altName);
		if (existsSync(alt)) {
			const isGit = await gitExec(["rev-parse", "--is-inside-work-tree"], alt);
			if (isGit.ok) return alt;
		}
	}

	// Scan ~/Dev for a repo with matching remote
	const fullSlug = `${owner}/${repoName}`;
	try {
		const entries = await readdir(devDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dir = join(devDir, entry.name);
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

/**
 * Build a -R flag array for gh commands when targeting a remote repo.
 * Returns ["-R", "owner/repo"] or empty array if cwd should be used.
 */
export function repoFlag(owner: string | null, repo: string | null): string[] {
	if (owner && repo) return ["-R", `${owner}/${repo}`];
	return [];
}
