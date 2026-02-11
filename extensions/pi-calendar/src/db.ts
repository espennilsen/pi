/**
 * Calendar database.
 *
 * Self-contained: owns migrations, prepared statements, and CRUD.
 * Stores data in ~/.pi/agent/db/calendar.db.
 */

import Database from "better-sqlite3";
import type { CalendarEvent, CreateEventInput, UpdateEventInput } from "./types.ts";

export type { CalendarEvent } from "./types.ts";

// ── State ───────────────────────────────────────────────────────

let db: InstanceType<typeof Database>;

let stmts: {
	getEvents: Database.Statement;
	getEvent: Database.Statement;
	insertEvent: Database.Statement;
	updateEvent: Database.Statement;
	deleteEvent: Database.Statement;
	getEventsWithReminders: Database.Statement;
	isReminderSent: Database.Statement;
	markReminderSent: Database.Statement;
	cleanOldReminders: Database.Statement;
};

// ── Migrations ──────────────────────────────────────────────────

const MIGRATIONS: string[] = [
	// 1: Core tables
	`CREATE TABLE IF NOT EXISTS calendar_events (
		id              INTEGER PRIMARY KEY AUTOINCREMENT,
		title           TEXT NOT NULL,
		description     TEXT,
		start_time      TEXT NOT NULL,
		end_time        TEXT NOT NULL,
		all_day         INTEGER NOT NULL DEFAULT 0,
		color           TEXT,
		recurrence      TEXT CHECK(recurrence IN (NULL, 'daily', 'weekly', 'biweekly', 'monthly')),
		recurrence_end  TEXT,
		reminder_minutes INTEGER,
		created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
		updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	);
	CREATE INDEX IF NOT EXISTS idx_cal_events_start ON calendar_events(start_time);
	CREATE INDEX IF NOT EXISTS idx_cal_events_end   ON calendar_events(end_time);`,

	// 2: Reminder dedup table
	`CREATE TABLE IF NOT EXISTS calendar_reminders_sent (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		event_id    INTEGER NOT NULL,
		event_time  TEXT NOT NULL,
		sent_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
		UNIQUE(event_id, event_time)
	);
	CREATE INDEX IF NOT EXISTS idx_cal_reminders_event ON calendar_reminders_sent(event_id, event_time);`,
];

// ── Init ────────────────────────────────────────────────────────

export function initDb(dbPath: string): void {
	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	// Migration tracking
	db.exec(`CREATE TABLE IF NOT EXISTS calendar_module_versions (
		module TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0
	)`);

	const row = db.prepare("SELECT version FROM calendar_module_versions WHERE module = ?").get("calendar") as { version: number } | undefined;
	const current = row?.version ?? 0;

	for (let i = current; i < MIGRATIONS.length; i++) {
		db.exec(MIGRATIONS[i]);
		db.prepare("INSERT OR REPLACE INTO calendar_module_versions (module, version) VALUES (?, ?)").run("calendar", i + 1);
	}

	// Prepared statements
	stmts = {
		getEvents: db.prepare(`
			SELECT * FROM calendar_events
			WHERE (start_time < ? AND end_time > ?)
				OR (recurrence IS NOT NULL AND start_time < ?
					AND (recurrence_end IS NULL OR recurrence_end >= ?))
			ORDER BY start_time ASC
		`),
		getEvent: db.prepare("SELECT * FROM calendar_events WHERE id = ?"),
		insertEvent: db.prepare(`
			INSERT INTO calendar_events
				(title, description, start_time, end_time, all_day, color, recurrence, recurrence_end, reminder_minutes)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`),
		updateEvent: db.prepare(`
			UPDATE calendar_events SET
				title = ?, description = ?, start_time = ?, end_time = ?,
				all_day = ?, color = ?, recurrence = ?, recurrence_end = ?, reminder_minutes = ?,
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			WHERE id = ?
		`),
		deleteEvent: db.prepare("DELETE FROM calendar_events WHERE id = ?"),
		getEventsWithReminders: db.prepare(`
			SELECT * FROM calendar_events
			WHERE reminder_minutes IS NOT NULL AND reminder_minutes > 0
			ORDER BY start_time ASC
		`),
		isReminderSent: db.prepare(
			"SELECT 1 FROM calendar_reminders_sent WHERE event_id = ? AND event_time = ?",
		),
		markReminderSent: db.prepare(
			"INSERT OR IGNORE INTO calendar_reminders_sent (event_id, event_time) VALUES (?, ?)",
		),
		cleanOldReminders: db.prepare(
			"DELETE FROM calendar_reminders_sent WHERE sent_at < ?",
		),
	};
}

// ── Helpers ─────────────────────────────────────────────────────

function mapRow(r: any): CalendarEvent {
	return { ...r, all_day: !!r.all_day } as CalendarEvent;
}

// ── CRUD ────────────────────────────────────────────────────────

export function getEvents(rangeStart: string, rangeEnd: string): CalendarEvent[] {
	return (stmts.getEvents.all(rangeEnd, rangeStart, rangeEnd, rangeStart) as any[]).map(mapRow);
}

export function getEvent(id: number): CalendarEvent | undefined {
	const r = stmts.getEvent.get(id) as any;
	return r ? mapRow(r) : undefined;
}

export function createEvent(input: CreateEventInput): CalendarEvent {
	const result = stmts.insertEvent.run(
		input.title,
		input.description ?? null,
		input.start_time,
		input.end_time,
		input.all_day ? 1 : 0,
		input.color ?? null,
		input.recurrence ?? null,
		input.recurrence_end ?? null,
		input.reminder_minutes ?? null,
	);
	return getEvent(Number(result.lastInsertRowid))!;
}

export function updateEvent(id: number, updates: UpdateEventInput): CalendarEvent | undefined {
	const existing = getEvent(id);
	if (!existing) return undefined;
	stmts.updateEvent.run(
		updates.title ?? existing.title,
		updates.description !== undefined ? updates.description : existing.description,
		updates.start_time ?? existing.start_time,
		updates.end_time ?? existing.end_time,
		(updates.all_day ?? existing.all_day) ? 1 : 0,
		updates.color !== undefined ? updates.color : existing.color,
		updates.recurrence !== undefined ? updates.recurrence : existing.recurrence,
		updates.recurrence_end !== undefined ? updates.recurrence_end : existing.recurrence_end,
		updates.reminder_minutes !== undefined ? updates.reminder_minutes : existing.reminder_minutes,
		id,
	);
	return getEvent(id)!;
}

export function deleteEvent(id: number): boolean {
	return stmts.deleteEvent.run(id).changes > 0;
}

// ── Reminder queries ────────────────────────────────────────────

export function getEventsWithReminders(): CalendarEvent[] {
	return (stmts.getEventsWithReminders.all() as any[]).map(mapRow);
}

export function isReminderSent(eventId: number, eventTime: string): boolean {
	return !!stmts.isReminderSent.get(eventId, eventTime);
}

export function markReminderSent(eventId: number, eventTime: string): void {
	stmts.markReminderSent.run(eventId, eventTime);
}

export function cleanOldReminders(before: string): void {
	stmts.cleanOldReminders.run(before);
}
