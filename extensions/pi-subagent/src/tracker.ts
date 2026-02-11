/**
 * pi-subagent — One-shot agent tracker.
 *
 * Tracks running/completed subagent runs for status queries.
 * Entries auto-pruned after 24 hours.
 */

import type { OneShotEntry, OneShotStatus } from "./types.ts";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
let _seq = 0;

class OneShotTracker {
	private entries = new Map<string, OneShotEntry>();
	private pruneTimer: ReturnType<typeof setInterval> | null = null;

	constructor() {
		this.pruneTimer = setInterval(() => this.prune(), 5 * 60 * 1000);
		this.pruneTimer.unref();
	}

	start(agentName: string, taskPreview: string): string {
		this.prune();
		const id = `oneshot_${Date.now().toString(36)}_${(++_seq).toString(36)}`;
		const entry: OneShotEntry = {
			id,
			agentName,
			taskPreview: taskPreview.slice(0, 200),
			status: "running",
			startedAt: Date.now(),
			completedAt: null,
			durationMs: null,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
			},
			model: null,
			exitCode: null,
		};
		this.entries.set(id, entry);
		return id;
	}

	complete(
		id: string,
		result: {
			status: OneShotStatus;
			usage: OneShotEntry["usage"];
			model: string | null;
			exitCode: number;
			responsePreview?: string;
			error?: string;
		},
	): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.status = result.status;
		const now = Date.now();
		entry.completedAt = now;
		entry.durationMs = now - entry.startedAt;
		entry.usage = result.usage;
		entry.model = result.model;
		entry.exitCode = result.exitCode;
		entry.responsePreview = result.responsePreview?.slice(0, 500);
		entry.error = result.error;
	}

	getAll(): OneShotEntry[] {
		this.prune();
		return Array.from(this.entries.values()).sort(
			(a, b) => b.startedAt - a.startedAt,
		);
	}

	get(id: string): OneShotEntry | undefined {
		return this.entries.get(id);
	}

	private prune(): void {
		const cutoff = Date.now() - MAX_AGE_MS;
		for (const [id, entry] of this.entries) {
			if (entry.status === "running") continue;
			const endTime = entry.completedAt ?? entry.startedAt;
			if (endTime < cutoff) {
				this.entries.delete(id);
			}
		}
	}

	dispose(): void {
		if (this.pruneTimer) {
			clearInterval(this.pruneTimer);
			this.pruneTimer = null;
		}
	}
}

export const oneShotTracker = new OneShotTracker();
