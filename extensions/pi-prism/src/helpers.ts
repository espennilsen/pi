/**
 * Shared helpers for pi-prism widgets.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

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

// ── Format Helpers ───────────────────────────────────────────

export function pad(s: string, width: number): string {
	const vis = visibleWidth(s);
	if (vis >= width) return truncateToWidth(s, width);
	return s + " ".repeat(width - vis);
}

export function fmtMoney(amount: number, cur = "NOK"): string {
	const abs = Math.abs(amount);
	return `${amount < 0 ? "-" : ""}${abs.toLocaleString("nb-NO", { maximumFractionDigits: 0 })} ${cur}`;
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

export function bar(ratio: number, width: number): string {
	const r = Math.max(0, Math.min(1, ratio));
	const f = Math.round(r * width);
	return "█".repeat(f) + "░".repeat(width - f);
}
