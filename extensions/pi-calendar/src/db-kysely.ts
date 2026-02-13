/**
 * pi-calendar — Database layer via pi-kysely event bus.
 *
 * EXAMPLE: Shows how pi-calendar would use pi-kysely instead of
 * managing its own SQLite connection. No direct imports from pi-kysely,
 * no raw SQL — all communication via events.
 *
 * To switch: replace `import { ... } from "./db.ts"` with `import { ... } from "./db-kysely.ts"`
 * in tool.ts, reminders.ts, and web.ts.
 *
 * Requires pi-kysely extension to be loaded.
 */

import type { EventBus } from "@mariozechner/pi-coding-agent";
import type { CalendarEvent, CreateEventInput, RecurrenceRule, UpdateEventInput } from "./types.ts";

const ACTOR = "pi-calendar";

let events: EventBus;

// ── Schema declaration ──────────────────────────────────────────

const SCHEMA = {
	actor: ACTOR,
	tables: {
		calendar_events: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				title: { type: "text" as const, notNull: true },
				description: { type: "text" as const },
				start_time: { type: "text" as const, notNull: true },
				end_time: { type: "text" as const, notNull: true },
				all_day: { type: "integer" as const, notNull: true, default: 0 },
				color: { type: "text" as const },
				recurrence: { type: "text" as const },
				recurrence_rule: { type: "text" as const },
				recurrence_end: { type: "text" as const },
				reminder_minutes: { type: "integer" as const },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["start_time"], name: "idx_cal_events_start" },
				{ columns: ["end_time"], name: "idx_cal_events_end" },
			],
		},
		calendar_reminders_sent: {
			columns: {
				id: { type: "integer" as const, primaryKey: true, autoIncrement: true },
				event_id: { type: "integer" as const, notNull: true },
				event_time: { type: "text" as const, notNull: true },
				sent_at: { type: "text" as const, notNull: true },
			},
			unique: [["event_id", "event_time"]],
			indexes: [
				{ columns: ["event_id", "event_time"], name: "idx_cal_reminders_event" },
			],
		},
	},
};

// ── Init ────────────────────────────────────────────────────────

/**
 * Register calendar schema with pi-kysely.
 * Call this in session_start after kysely:ready fires.
 */
