/**
 * Calendar types.
 */

export interface CalendarEvent {
	id: number;
	title: string;
	description: string | null;
	start_time: string;
	end_time: string;
	all_day: boolean;
	color: string | null;
	recurrence: "daily" | "weekly" | "biweekly" | "monthly" | null;
	recurrence_end: string | null;
	reminder_minutes: number | null;
	created_at: string;
	updated_at: string;
}

export type Recurrence = CalendarEvent["recurrence"];

export interface CreateEventInput {
	title: string;
	description?: string | null;
	start_time: string;
	end_time: string;
	all_day?: boolean;
	color?: string | null;
	recurrence?: Recurrence;
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
	recurrence_end?: string | null;
	reminder_minutes?: number | null;
}
