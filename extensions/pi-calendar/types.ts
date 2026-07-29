/**
 * Calendar types.
 *
 * Recurrence system supports: daily, weekly, biweekly, monthly, yearly
 * with custom intervals, day/position selection, end conditions,
 * exclusions, and per-occurrence overrides.
 */

// ── Recurrence primitives ───────────────────────────────────────

/** Days of the week: 0=Sunday, 1=Monday, …, 6=Saturday */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Week position within a month: 1=first, 2=second, 3=third, 4=fourth, -1=last */
export type WeekPosition = 1 | 2 | 3 | 4 | -1;

/** Supported frequency types */
export type Recurrence = "daily" | "weekly" | "biweekly" | "monthly" | "yearly" | null;

// ── Recurrence rule ─────────────────────────────────────────────

export interface RecurrenceRule {
	/** Repeat every N periods (default: 1). E.g., interval=3 with daily = every 3 days */
	interval?: number;

	// ── Weekly options ────────────────────────────────────────────
	/** Which days of the week (0=Sun…6=Sat). Defaults to start_time's day. */
	daysOfWeek?: DayOfWeek[];

	// ── Monthly options ───────────────────────────────────────────
	/** How the recurring day is determined for monthly/yearly */
	byType?: "dayOfMonth" | "weekPosition";
	/** Day of month (1–31). Defaults to start_time's day. */
	dayOfMonth?: number;
	/** Which week positions to match (1,2,3,4 or -1=last). E.g., [1,3] = 1st & 3rd */
	weekPositions?: WeekPosition[];
	/** Which weekday for weekPosition mode (0=Sun…6=Sat). Defaults to start_time's weekday. */
	weekday?: DayOfWeek;

	// ── Yearly options ────────────────────────────────────────────
	/** Target month for yearly recurrence (1–12). Defaults to start_time's month. */
	month?: number;

	// ── End conditions ────────────────────────────────────────────
	/** End condition type. Default: 'never' */
	endType?: "never" | "count" | "date";
	/** End after N occurrences (endType='count') */
	count?: number;
	/** End on date YYYY-MM-DD (endType='date'). Overrides recurrence_end column. */
	endDate?: string;

	// ── Exclusions & overrides ────────────────────────────────────
	/** Specific dates to skip (YYYY-MM-DD) */
	exclusions?: string[];
	/** Override individual occurrences. Key = YYYY-MM-DD */
	overrides?: Record<
		string,
		{
			start_time?: string;
			end_time?: string;
			title?: string;
			description?: string;
		}
	>;
}

// ── Event interfaces ────────────────────────────────────────────

export interface CalendarEvent {
	id: number;
	title: string;
	description: string | null;
	start_time: string;
	end_time: string;
	all_day: boolean;
	color: string | null;
	recurrence: Recurrence;
	recurrence_rule: RecurrenceRule | null;
	recurrence_end: string | null;
	reminder_minutes: number | null;
	created_at: string;
	updated_at: string;
}

export interface CreateEventInput {
	title: string;
	description?: string | null;
	start_time: string;
	end_time: string;
	all_day?: boolean;
	color?: string | null;
	recurrence?: Recurrence;
	recurrence_rule?: RecurrenceRule | null;
	recurrence_end?: string | null;
	reminder_minutes?: number | null;
}

export interface UpdateEventInput {
	title?: string;
	description?: string | null;
	start_time?: string;
	end_time?: string;
	all_day?: boolean;
	color?: string | null;
	recurrence?: Recurrence;
	recurrence_rule?: RecurrenceRule | null;
	recurrence_end?: string | null;
	reminder_minutes?: number | null;
}
