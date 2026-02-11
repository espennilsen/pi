/**
 * pi-cron — Lock file for single-instance scheduler.
 *
 * Uses a PID-based lock file at ~/.pi/agent/pi-cron.lock.
 * On acquire, writes our PID. On release, removes the file.
 * Stale locks (dead PIDs) are automatically cleaned up.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LOCK_PATH = path.join(os.homedir(), ".pi", "agent", "pi-cron.lock");

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
	fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });

	// Check existing lock
	try {
		const content = fs.readFileSync(LOCK_PATH, "utf-8").trim();
		const pid = parseInt(content, 10);
		if (!isNaN(pid) && isProcessAlive(pid) && pid !== process.pid) {
			return false; // Another live process holds the lock
		}
		// Stale lock — fall through to acquire
	} catch {
		// No lock file — fall through to acquire
	}

	fs.writeFileSync(LOCK_PATH, String(process.pid), "utf-8");
	return true;
}

/**
 * Release the scheduler lock (only if we hold it).
 */
export function releaseLock(): void {
	try {
		const content = fs.readFileSync(LOCK_PATH, "utf-8").trim();
		const pid = parseInt(content, 10);
		if (pid === process.pid) {
			fs.unlinkSync(LOCK_PATH);
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
		const content = fs.readFileSync(LOCK_PATH, "utf-8").trim();
		const pid = parseInt(content, 10);
		if (!isNaN(pid) && isProcessAlive(pid)) return pid;
		return null;
	} catch {
		return null;
	}
}
