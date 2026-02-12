/**
 * Calendar reminders.
 *
 * Checks every 60s for upcoming events with reminders set.
 * Sends notifications via pi-channels event bus (no direct import).
 * Tracks sent reminders to avoid duplicates.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CalendarEvent, Recurrence } from "./types.ts";
import {
	getEventsWithReminders,
	isReminderSent,
	markReminderSent,
	cleanOldReminders,
} from "./db.ts";

// ── State ───────────────────────────────────────────────────────

let interval: ReturnType<typeof setInterval> | null = null;
let lastCleanup = 0;
let eventBus: { emit(event: string, data: unknown): void } | null = null;

// ── Public API ──────────────────────────────────────────────────

export function startReminders(pi: ExtensionAPI): void {
	eventBus = pi.events;
	interval = setInterval(() => tick(), 60_000);
	// Run once after a short delay to let channels register
	setTimeout(() => tick(), 5_000);
}

export function stopReminders(): void {
	if (interval) {
		clearInterval(interval);
		interval = null;
	}
	eventBus = null;
}

// ── Tick ────────────────────────────────────────────────────────

async function tick(): Promise<void> {
	try {
		const allEvents = getEventsWithReminders();
		if (allEvents.length === 0) return;

		const now = new Date();

		for (const event of allEvents) {
			const reminderMs = (event.reminder_minutes ?? 0) * 60_000;
			if (reminderMs <= 0) continue;

			const occurrences = getUpcomingOccurrences(event, now);

			for (const occStart of occurrences) {
				const triggerTime = new Date(occStart.getTime() - reminderMs);
				const eventTimeKey = occStart.toISOString();

				if (now >= triggerTime && now < occStart) {
					if (!isReminderSent(event.id, eventTimeKey)) {
						await sendReminder(event, occStart);
						markReminderSent(event.id, eventTimeKey);
					}
				}
			}
		}

		// Clean old reminders once per hour
		if (Date.now() - lastCleanup > 3_600_000) {
			const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
			cleanOldReminders(cutoff);
			lastCleanup = Date.now();
		}
	} catch {}
}

// ── Occurrence expansion ────────────────────────────────────────

function getUpcomingOccurrences(event: CalendarEvent, now: Date): Date[] {
	const eventStart = new Date(event.start_time);
	const checkEnd = new Date(now.getTime() + 24 * 3_600_000);
	const results: Date[] = [];

	if (!event.recurrence) {
		if (eventStart > now) results.push(eventStart);
		return results;
	}

	const step = stepDays(event.recurrence);
	const recEnd = event.recurrence_end ? new Date(event.recurrence_end + "T23:59:59Z") : null;
	const effectiveEnd = recEnd && recEnd < checkEnd ? recEnd : checkEnd;

	if (event.recurrence === "monthly") {
		const baseYear = eventStart.getUTCFullYear();
		const baseMonth = eventStart.getUTCMonth();
		const nowYear = now.getUTCFullYear();
		const nowMonth = now.getUTCMonth();
		const monthsElapsed = (nowYear - baseYear) * 12 + (nowMonth - baseMonth);
		for (let offset = monthsElapsed - 1; offset <= monthsElapsed + 2; offset++) {
			if (offset < 0) continue;
			const candidate = new Date(eventStart);
			candidate.setMonth(candidate.getMonth() + offset);
			if (candidate > now && candidate < effectiveEnd) {
				results.push(candidate);
			}
		}
	} else if (step > 0) {
		const stepMs = step * 86_400_000;
		const elapsed = now.getTime() - eventStart.getTime();
		let cur: Date;
		if (elapsed <= 0) {
			cur = new Date(eventStart);
		} else {
			const stepsNeeded = Math.ceil(elapsed / stepMs);
			cur = new Date(eventStart.getTime() + stepsNeeded * stepMs);
		}
		let count = 0;
		while (cur < effectiveEnd && count < 400) {
			results.push(new Date(cur));
			cur = new Date(cur.getTime() + stepMs);
			count++;
		}
	}

	return results;
}

function stepDays(recurrence: Recurrence): number {
	switch (recurrence) {
		case "daily": return 1;
		case "weekly": return 7;
		case "biweekly": return 14;
		default: return 0;
	}
}

// ── Send ────────────────────────────────────────────────────────

async function sendReminder(event: CalendarEvent, occStart: Date): Promise<void> {
	const timeStr = occStart.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	const dateStr = occStart.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
	const mins = event.reminder_minutes ?? 15;

	let message = `⏰ Reminder: **${event.title}**\n📅 ${dateStr} at ${timeStr}`;
	if (mins > 0) message += `\n🔔 Starting in ${mins} minute${mins !== 1 ? "s" : ""}`;
	if (event.description) message += `\n📝 ${event.description}`;

	// Send via pi-channels event bus (if available)
	if (eventBus) {
		eventBus.emit("channel:send", {
			route: "cron",
			text: message,
			source: "pi-calendar",
		});
	}
}
