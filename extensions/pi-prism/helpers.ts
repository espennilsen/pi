/**
 * Shared helpers for pi-prism widgets.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { DateTime } from "luxon";

// ── Types ────────────────────────────────────────────────────

export interface QueryResult {
	rows: Record<string, unknown>[];
}

export type Q = (sql: string, params?: unknown[]) => Promise<QueryResult>;

// ── DB Query Helper ──────────────────────────────────────────

const ACTOR = "pi-prism";

export function createQuery(events: ExtensionAPI["events"]): Q {
	return (sql: string, params: unknown[] = []): Promise<QueryResult> =>
		new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("timeout")), 5000);
			events.emit("kysely:query", {
				actor: ACTOR,
				input: { sql, params },
				reply: (r: QueryResult) => {
					clearTimeout(timeout);
					resolve(r);
				},
				ack: (a: { ok: boolean; error?: string }) => {
					if (!a.ok) {
						clearTimeout(timeout);
						reject(new Error(a.error));
					}
				},
			});
		});
}

// ── Hub JSON-RPC Helper ──────────────────────────────────────

export interface HubTask {
	id: string;
	title: string;
	state: string;
	priority: string;
	project: string;
	branch: string | null;
	prUrl: string | null;
	prNumber: number | null;
	externalTaskId: string | null;
	assignedAgentId: string | null;
}

/**
 * Fire a JSON-RPC call to the A2A Hub pipeline API.
 * Returns the result object, or null on error/timeout.
 */
export async function hubRpc(
	rpcUrl: string,
	apiKey: string,
	method: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	try {
		const res = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
			body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
			signal: AbortSignal.timeout(8_000),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { result?: Record<string, unknown>; error?: unknown };
		return data.result ?? null;
	} catch {
		return null;
	}
}

// ── CLI Exec Helper ──────────────────────────────────────────

export async function execCmd(cmd: string, cwd: string): Promise<string> {
	const { exec } = await import("node:child_process");
	const { promisify } = await import("node:util");
	try {
		const { stdout } = await promisify(exec)(cmd, { cwd, timeout: 5000 });
		return stdout.trim();
	} catch {
		return "";
	}
}

// ── Luxon Date Helpers (DST-safe) ────────────────────────────

/** Today's date in ISO format (YYYY-MM-DD), using Oslo timezone. */
export function todayIso(): string {
	return DateTime.now().setZone("Europe/Oslo").toISODate()!;
}

/** Date N days from now in ISO format (YYYY-MM-DD), using Oslo timezone. Handles DST correctly. */
export function daysAheadIso(days: number): string {
	return DateTime.now().setZone("Europe/Oslo").plus({ days }).toISODate()!;
}

// ── Format Helpers ───────────────────────────────────────────

export function pad(s: string, width: number): string {
	const vis = visibleWidth(s);
	if (vis >= width) return truncateToWidth(s, width);
	return s + " ".repeat(width - vis);
}

export function fmtDate(iso: string): string {
	if (!iso) return "";
	try {
		return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Oslo" });
	} catch {
		return iso.slice(0, 10);
	}
}

export function fmtTime(iso: string): string {
	if (!iso) return "     ";
	try {
		return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" });
	} catch {
		return iso.slice(11, 16);
	}
}

export function fmtAgo(ts: number): string {
	const d = Date.now() - ts;
	if (d < 60000) return "just now";
	if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
	return `${Math.floor(d / 3600000)}h ago`;
}

