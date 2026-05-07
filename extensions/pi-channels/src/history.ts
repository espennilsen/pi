/**
 * pi-channels — Message history module.
 *
 * Logs all incoming/outgoing messages to a SQLite table via pi-kysely.
 * Supports querying, retention cleanup, and TUI display.
 *
 * Table: pi_channels__messages
 *
 * Config: messageRetentionDays in pi-channels settings (default: 30)
 */

import type { EventBus } from "@mariozechner/pi-coding-agent";
import type { ChannelMessage, IncomingMessage } from "./types.ts";

export const TABLE_NAME = "pi_channels__messages";

export interface MessageRow {
	id: number;
	adapter: string;
	direction: "in" | "out";
	sender: string | null;
	recipient: string | null;
	text: string | null;
	metadata: string | null;
	created_at: string;
}

export interface HistoryQuery {
	adapter?: string;
	direction?: "in" | "out";
	limit?: number;
	offset?: number;
	since?: string; // ISO datetime string
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	adapter TEXT NOT NULL,
	direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
	sender TEXT,
	recipient TEXT,
	text TEXT,
	metadata TEXT,
	created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_adapter ON ${TABLE_NAME}(adapter);
CREATE INDEX IF NOT EXISTS idx_messages_created ON ${TABLE_NAME}(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON ${TABLE_NAME}(direction);
`;

const INSERT_SQL = `INSERT INTO ${TABLE_NAME} (adapter, direction, sender, recipient, text, metadata) VALUES (?, ?, ?, ?, ?, ?)`;

export class MessageHistory {
	private events: EventBus;
	private retentionDays: number;
	private initialized = false;
	private logErrors: ((event: string, data: unknown, level?: string) => void) | null = null;

	constructor(events: EventBus, retentionDays: number = 30) {
		this.events = events;
		this.retentionDays = retentionDays;
	}

	setErrorLogger(log: (event: string, data: unknown, level?: string) => void): void {
		this.logErrors = log;
	}

	/** Create table and run initial cleanup. Call after kysely is ready. */
	async init(): Promise<void> {
		if (this.initialized) return;

		// Enable WAL mode first (separate statement)
		await this.execute("PRAGMA journal_mode = WAL");

		// Create schema (each statement separately — SQLite doesn't handle multi-statement well)
		const statements = SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean);
		for (const stmt of statements) {
			await this.execute(stmt);
		}

		// Run initial cleanup
		await this.cleanup();

		this.initialized = true;
	}

	/** Log an incoming message (fire-and-forget). */
	logIncoming(msg: IncomingMessage, adapterName: string): void {
		if (!this.initialized) return;
		const meta = JSON.stringify(msg.metadata ?? {});
		this.execute(INSERT_SQL, [adapterName, "in", msg.sender, null, msg.text, meta])
			.catch((error) => {
				this.logErrors?.("history.logIncoming.error", { adapter: adapterName, error }, "ERROR");
			}); // best-effort
	}

	/** Log an outgoing message (fire-and-forget). */
	logOutgoing(msg: ChannelMessage, adapterName: string): void {
		if (!this.initialized) return;
		const meta = JSON.stringify(msg.metadata ?? {});
		this.execute(INSERT_SQL, [adapterName, "out", null, msg.recipient, msg.text ?? null, meta])
			.catch((error) => {
				this.logErrors?.("history.logOutgoing.error", { adapter: adapterName, error }, "ERROR");
			}); // best-effort
	}

	/** Query message history. */
	async query(filters: HistoryQuery = {}): Promise<MessageRow[]> {
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (filters.adapter) {
			conditions.push("adapter = ?");
			params.push(filters.adapter);
		}
		if (filters.direction) {
			conditions.push("direction = ?");
			params.push(filters.direction);
		}
		if (filters.since) {
			conditions.push("created_at >= ?");
			params.push(filters.since);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = filters.limit ?? 50;
		const offset = filters.offset ?? 0;
		const sql = `SELECT * FROM ${TABLE_NAME} ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
		params.push(limit, offset);

		const result = await this.queryRaw(sql, params);
		return result.rows as unknown as MessageRow[];
	}

	/** Delete messages older than retentionDays. 0 or negative = keep forever. */
	async cleanup(): Promise<number> {
		if (this.retentionDays <= 0) return 0;
		const sql = `DELETE FROM ${TABLE_NAME} WHERE created_at < datetime('now', ?)`;
		const result = await this.queryRaw(sql, [`-${this.retentionDays} days`]);
		return result.numAffectedRows ?? 0;
	}

	/** Count messages (for stats). */
	async count(filters: HistoryQuery = {}): Promise<number> {
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (filters.adapter) {
			conditions.push("adapter = ?");
			params.push(filters.adapter);
		}
		if (filters.direction) {
			conditions.push("direction = ?");
			params.push(filters.direction);
		}
		if (filters.since) {
			conditions.push("created_at >= ?");
			params.push(filters.since);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const result = await this.queryRaw(`SELECT COUNT(*) as cnt FROM ${TABLE_NAME} ${where}`, params);
		return Number(result.rows[0]?.cnt ?? 0);
	}

	// ── Internal ─────────────────────────────────────────────

	private async queryRaw(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; numAffectedRows?: number }> {
		const TIMEOUT_MS = 10_000;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("History query timed out (kysely not responding)")), TIMEOUT_MS);
			try {
				this.events.emit("kysely:query", {
					actor: "pi-channels",
					input: { sql, params },
					reply: (result: { rows: Record<string, unknown>[]; numAffectedRows?: number }) => {
						clearTimeout(timeout);
						resolve(result);
					},
				} as any);
			} catch (err) {
				clearTimeout(timeout);
				reject(err);
			}
		});
	}

	private async execute(sql: string, params: unknown[] = []): Promise<void> {
		await this.queryRaw(sql, params);
	}
}