export function initDb(eventBus: EventBus): Promise<void> {
	events = eventBus;

	return new Promise((resolve, reject) => {
		events.emit("kysely:schema:register", {
			...SCHEMA,
			reply: (result: { ok: boolean; errors: string[] }) => {
				if (result.ok) resolve();
				else reject(new Error(`Schema registration failed: ${result.errors.join("; ")}`));
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

/** Promise wrapper for kysely:table:select */
function dbSelect(input: Record<string, unknown>): Promise<any[]> {
	return new Promise((resolve, reject) => {
		events.emit("kysely:table:select", {
			actor: ACTOR,
			input,
			reply: (rows: any[]) => resolve(rows),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});
}

/** Promise wrapper for kysely:table:insert */
function dbInsert(input: Record<string, unknown>): Promise<any> {
	return new Promise((resolve, reject) => {
		events.emit("kysely:table:insert", {
			actor: ACTOR,
			input,
			reply: (result: any) => resolve(result),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});
}

/** Promise wrapper for kysely:table:update */
function dbUpdate(input: Record<string, unknown>): Promise<any> {
	return new Promise((resolve, reject) => {
		events.emit("kysely:table:update", {
			actor: ACTOR,
			input,
			reply: (result: any) => resolve(result),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});
}

/** Promise wrapper for kysely:table:delete */
function dbDelete(input: Record<string, unknown>): Promise<any> {
	return new Promise((resolve, reject) => {
		events.emit("kysely:table:delete", {
			actor: ACTOR,
			input,
			reply: (result: any) => resolve(result),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});
}

// ── CRUD ────────────────────────────────────────────────────────

export async function getEvents(
	rangeStart: string,
	rangeEnd: string,
): Promise<CalendarEvent[]> {
	// Equivalent to:
	//   WHERE (start_time < rangeEnd AND end_time > rangeStart)
	//      OR (recurrence IS NOT NULL AND start_time < rangeEnd
	//          AND (recurrence_end IS NULL OR recurrence_end >= rangeStart))
	const rows = await dbSelect({
		table: "calendar_events",
		where: {
			or: [
				{
					and: [
						{ col: "start_time", op: "<", val: rangeEnd },
						{ col: "end_time", op: ">", val: rangeStart },
					],
				},
				{
					and: [
						{ col: "recurrence", op: "is not null" },
						{ col: "start_time", op: "<", val: rangeEnd },
						{
							or: [
								{ col: "recurrence_end", op: "is null" },
								{ col: "recurrence_end", op: ">=", val: rangeStart },
							],
						},
					],
				},
			],
		},
		orderBy: { column: "start_time", direction: "asc" },
	});

	return rows.map(mapRow);
}

export async function getEvent(id: number): Promise<CalendarEvent | undefined> {
	const rows = await dbSelect({
		table: "calendar_events",
		where: { id },
		limit: 1,
	});
	return rows.length > 0 ? mapRow(rows[0]) : undefined;
}

export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
	const ts = now();
	await dbInsert({
		table: "calendar_events",
		values: {
			title: input.title,
			description: input.description ?? null,
			start_time: input.start_time,
			end_time: input.end_time,
			all_day: input.all_day ? 1 : 0,
			color: input.color ?? null,
			recurrence: input.recurrence ?? null,
			recurrence_rule: serializeRule(input.recurrence_rule),
			recurrence_end: input.recurrence_end ?? null,
			reminder_minutes: input.reminder_minutes ?? null,
			created_at: ts,
			updated_at: ts,
		},
	});

	// Get the last inserted row (sort by id desc, limit 1)
	const rows = await dbSelect({
		table: "calendar_events",
		orderBy: { column: "id", direction: "desc" },
		limit: 1,
	});
	return mapRow(rows[0]);
}

export async function updateEvent(
	id: number,
	updates: UpdateEventInput,
): Promise<CalendarEvent | undefined> {
	const existing = await getEvent(id);
	if (!existing) return undefined;

	const set: Record<string, unknown> = {
		title: updates.title ?? existing.title,
		description: updates.description !== undefined ? updates.description : existing.description,
		start_time: updates.start_time ?? existing.start_time,
		end_time: updates.end_time ?? existing.end_time,
		all_day: (updates.all_day ?? existing.all_day) ? 1 : 0,
		color: updates.color !== undefined ? updates.color : existing.color,
		recurrence: updates.recurrence !== undefined ? updates.recurrence : existing.recurrence,
		recurrence_rule: updates.recurrence_rule !== undefined
			? serializeRule(updates.recurrence_rule)
			: serializeRule(existing.recurrence_rule),
		recurrence_end: updates.recurrence_end !== undefined
			? updates.recurrence_end
			: existing.recurrence_end,
		reminder_minutes: updates.reminder_minutes !== undefined
			? updates.reminder_minutes
			: existing.reminder_minutes,
		updated_at: now(),
	};

	await dbUpdate({
		table: "calendar_events",
		set,
		where: { id },
	});

	return getEvent(id);
}

export async function deleteEvent(id: number): Promise<boolean> {
	const result = await dbDelete({
		table: "calendar_events",
		where: { id },
	});
	return (result as any)?.numAffectedRows > 0n || (result as any)?.changes > 0;
}

// ── Reminder queries ────────────────────────────────────────────

export async function getEventsWithReminders(): Promise<CalendarEvent[]> {
	const rows = await dbSelect({
		table: "calendar_events",
		where: {
			and: [
				{ col: "reminder_minutes", op: "is not null" },
				{ col: "reminder_minutes", op: ">", val: 0 },
			],
		},
		orderBy: { column: "start_time", direction: "asc" },
	});
	return rows.map(mapRow);
}

export async function isReminderSent(
	eventId: number,
	eventTime: string,
): Promise<boolean> {
	const rows = await dbSelect({
		table: "calendar_reminders_sent",
		where: { event_id: eventId, event_time: eventTime },
		limit: 1,
	});
	return rows.length > 0;
}

export async function markReminderSent(
	eventId: number,
	eventTime: string,
): Promise<void> {
	try {
		await dbInsert({
			table: "calendar_reminders_sent",
			values: {
				event_id: eventId,
				event_time: eventTime,
				sent_at: now(),
			},
		});
	} catch {
		// Ignore duplicate (unique constraint)
	}
}

export async function cleanOldReminders(before: string): Promise<void> {
	await dbDelete({
		table: "calendar_reminders_sent",
		where: { col: "sent_at", op: "<", val: before },
	});
}
