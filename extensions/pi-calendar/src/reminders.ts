/**
 * Calendar reminders.
 *
 * Checks every 60s for upcoming events with reminders set.
 * Sends notifications via pi-channels event bus (no direct import).
 * Tracks sent reminders to avoid duplicates.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CalendarEvent } from "./types.ts";
import { getStore } from "./store.ts";
import { expandOccurrences } from "./recurrence.ts";

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
		const store = getStore();
		const allEvents = await store.getEventsWithReminders();
		if (allEvents.length === 0) return;

		const now = new Date();
		const checkEnd = new Date(now.getTime() + 24 * 3_600_000);

		for (const event of allEvents) {
			const reminderMs = (event.reminder_minutes ?? 0) * 60_000;
			if (reminderMs <= 0) continue;

			// Expand occurrences in the next 24h window
			const occurrences = expandOccurrences(event, now, checkEnd);

			for (const occStart of occurrences) {
				// Apply override time if present
				const rule = event.recurrence_rule;
				const dateKey = toDateKey(occStart);
				const override = rule?.overrides?.[dateKey];
				const actualStart = override?.start_time
					? new Date(override.start_time)
					: occStart;

				const triggerTime = new Date(actualStart.getTime() - reminderMs);
				const eventTimeKey = actualStart.toISOString();

				if (now >= triggerTime && now < actualStart) {
					if (!(await store.isReminderSent(event.id, eventTimeKey))) {
						await sendReminder(event, actualStart, override);
						await store.markReminderSent(event.id, eventTimeKey);
					}
				}
			}
		}

		// Clean old reminders once per hour
		if (Date.now() - lastCleanup > 3_600_000) {
			const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
			await store.cleanOldReminders(cutoff);
			lastCleanup = Date.now();
		}
	} catch {}
}

// ── Send ────────────────────────────────────────────────────────

async function sendReminder(
	event: CalendarEvent,
	occStart: Date,
	override?: { title?: string; description?: string },
): Promise<void> {
	const timeStr = occStart.toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
	});
	const dateStr = occStart.toLocaleDateString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
	const mins = event.reminder_minutes ?? 15;
	const title = override?.title ?? event.title;
	const desc = override?.description ?? event.description;

	let message = `⏰ Reminder: **${title}**\n📅 ${dateStr} at ${timeStr}`;
	if (mins > 0)
		message += `\n🔔 Starting in ${mins} minute${mins !== 1 ? "s" : ""}`;
	if (desc) message += `\n📝 ${desc}`;

	// Send via pi-channels event bus (if available)
	if (eventBus) {
		eventBus.emit("channel:send", {
			route: "cron",
			text: message,
			source: "pi-calendar",
		});
	}
}

// ── Helpers ─────────────────────────────────────────────────────

function toDateKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
