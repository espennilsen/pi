/**
 * Calendar tool for the LLM.
 *
 * Actions: list, create, update, delete, today, upcoming
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { getStore } from "./store.ts";
import type { CalendarEvent, RecurrenceRule } from "./types.ts";
import { expandOccurrences } from "./recurrence.ts";

const ACTIONS = [
	"list",
	"create",
	"update",
	"delete",
	"today",
	"upcoming",
] as const;

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

export function registerCalendarTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "calendar",
		label: "Calendar",
		description:
			"Manage calendar events. " +
			"Actions: list (events in date range), create, update, delete, " +
			"today (today's events), upcoming (next 7 days). " +
			"Supports recurrence (daily/weekly/biweekly/monthly/yearly) with advanced options via recurrence_rule JSON: " +
			"custom intervals, specific days of week, monthly by day-of-month or week position (e.g. '2nd Tuesday'), " +
			"yearly patterns, end conditions (never/count/date), exclusion dates, and per-occurrence overrides.",
		parameters: Type.Object({
			action: StringEnum(ACTIONS, {
				description: "Operation to perform",
			}),
			id: Type.Optional(
				Type.Number({ description: "Event ID (for update/delete)" }),
			),
			title: Type.Optional(Type.String({ description: "Event title" })),
			description: Type.Optional(
				Type.String({ description: "Event description" }),
			),
			start_time: Type.Optional(
				Type.String({ description: "Start time (ISO 8601)" }),
			),
			end_time: Type.Optional(
				Type.String({ description: "End time (ISO 8601)" }),
			),
			all_day: Type.Optional(
				Type.Boolean({ description: "All-day event" }),
			),
			color: Type.Optional(
				Type.String({ description: "Color hex (e.g. #7c6ff0)" }),
			),
			recurrence: Type.Optional(
				Type.String({
					description:
						"Frequency: daily, weekly, biweekly, monthly, yearly",
				}),
			),
			recurrence_rule: Type.Optional(
				Type.String({
					description:
						'JSON string with advanced recurrence options. Fields: ' +
						'interval (number, repeat every N periods), ' +
						'daysOfWeek (number[], 0=Sun..6=Sat for weekly), ' +
						'byType ("dayOfMonth"|"weekPosition" for monthly/yearly), ' +
						'dayOfMonth (number 1-31), ' +
						'weekPositions (number[], 1-4 or -1=last), ' +
						'weekday (number 0-6 for weekPosition mode), ' +
						'month (number 1-12 for yearly), ' +
						'endType ("never"|"count"|"date"), ' +
						'count (number, for endType=count), ' +
						'endDate (YYYY-MM-DD, for endType=date), ' +
						'exclusions (string[], YYYY-MM-DD dates to skip), ' +
						'overrides (object, key=YYYY-MM-DD, value={start_time?,end_time?,title?,description?}). ' +
						'Example: {"interval":2,"daysOfWeek":[1,3,5]} = every 2 weeks on Mon/Wed/Fri. ' +
						'Example: {"byType":"weekPosition","weekPositions":[2],"weekday":2} = 2nd Tuesday monthly. ' +
						'Example: {"endType":"count","count":10} = stop after 10 occurrences.',
				}),
			),
			recurrence_end: Type.Optional(
				Type.String({
					description: "Recurrence end date (YYYY-MM-DD)",
				}),
			),
			reminder_minutes: Type.Optional(
				Type.Number({
					description:
						"Reminder minutes before event (e.g. 15, 30, 60)",
				}),
			),
			range_start: Type.Optional(
				Type.String({
					description: "Range start (ISO 8601, for list)",
				}),
			),
			range_end: Type.Optional(
				Type.String({ description: "Range end (ISO 8601, for list)" }),
			),
			days: Type.Optional(
				Type.Number({
					description: "Days ahead (for upcoming, default: 7)",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal) {
			const store = getStore();

			switch (params.action) {
				case "list": {
					const rangeStart =
						params.range_start ?? new Date().toISOString();
					const rangeEnd =
						params.range_end ??
						new Date(Date.now() + 7 * 86_400_000).toISOString();
					const events = await store.getEvents(rangeStart, rangeEnd);
					const expanded = expandEventsForRange(
						events,
						rangeStart,
						rangeEnd,
					);
					if (expanded.length === 0)
						return text("No events in the specified range.");
					const lines = expanded.map(formatExpandedEvent);
					return text(
						`**Events (${expanded.length}):**\n\n${lines.join("\n\n")}`,
					);
				}

				case "today": {
					const now = new Date();
					const start = new Date(
						now.getFullYear(),
						now.getMonth(),
						now.getDate(),
					).toISOString();
					const end = new Date(
						now.getFullYear(),
						now.getMonth(),
						now.getDate() + 1,
					).toISOString();
					const events = await store.getEvents(start, end);
					const expanded = expandEventsForRange(events, start, end);
					if (expanded.length === 0)
						return text("No events today.");
					const lines = expanded.map(formatExpandedEvent);
					return text(
						`**Today's Events (${expanded.length}):**\n\n${lines.join("\n\n")}`,
					);
				}

				case "upcoming": {
					const days = params.days ?? 7;
					const start = new Date().toISOString();
					const end = new Date(
						Date.now() + days * 86_400_000,
					).toISOString();
					const events = await store.getEvents(start, end);
					const expanded = expandEventsForRange(events, start, end);
					if (expanded.length === 0)
						return text(
							`No events in the next ${days} days.`,
						);
					const lines = expanded.map(formatExpandedEvent);
					return text(
						`**Upcoming Events — next ${days} days (${expanded.length}):**\n\n${lines.join("\n\n")}`,
					);
				}

				case "create": {
					if (!params.title)
						return text("Missing required field: title");
					if (!params.start_time)
						return text("Missing required field: start_time");
					if (!params.end_time)
						return text("Missing required field: end_time");

					const rule = parseRuleParam(params.recurrence_rule);

					const event = await store.createEvent({
						title: params.title,
						description: params.description ?? null,
						start_time: params.start_time,
						end_time: params.end_time,
						all_day: params.all_day ?? false,
						color: params.color ?? null,
						recurrence: (params.recurrence as any) ?? null,
						recurrence_rule: rule,
						recurrence_end: params.recurrence_end ?? null,
						reminder_minutes: params.reminder_minutes ?? null,
					});
					return text(`✓ Created event: ${formatEvent(event)}`);
				}

				case "update": {
					if (!params.id)
						return text("Missing required field: id");

					const rule =
						params.recurrence_rule !== undefined
							? parseRuleParam(params.recurrence_rule)
							: undefined;

					const event = await store.updateEvent(params.id, {
						title: params.title,
						description: params.description,
						start_time: params.start_time,
						end_time: params.end_time,
						all_day: params.all_day,
						color: params.color,
						recurrence: params.recurrence as any,
						recurrence_rule: rule,
						recurrence_end: params.recurrence_end,
						reminder_minutes: params.reminder_minutes,
					});
					if (!event)
						return text(`Event not found: ${params.id}`);
					return text(`✓ Updated event: ${formatEvent(event)}`);
				}

				case "delete": {
					if (!params.id)
						return text("Missing required field: id");
					const ok = await store.deleteEvent(params.id);
					return text(
						ok
							? `✓ Deleted event ${params.id}`
							: `Event not found: ${params.id}`,
					);
				}

				default:
					return text(
						`Unknown action: ${(params as any).action}`,
					);
			}
		},
	});
}

// ── Helpers ─────────────────────────────────────────────────────

function parseRuleParam(
	raw: string | undefined,
): RecurrenceRule | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

interface ExpandedOccurrence {
	event: CalendarEvent;
	start: Date;
	end: Date;
	title: string;
	description: string | null;
	isVirtual: boolean;
}

function expandEventsForRange(
	events: CalendarEvent[],
	rangeStart: string,
	rangeEnd: string,
): ExpandedOccurrence[] {
	const windowStart = new Date(rangeStart);
	const windowEnd = new Date(rangeEnd);
	const results: ExpandedOccurrence[] = [];

	for (const event of events) {
		const evtStart = new Date(event.start_time);
		const evtEnd = new Date(event.end_time);
		const durationMs = evtEnd.getTime() - evtStart.getTime();

		if (!event.recurrence) {
			// Non-recurring — already in range per SQL query
			results.push({
				event,
				start: evtStart,
				end: evtEnd,
				title: event.title,
				description: event.description,
				isVirtual: false,
			});
			continue;
		}

		const occurrences = expandOccurrences(event, windowStart, windowEnd);
		const rule = event.recurrence_rule;

		for (const occStart of occurrences) {
			const dateKey = toDateKey(occStart);
			const override = rule?.overrides?.[dateKey];
			results.push({
				event,
				start: override?.start_time
					? new Date(override.start_time)
					: occStart,
				end: override?.end_time
					? new Date(override.end_time)
					: new Date(occStart.getTime() + durationMs),
				title: override?.title ?? event.title,
				description: override?.description ?? event.description,
				isVirtual: occStart.getTime() !== evtStart.getTime(),
			});
		}
	}

	results.sort((a, b) => a.start.getTime() - b.start.getTime());
	return results;
}

function toDateKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Formatting ──────────────────────────────────────────────────

function formatExpandedEvent(occ: ExpandedOccurrence): string {
	const e = occ.event;
	let line = `**${occ.title}** (id: ${e.id})`;

	if (e.all_day) {
		line += `\n  📅 All day: ${occ.start.toLocaleDateString("en-GB")}`;
		if (occ.start.toDateString() !== occ.end.toDateString()) {
			line += ` — ${occ.end.toLocaleDateString("en-GB")}`;
		}
	} else {
		const dateStr = occ.start.toLocaleDateString("en-GB", {
			weekday: "short",
			day: "numeric",
			month: "short",
		});
		const timeStr = `${occ.start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${occ.end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
		line += `\n  📅 ${dateStr} ${timeStr}`;
	}

	if (e.recurrence) {
		line += `\n  🔁 ${formatRecurrence(e)}`;
	}
	if (e.reminder_minutes) line += `\n  🔔 ${e.reminder_minutes}min before`;
	if (occ.description) line += `\n  📝 ${occ.description}`;

	return line;
}

function formatEvent(e: CalendarEvent): string {
	const start = new Date(e.start_time);
	const end = new Date(e.end_time);

	let line = `**${e.title}** (id: ${e.id})`;

	if (e.all_day) {
		line += `\n  📅 All day: ${start.toLocaleDateString("en-GB")}`;
		if (start.toDateString() !== end.toDateString()) {
			line += ` — ${end.toLocaleDateString("en-GB")}`;
		}
	} else {
		const dateStr = start.toLocaleDateString("en-GB", {
			weekday: "short",
			day: "numeric",
			month: "short",
		});
		const timeStr = `${start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
		line += `\n  📅 ${dateStr} ${timeStr}`;
	}

	if (e.recurrence) {
		line += `\n  🔁 ${formatRecurrence(e)}`;
	}
	if (e.reminder_minutes) line += `\n  🔔 ${e.reminder_minutes}min before`;
	if (e.description) line += `\n  📝 ${e.description}`;

	return line;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const POSITION_NAMES: Record<number, string> = {
	1: "1st",
	2: "2nd",
	3: "3rd",
	4: "4th",
	[-1]: "last",
};

function formatRecurrence(e: CalendarEvent): string {
	const rule = e.recurrence_rule;
	const interval = rule?.interval ?? (e.recurrence === "biweekly" ? 2 : 1);
	let desc = "";

	switch (e.recurrence) {
		case "daily":
			desc = interval === 1 ? "Daily" : `Every ${interval} days`;
			break;
		case "weekly":
		case "biweekly": {
			const days = rule?.daysOfWeek;
			const int =
				e.recurrence === "biweekly" && !rule?.interval ? 2 : interval;
			desc = int === 1 ? "Weekly" : `Every ${int} weeks`;
			if (days && days.length > 0) {
				desc += ` on ${days.map((d) => DAY_NAMES[d]).join(", ")}`;
			}
			break;
		}
		case "monthly": {
			desc = interval === 1 ? "Monthly" : `Every ${interval} months`;
			if (rule?.byType === "weekPosition") {
				const positions = rule.weekPositions ?? [];
				const weekday = rule.weekday ?? new Date(e.start_time).getDay();
				const posStr = positions
					.map((p) => POSITION_NAMES[p] ?? `${p}th`)
					.join(" & ");
				desc += ` on the ${posStr} ${DAY_NAMES[weekday]}`;
			} else if (rule?.dayOfMonth) {
				desc += ` on day ${rule.dayOfMonth}`;
			}
			break;
		}
		case "yearly": {
			desc = interval === 1 ? "Yearly" : `Every ${interval} years`;
			const month =
				rule?.month != null
					? MONTH_NAMES[rule.month - 1]
					: MONTH_NAMES[new Date(e.start_time).getMonth()];
			if (rule?.byType === "weekPosition") {
				const positions = rule.weekPositions ?? [];
				const weekday = rule.weekday ?? new Date(e.start_time).getDay();
				const posStr = positions
					.map((p) => POSITION_NAMES[p] ?? `${p}th`)
					.join(" & ");
				desc += ` on the ${posStr} ${DAY_NAMES[weekday]} of ${month}`;
			} else {
				const day = rule?.dayOfMonth ?? new Date(e.start_time).getDate();
				desc += ` on ${month} ${day}`;
			}
			break;
		}
		default:
			desc = e.recurrence ?? "Unknown";
	}

	// End condition
	if (rule?.endType === "count" && rule.count) {
		desc += ` (${rule.count} times)`;
	} else if (rule?.endType === "date" && rule.endDate) {
		desc += ` until ${rule.endDate}`;
	} else if (e.recurrence_end) {
		desc += ` until ${e.recurrence_end}`;
	}

	// Exclusions
	if (rule?.exclusions && rule.exclusions.length > 0) {
		desc += ` (${rule.exclusions.length} excluded)`;
	}

	return desc;
}
