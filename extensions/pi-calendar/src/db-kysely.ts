/**
 * pi-calendar — Database layer via pi-kysely event bus.
 *
 * Drop-in replacement for db.ts. No direct imports from pi-kysely,
 * no better-sqlite3 dependency. All DB access via events:
 *
 *   - kysely:info   — detect SQL dialect (sqlite/postgres/mysql)
 *   - kysely:schema:register — table creation (portable DDL)
 *   - kysely:query  — raw SQL for reads/writes (simple, expressive)
 *
 * Dialect-aware: queries `kysely:info` on init to detect the active
 * driver and adapts dialect-specific SQL (e.g. upsert syntax).
 *
 * Requires pi-kysely extension to be loaded.
 */

import { readdirSync, readFileSync } from "node:fs";
import type { EventBus } from "@mariozechner/pi-coding-agent";
import type { CalendarEvent, CreateEventInput, RecurrenceRule, UpdateEventInput } from "./types.ts";

const ACTOR = "pi-calendar";

type Driver = "sqlite" | "postgres" | "mysql";

let events: EventBus;
let driver: Driver = "sqlite";

// ── Schema (portable DDL via Kysely schema builder) ─────────────

const SCHEMA = {
	actor: ACTOR,
	tables: {
		calendar_events: {
			columns: {
				id:               { type: "integer" as const, primaryKey: true, autoIncrement: true },
				title:            { type: "text" as const, notNull: true },
				description:      { type: "text" as const },
				start_time:       { type: "text" as const, notNull: true },
				end_time:         { type: "text" as const, notNull: true },
				all_day:          { type: "integer" as const, notNull: true, default: 0 },
				color:            { type: "text" as const },
				recurrence:       { type: "text" as const },
				recurrence_rule:  { type: "text" as const },
				recurrence_end:   { type: "text" as const },
				reminder_minutes: { type: "integer" as const },
				created_at:       { type: "text" as const, notNull: true },
				updated_at:       { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["start_time"], name: "idx_cal_events_start" },
				{ columns: ["end_time"], name: "idx_cal_events_end" },
			],
		},
		calendar_reminders_sent: {
			columns: {
				id:         { type: "integer" as const, primaryKey: true, autoIncrement: true },
				event_id:   { type: "integer" as const, notNull: true },
				event_time: { type: "text" as const, notNull: true },
				sent_at:    { type: "text" as const, notNull: true },
			},
			unique: [["event_id", "event_time"]],
			indexes: [
				{ columns: ["event_id", "event_time"], name: "idx_cal_reminders_event" },
			],
		},
	},
};

// ── Migrations ──────────────────────────────────────────────────

const migrationDir = new URL("../migrations", import.meta.url).pathname;

function loadMigrations(): Array<{ name: string; sql: string }> {
	try {
		return readdirSync(migrationDir)
			.filter((f) => f.endsWith(".sql"))
			.sort()
			.map((f) => ({
				name: f.replace(/\.sql$/, ""),
				sql: readFileSync(`${migrationDir}/${f}`, "utf-8"),
			}));
	} catch {
		return [];
	}
}

// ── Init ────────────────────────────────────────────────────────

export async function initDb(eventBus: EventBus): Promise<void> {
	events = eventBus;

	// Detect SQL dialect from pi-kysely (falls back to sqlite)
	events.emit("kysely:info", {
		reply: (info: { defaultDriver?: string }) => {
			if (info.defaultDriver === "postgres" || info.defaultDriver === "mysql") {
				driver = info.defaultDriver;
			}
		},
	});

	// Apply tracked migrations (skips already-applied ones)
	const migrations = loadMigrations();
	if (migrations.length > 0) {
		await new Promise<void>((resolve, reject) => {
			events.emit("kysely:migration:apply", {
				actor: ACTOR,
				migrations,
				reply: (result: { ok: boolean; applied: string[]; skipped: string[]; errors: string[] }) => {
					if (result.ok) resolve();
					else reject(new Error(`Migration failed: ${result.errors.join("; ")}`));
				},
			});
		});
	}

	// Schema:register as safety net — catches any column/index drift
	// that might exist between migration files and the SCHEMA constant.
	// Additive-only, idempotent, portable across dialects.
	await new Promise<void>((resolve, reject) => {
		events.emit("kysely:schema:register", {
			...SCHEMA,
			reply: (result: { ok: boolean; errors: string[] }) => {
				if (result.ok) resolve();
				else reject(new Error(`Schema register failed: ${result.errors.join("; ")}`));
			},
		});
	});
}

/** Returns the detected SQL dialect. */
export function getDriver(): Driver {
	return driver;
}

// ── Query helper ────────────────────────────────────────────────

interface QueryResult {
	rows: Record<string, unknown>[];
	numAffectedRows?: number;
	insertId?: number | bigint;
}

