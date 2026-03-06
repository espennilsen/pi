/**
 * pi-github — gh CLI wrapper.
 *
 * Executes gh commands and returns parsed results.
 * All GitHub interactions go through the gh CLI for auth.
 */

import { execFile } from "node:child_process";

export interface GhResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	code: number;
}

const GH_TIMEOUT = 30_000;

export function gh(args: string[], cwd?: string): Promise<GhResult> {
	return new Promise((resolve) => {
		execFile("gh", args, { cwd, timeout: GH_TIMEOUT, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
			const code = err && "code" in err ? (err as any).code ?? 1 : err ? 1 : 0;
			resolve({
				ok: code === 0,
				stdout: stdout?.trim() ?? "",
				stderr: stderr?.trim() ?? "",
				code,
			});
		});
	});
}

/** Run a gh command and parse JSON output. Returns null on failure. */
export async function ghJson<T = any>(args: string[], cwd?: string): Promise<T | null> {
	const result = await gh(args, cwd);
	if (!result.ok) return null;
	try {
		return JSON.parse(result.stdout);
	} catch {
		return null;
	}
}

/** Run a GraphQL query via gh api graphql. */
export async function ghGraphql<T = any>(query: string, variables?: Record<string, any>, cwd?: string): Promise<T | null> {
	const args = ["api", "graphql", "-f", `query=${query}`];
	if (variables) {
		for (const [key, value] of Object.entries(variables)) {
			if (typeof value === "number" || typeof value === "boolean") {
				args.push("-F", `${key}=${value}`);
			} else {
				args.push("-f", `${key}=${value}`);
			}
		}
	}
	const result = await gh(args, cwd);
	if (!result.ok) return null;
	try {
		return JSON.parse(result.stdout);
	} catch {
		return null;
	}
}

/** Get the current repo's owner/name. */
export async function getRepoSlug(cwd?: string): Promise<string | null> {
	const result = await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd);
	return result.ok ? result.stdout : null;
}

/** Run a git command and return { ok, stdout, stderr }. */
export function gitExec(args: string[], cwd: string, timeoutMs = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
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

/**
 * Run a git command with retries on lock errors.
 * Git operations can fail transiently when an IDE or file watcher holds
 * .git/index.lock. Retries up to `maxRetries` times with a short sleep.
 */
export async function gitExecRetry(
	args: string[],
	cwd: string,
	opts?: { timeoutMs?: number; maxRetries?: number; delayMs?: number },
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	const { timeoutMs = 15_000, maxRetries = 3, delayMs = 500 } = opts ?? {};

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const result = await gitExec(args, cwd, timeoutMs);
		if (result.ok) return result;

		const isLockError = result.stderr.includes("index.lock") || (result.stderr.includes("Unable to create") && result.stderr.includes(".lock"));
		if (!isLockError || attempt === maxRetries) return result;

		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}

	// Unreachable, but satisfies TS
	return { ok: false, stdout: "", stderr: "retry exhausted" };
}

/** Get the current git branch name. */
export async function getCurrentBranch(cwd?: string): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("git", ["branch", "--show-current"], { cwd, timeout: 5_000 }, (err, stdout) => {
			resolve(err ? null : stdout?.trim() || null);
		});
	});
}

/**
 * Find the worktree path for a branch, if it's checked out in one.
 * Returns the worktree path or null if the branch isn't in any worktree.
 */
export async function findWorktreeForBranch(branch: string, cwd: string): Promise<string | null> {
	const result = await gitExec(["worktree", "list", "--porcelain"], cwd);
	if (!result.ok) return null;

	// Parse porcelain output: blocks separated by blank lines
	// Each block has: worktree <path>, HEAD <sha>, branch refs/heads/<name>
	let currentPath: string | null = null;
	for (const line of result.stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			currentPath = line.slice("worktree ".length);
		} else if (line.startsWith("branch refs/heads/")) {
			const branchName = line.slice("branch refs/heads/".length);
			if (branchName === branch) return currentPath;
		} else if (line === "") {
			currentPath = null;
		}
	}
	return null;
}
