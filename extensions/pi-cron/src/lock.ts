/**
 * pi-cron — Lock file for single-instance scheduler.
 *
 * Uses a PID-based lock file at <cwd>/.pi/pi-cron.lock.
 * On acquire, writes our PID. On release, removes the file.
 * Stale locks (dead PIDs) are automatically cleaned up.
 *
 * The lock is per-workspace — multiple agents can each run their
 * own scheduler independently.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Configurable lock path ──────────────────────────────────────

let lockPath: string | null = null;

export function setLockPath(p: string): void { lockPath = p; }
export function getLockPath(): string {
	if (!lockPath) throw new Error("pi-cron lock path not initialized. Call setLockPath() first.");
	return lockPath;
}

export function initLockPath(cwd: string): void {
	lockPath = path.join(cwd, ".pi", "pi-cron.lock");
}

// ── Helpers ─────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Try to acquire the scheduler lock.
 * Returns true if we got it, false if another live process holds it.
 */
export function acquireLock(): boolean {
	const lp = getLockPath();
	fs.mkdirSync(path.dirname(lp), { recursive: true });

	// Check existing lock
	try {
		const content = fs.readFileSync(lp, "utf-8").trim();
		const pid = parseInt(content, 10);
		if (!isNaN(pid) && isProcessAlive(pid) && pid !== process.pid) {
			return false; // Another live process holds the lock
		}
		// Stale lock — fall through to acquire
	} catch {
		// No lock file — fall through to acquire
	}

	fs.writeFileSync(lp, String(process.pid), "utf-8");
	return true;
}

/**
 * Release the scheduler lock (only if we hold it).
 */
export function releaseLock(): void {
	try {
		const lp = getLockPath();
		const content = fs.readFileSync(lp, "utf-8").trim();
		const pid = parseInt(content, 10);
		if (pid === process.pid) {
			fs.unlinkSync(lp);
		}
	} catch {
		// Lock file already gone — fine
	}
}

/**
 * Check who holds the lock, if anyone.
 */
export function lockHolder(): number | null {
	try {
		const lp = getLockPath();
		const content = fs.readFileSync(lp, "utf-8").trim();
		const pid = parseInt(content, 10);
		if (!isNaN(pid) && isProcessAlive(pid)) return pid;
		return null;
	} catch {
		return null;
	}
}