function query(sql: string, params: unknown[] = []): Promise<QueryResult> {
	return new Promise((resolve, reject) => {
		events.emit("kysely:query", {
			actor: ACTOR,
			input: { sql, params },
			reply: (result: QueryResult) => resolve(result),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});
}

// ── Helpers ─────────────────────────────────────────────────────

function now(): string {
	return new Date().toISOString();
}

function mapRow(r: any): CalendarEvent {
	return {
		...r,
		all_day: !!r.all_day,
		recurrence_rule: r.recurrence_rule ? JSON.parse(r.recurrence_rule) : null,
	};
}

function serializeRule(rule: RecurrenceRule | null | undefined): string | null {
	if (!rule) return null;
	const clean: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(rule)) {
		if (v == null) continue;
		if (Array.isArray(v) && v.length === 0) continue;
		if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
		clean[k] = v;
	}
	return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
}

// ── CRUD ────────────────────────────────────────────────────────

export async function getEvents(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]> {
	const { rows } = await query(
		`SELECT * FROM calendar_events
		 WHERE (start_time < ? AND end_time > ?)
		    OR (recurrence IS NOT NULL AND start_time < ?
		        AND (recurrence_end IS NULL OR recurrence_end >= ?))
		 ORDER BY start_time ASC`,
		[rangeEnd, rangeStart, rangeEnd, rangeStart],
	);
	return rows.map(mapRow);
}

export async function getEvent(id: number): Promise<CalendarEvent | undefined> {
	const { rows } = await query(
		"SELECT * FROM calendar_events WHERE id = ?",
		[id],
	);
	return rows.length > 0 ? mapRow(rows[0]) : undefined;
}

export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO calendar_events
		 (title, description, start_time, end_time, all_day, color,
		  recurrence, recurrence_rule, recurrence_end, reminder_minutes,
		  created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.title,
			input.description ?? null,
			input.start_time,
			input.end_time,
			input.all_day ? 1 : 0,
			input.color ?? null,
			input.recurrence ?? null,
			serializeRule(input.recurrence_rule),
			input.recurrence_end ?? null,
			input.reminder_minutes ?? null,
			ts,
			ts,
		],
	);
	return (await getEvent(Number(insertId)))!;
}

export async function updateEvent(id: number, updates: UpdateEventInput): Promise<CalendarEvent | undefined> {
	const existing = await getEvent(id);
	if (!existing) return undefined;

	await query(
		`UPDATE calendar_events SET
		 title = ?, description = ?, start_time = ?, end_time = ?,
		 all_day = ?, color = ?, recurrence = ?, recurrence_rule = ?,
		 recurrence_end = ?, reminder_minutes = ?, updated_at = ?
		 WHERE id = ?`,
		[
			updates.title ?? existing.title,
			updates.description !== undefined ? updates.description : existing.description,
			updates.start_time ?? existing.start_time,
			updates.end_time ?? existing.end_time,
			(updates.all_day ?? existing.all_day) ? 1 : 0,
			updates.color !== undefined ? updates.color : existing.color,
			updates.recurrence !== undefined ? updates.recurrence : existing.recurrence,
			updates.recurrence_rule !== undefined
				? serializeRule(updates.recurrence_rule)
				: serializeRule(existing.recurrence_rule),
			updates.recurrence_end !== undefined ? updates.recurrence_end : existing.recurrence_end,
			updates.reminder_minutes !== undefined ? updates.reminder_minutes : existing.reminder_minutes,
			now(),
			id,
		],
	);
	return getEvent(id);
}

export async function deleteEvent(id: number): Promise<boolean> {
	const { numAffectedRows } = await query(
		"DELETE FROM calendar_events WHERE id = ?",
		[id],
	);
	return (numAffectedRows ?? 0) > 0;
}

// ── Reminder queries ────────────────────────────────────────────

export async function getEventsWithReminders(): Promise<CalendarEvent[]> {
	const { rows } = await query(
		`SELECT * FROM calendar_events
		 WHERE reminder_minutes IS NOT NULL AND reminder_minutes > 0
		 ORDER BY start_time ASC`,
	);
	return rows.map(mapRow);
}

export async function isReminderSent(eventId: number, eventTime: string): Promise<boolean> {
	const { rows } = await query(
		"SELECT 1 FROM calendar_reminders_sent WHERE event_id = ? AND event_time = ?",
		[eventId, eventTime],
	);
	return rows.length > 0;
}

export async function markReminderSent(eventId: number, eventTime: string): Promise<void> {
	const insertSql =
		driver === "postgres"
			? "INSERT INTO calendar_reminders_sent (event_id, event_time, sent_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING"
			: driver === "mysql"
				? "INSERT IGNORE INTO calendar_reminders_sent (event_id, event_time, sent_at) VALUES (?, ?, ?)"
				: "INSERT OR IGNORE INTO calendar_reminders_sent (event_id, event_time, sent_at) VALUES (?, ?, ?)";

	await query(insertSql, [eventId, eventTime, now()]).catch(() => {}); // ignore duplicate
}

export async function cleanOldReminders(before: string): Promise<void> {
	await query(
		"DELETE FROM calendar_reminders_sent WHERE sent_at < ?",
		[before],
	);
}
