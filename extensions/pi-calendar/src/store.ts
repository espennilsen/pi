/**
 * Calendar store — unified async interface over multiple backends.
 *
 * Two backends:
 *   1. "sqlite" (default) — local better-sqlite3 via db.ts
 *   2. "kysely" — shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Consumers import `getStore()` and get back the same async API
 * regardless of which backend is active.
 *
 * Backend selection is driven by `pi-calendar.useKysely` in settings.json.
 * The sqlite backend wraps synchronous calls in resolved promises.
 * The kysely backend is natively async.
 *
 * Lazy imports: better-sqlite3 is only loaded when the sqlite backend
 * is selected, so pi-calendar can run without it when using kysely.
 */

import type { CalendarEvent, CreateEventInput, UpdateEventInput } from "./types.ts";

// ── Store interface ─────────────────────────────────────────────

export interface CalendarStore {
	getEvents(rangeStart: string, rangeEnd: string): Promise<CalendarEvent[]>;
	getEvent(id: number): Promise<CalendarEvent | undefined>;
	createEvent(input: CreateEventInput): Promise<CalendarEvent>;
	updateEvent(id: number, updates: UpdateEventInput): Promise<CalendarEvent | undefined>;
	deleteEvent(id: number): Promise<boolean>;
	getEventsWithReminders(): Promise<CalendarEvent[]>;
	isReminderSent(eventId: number, eventTime: string): Promise<boolean>;
	markReminderSent(eventId: number, eventTime: string): Promise<void>;
	cleanOldReminders(before: string): Promise<void>;
}

// ── Singleton ───────────────────────────────────────────────────

let activeStore: CalendarStore | null = null;

export function setStore(store: CalendarStore): void {
	activeStore = store;
}

export function isStoreReady(): boolean {
	return activeStore !== null;
}

export function getStore(): CalendarStore {
	if (!activeStore) throw new Error("Calendar store not initialized");
	return activeStore;
}

// ── SQLite backend (better-sqlite3, synchronous) ────────────────

/**
 * Create a store backed by the local SQLite file via better-sqlite3.
 * Uses a dynamic import so better-sqlite3 isn't loaded when using kysely.
 */
export async function createSqliteStore(dbPath: string): Promise<CalendarStore> {
	const db = await import("./db.ts");
	db.initDb(dbPath);

	return {
		getEvents: (a, b) => Promise.resolve(db.getEvents(a, b)),
		getEvent: (id) => Promise.resolve(db.getEvent(id)),
		createEvent: (input) => Promise.resolve(db.createEvent(input)),
		updateEvent: (id, updates) => Promise.resolve(db.updateEvent(id, updates)),
		deleteEvent: (id) => Promise.resolve(db.deleteEvent(id)),
		getEventsWithReminders: () => Promise.resolve(db.getEventsWithReminders()),
		isReminderSent: (a, b) => Promise.resolve(db.isReminderSent(a, b)),
		markReminderSent: (a, b) => {
			db.markReminderSent(a, b);
			return Promise.resolve();
		},
		cleanOldReminders: (before) => {
			db.cleanOldReminders(before);
			return Promise.resolve();
		},
	};
}

// ── Kysely backend (pi-kysely event bus, async) ─────────────────

interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

/**
 * Create a store backed by pi-kysely's shared database.
 * Waits for kysely:ready if it hasn't fired yet, then registers the schema.
 */
export async function createKyselyStore(eventBus: EventBus): Promise<CalendarStore> {
	const db = await import("./db-kysely.ts");
	await db.initDb(eventBus);

	return {
		getEvents: db.getEvents,
		getEvent: db.getEvent,
		createEvent: db.createEvent,
		updateEvent: db.updateEvent,
		deleteEvent: db.deleteEvent,
		getEventsWithReminders: db.getEventsWithReminders,
		isReminderSent: db.isReminderSent,
		markReminderSent: db.markReminderSent,
		cleanOldReminders: db.cleanOldReminders,
	};
}
