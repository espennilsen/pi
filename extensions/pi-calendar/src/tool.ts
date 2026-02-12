/**
 * Calendar tool for the LLM.
 *
 * Actions: list, create, update, delete, today, upcoming
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import * as db from "./db.ts";
import type { CalendarEvent } from "./types.ts";

const ACTIONS = ["list", "create", "update", "delete", "today", "upcoming"] as const;

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
			"Supports recurrence (daily/weekly/biweekly/monthly) and reminders.",
		parameters: Type.Object({
			action: StringEnum(ACTIONS, { description: "Operation to perform" }),
			id: Type.Optional(Type.Number({ description: "Event ID (for update/delete)" })),
			title: Type.Optional(Type.String({ description: "Event title" })),
			description: Type.Optional(Type.String({ description: "Event description" })),
			start_time: Type.Optional(Type.String({ description: "Start time (ISO 8601)" })),
			end_time: Type.Optional(Type.String({ description: "End time (ISO 8601)" })),
			all_day: Type.Optional(Type.Boolean({ description: "All-day event" })),
			color: Type.Optional(Type.String({ description: "Color hex (e.g. #7c6ff0)" })),
			recurrence: Type.Optional(Type.String({ description: "Recurrence: daily, weekly, biweekly, monthly" })),
			recurrence_end: Type.Optional(Type.String({ description: "Recurrence end date (YYYY-MM-DD)" })),
			reminder_minutes: Type.Optional(Type.Number({ description: "Reminder minutes before event (e.g. 15, 30, 60)" })),
			range_start: Type.Optional(Type.String({ description: "Range start (ISO 8601, for list)" })),
			range_end: Type.Optional(Type.String({ description: "Range end (ISO 8601, for list)" })),
			days: Type.Optional(Type.Number({ description: "Days ahead (for upcoming, default: 7)" })),
		}),

		async execute(_toolCallId, params, _signal) {
			switch (params.action) {
				case "list": {
					const rangeStart = params.range_start ?? new Date().toISOString();
					const rangeEnd = params.range_end ?? new Date(Date.now() + 7 * 86_400_000).toISOString();
					const events = db.getEvents(rangeStart, rangeEnd);
					if (events.length === 0) return text("No events in the specified range.");
					const lines = events.map(formatEvent);
					return text(`**Events (${events.length}):**\n\n${lines.join("\n\n")}`);
				}

				case "today": {
					const now = new Date();
					const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
					const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
					const events = db.getEvents(start, end);
					if (events.length === 0) return text("No events today.");
					const lines = events.map(formatEvent);
					return text(`**Today's Events (${events.length}):**\n\n${lines.join("\n\n")}`);
				}

				case "upcoming": {
					const days = params.days ?? 7;
					const start = new Date().toISOString();
					const end = new Date(Date.now() + days * 86_400_000).toISOString();
					const events = db.getEvents(start, end);
					if (events.length === 0) return text(`No events in the next ${days} days.`);
					const lines = events.map(formatEvent);
					return text(`**Upcoming Events — next ${days} days (${events.length}):**\n\n${lines.join("\n\n")}`);
				}

				case "create": {
					if (!params.title) return text("Missing required field: title");
					if (!params.start_time) return text("Missing required field: start_time");
					if (!params.end_time) return text("Missing required field: end_time");

					const event = db.createEvent({
						title: params.title,
						description: params.description ?? null,
						start_time: params.start_time,
						end_time: params.end_time,
						all_day: params.all_day ?? false,
						color: params.color ?? null,
						recurrence: (params.recurrence as any) ?? null,
						recurrence_end: params.recurrence_end ?? null,
						reminder_minutes: params.reminder_minutes ?? null,
					});
					return text(`✓ Created event: ${formatEvent(event)}`);
				}

				case "update": {
					if (!params.id) return text("Missing required field: id");
					const event = db.updateEvent(params.id, {
						title: params.title,
						description: params.description,
						start_time: params.start_time,
						end_time: params.end_time,
						all_day: params.all_day,
						color: params.color,
						recurrence: (params.recurrence as any),
						recurrence_end: params.recurrence_end,
						reminder_minutes: params.reminder_minutes,
					});
					if (!event) return text(`Event not found: ${params.id}`);
					return text(`✓ Updated event: ${formatEvent(event)}`);
				}

				case "delete": {
					if (!params.id) return text("Missing required field: id");
					const ok = db.deleteEvent(params.id);
					return text(ok ? `✓ Deleted event ${params.id}` : `Event not found: ${params.id}`);
				}

				default:
					return text(`Unknown action: ${(params as any).action}`);
			}
		},
	});
}

// ── Formatting ──────────────────────────────────────────────────

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
		const dateStr = start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
		const timeStr = `${start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
		line += `\n  📅 ${dateStr} ${timeStr}`;
	}

	if (e.recurrence) {
		line += `\n  🔁 ${e.recurrence}`;
		if (e.recurrence_end) line += ` until ${e.recurrence_end}`;
	}
	if (e.reminder_minutes) line += `\n  🔔 ${e.reminder_minutes}min before`;
	if (e.description) line += `\n  📝 ${e.description}`;

	return line;
}


