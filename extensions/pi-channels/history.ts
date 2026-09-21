/**
 * pi-channels — Message history module.
 *
 * Logs all incoming/outgoing messages to a SQLite table via pi-kysely.
 * Supports querying, retention cleanup, and TUI display.
 *
 * Table: pi_channels__messages
 * Migrations: Kysely migration API (legacy pi_channels_migrations retained)
 *
 * Config: messageRetentionDays in pi-channels settings (default: 30)
 */

import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { ChannelMessage, IncomingMessage } from "./types.ts";

export const TABLE_NAME = "pi_channels__messages";
export const MIGRATIONS_TABLE = "pi_channels_migrations";

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

// Preserve the existing schema, including constraints and timestamp defaults.
// This is migration 0001: add new migrations rather than changing its checksum.
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
	private disposed = false;
	private pending = new Set<() => void>();
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

		// DDL belongs on the migration API, not the RBAC-checked DML query API.
		await this.request("kysely:migration:apply", {
			migrations: [{
				name: "0001_channel_history",
				sql: `${SCHEMA_SQL}
CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (id, version) VALUES (1, 1);`,
			}],
		});

		// Register ownership on every session, including when migrations are skipped.
		// Existing tables are preserved by the additive schema API.
		await this.request("kysely:schema:register", {
			tables: {
				[TABLE_NAME]: { columns: {
					id: { type: "integer", primaryKey: true, autoIncrement: true },
					adapter: { type: "text", notNull: true },
					direction: { type: "text", notNull: true },
					sender: { type: "text" },
					recipient: { type: "text" },
					text: { type: "text" },
					metadata: { type: "text" },
					created_at: { type: "text" },
				} },
				[MIGRATIONS_TABLE]: { columns: {
					id: { type: "integer", primaryKey: true },
					version: { type: "integer", notNull: true, default: 0 },
				} },
			},
		});

		// Run initial cleanup
		await this.cleanup();

		if (this.disposed) throw new Error("Message history disposed");
		this.initialized = true;
	}

	/** Cancel local query waits and prevent further work for this session. */
	dispose(): void {
		this.disposed = true;
		this.initialized = false;
		for (const cancel of this.pending) cancel();
	}

	/** Log an incoming message (fire-and-forget). */
	logIncoming(msg: IncomingMessage, adapterName: string): void {
		if (!this.initialized) return;
		let meta: string;
		try {
			meta = JSON.stringify(msg.metadata ?? {});
		} catch (err) {
			this.logErrors?.("history.logIncoming.metadata-error", { adapter: adapterName, error: err }, "ERROR");
			meta = "{}";
		}
		this.execute(INSERT_SQL, [adapterName, "in", msg.sender, null, msg.text, meta])
			.catch((error) => {
				this.logErrors?.("history.logIncoming.error", { adapter: adapterName, error }, "ERROR");
			}); // best-effort
	}

	/** Log an outgoing message (fire-and-forget). */
	logOutgoing(msg: ChannelMessage, adapterName: string): void {
		if (!this.initialized) return;
		let meta: string;
		try {
			meta = JSON.stringify(msg.metadata ?? {});
		} catch (err) {
			this.logErrors?.("history.logOutgoing.metadata-error", { adapter: adapterName, error: err }, "ERROR");
			meta = "{}";
		}
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
		// Clamp limit and offset to safe bounds
		const rawLimit = filters.limit ?? 50;
		const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
		const rawOffset = filters.offset ?? 0;
		const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
		const sql = `SELECT * FROM ${TABLE_NAME} ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
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
		return this.request("kysely:query", { input: { sql, params } });
	}

	private async request<T>(event: string, payload: Record<string, unknown>): Promise<T> {
		if (this.disposed) throw new Error("Message history disposed");
		const TIMEOUT_MS = 10_000;
		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (complete: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.pending.delete(cancel);
				complete();
			};
			const cancel = () => finish(() => reject(new Error("Message history disposed")));
			const timeout = setTimeout(() => finish(() => reject(new Error("History query timed out (kysely not responding)"))), TIMEOUT_MS);
			this.pending.add(cancel);
			try {
				this.events.emit(event, {
					actor: "pi-channels",
					...payload,
					reply: (result: T & { ok?: boolean; errors?: string[] }) => {
						if (result.ok === false) {
							finish(() => reject(new Error(result.errors?.join("; ") || "History request failed")));
						} else {
							finish(() => resolve(result));
						}
					},
					ack: (ack: { ok: boolean; error?: string }) => {
						if (!ack.ok) finish(() => reject(new Error(ack.error ?? "History query failed")));
					},
				} as any);
			} catch (err) {
				finish(() => reject(err));
			}
		});
	}

	private async execute(sql: string, params: unknown[] = []): Promise<void> {
		await this.queryRaw(sql, params);
	}
}
