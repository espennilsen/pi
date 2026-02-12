/**
 * Recurrence expansion engine.
 *
 * Generates concrete occurrence dates from a CalendarEvent's recurrence
 * pattern within a given time window.
 *
 * Used by both the reminder system and the LLM tool.
 */

import type { CalendarEvent, RecurrenceRule } from "./types.ts";

const MAX_ITERATIONS = 10_000;
const MS_PER_DAY = 86_400_000;

// ── Public API ──────────────────────────────────────────────────

/**
 * Expand a recurring event into concrete occurrence start dates
 * that fall within [windowStart, windowEnd).
 *
 * Handles all recurrence types, custom intervals, end conditions,
 * and exclusions. Returns dates sorted ascending.
 */
export function expandOccurrences(
	event: CalendarEvent,
	windowStart: Date,
	windowEnd: Date,
): Date[] {
	const eventStart = new Date(event.start_time);

	if (!event.recurrence) {
		return eventStart >= windowStart && eventStart < windowEnd ? [eventStart] : [];
	}

	const rule: RecurrenceRule = event.recurrence_rule ?? {};
	const interval = rule.interval ?? (event.recurrence === "biweekly" ? 2 : 1);
	const exclusionSet = new Set(rule.exclusions ?? []);

	// Effective end — earliest of window end, rule end date, and legacy recurrence_end
	let effectiveEnd = new Date(windowEnd);
	const ruleEnd =
		rule.endType === "date" && rule.endDate
			? new Date(rule.endDate + "T23:59:59")
			: event.recurrence_end
				? new Date(event.recurrence_end + "T23:59:59")
				: null;
	if (ruleEnd && ruleEnd < effectiveEnd) effectiveEnd = ruleEnd;

	const maxCount =
		rule.endType === "count" && rule.count != null ? rule.count : Infinity;

	const results: Date[] = [];
	let totalCount = 0;

	const collect = (d: Date): boolean => {
		if (d < eventStart) return true; // skip, keep going
		totalCount++;
		if (totalCount > maxCount) return false; // stop
		if (d >= effectiveEnd) return false; // stop
		if (d >= windowStart && !isExcluded(d, exclusionSet)) {
			results.push(new Date(d));
		}
		return true; // keep going
	};

	switch (event.recurrence) {
		case "daily":
			expandDaily(eventStart, interval, effectiveEnd, collect);
			break;
		case "weekly":
		case "biweekly":
			expandWeekly(
				eventStart,
				event.recurrence === "biweekly" && rule.interval == null ? 2 : interval,
				rule.daysOfWeek ?? [eventStart.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6],
				effectiveEnd,
				collect,
			);
			break;
		case "monthly":
			expandMonthly(eventStart, interval, rule, effectiveEnd, collect);
			break;
		case "yearly":
			expandYearly(eventStart, interval, rule, effectiveEnd, collect);
			break;
	}

	return results;
}

// ── Daily ───────────────────────────────────────────────────────

function expandDaily(
	eventStart: Date,
	interval: number,
	hardEnd: Date,
	collect: (d: Date) => boolean,
): void {
	const stepMs = interval * MS_PER_DAY;
	let cur = new Date(eventStart);
	let i = 0;

	while (cur < hardEnd && i++ < MAX_ITERATIONS) {
		if (!collect(cur)) break;
		cur = new Date(cur.getTime() + stepMs);
	}
}

// ── Weekly ──────────────────────────────────────────────────────

function expandWeekly(
	eventStart: Date,
	interval: number,
	daysOfWeek: number[],
	hardEnd: Date,
	collect: (d: Date) => boolean,
): void {
	const sortedDays = [...daysOfWeek].sort((a, b) => a - b);
	const baseMonday = getMondayOfWeek(eventStart);
	const msPerWeek = 7 * MS_PER_DAY;
	let weekNum = 0;
	let iterations = 0;

	while (iterations++ < MAX_ITERATIONS) {
		const weekMonday = new Date(baseMonday.getTime() + weekNum * msPerWeek);
		if (weekMonday.getTime() > hardEnd.getTime() + 7 * MS_PER_DAY) break;

		for (const dow of sortedDays) {
			const daysFromMonday = dow === 0 ? 6 : dow - 1;
			const d = new Date(weekMonday.getTime() + daysFromMonday * MS_PER_DAY);
			d.setHours(
				eventStart.getHours(),
				eventStart.getMinutes(),
				eventStart.getSeconds(),
				0,
			);
			if (d >= hardEnd) break;
			if (!collect(d)) return;
		}

		weekNum += interval;
	}
}

// ── Monthly ─────────────────────────────────────────────────────

function expandMonthly(
	eventStart: Date,
	interval: number,
	rule: RecurrenceRule,
	hardEnd: Date,
	collect: (d: Date) => boolean,
): void {
	const byType = rule.byType ?? "dayOfMonth";
	let monthOffset = 0;
	let iterations = 0;

	while (iterations++ < MAX_ITERATIONS) {
		const totalMonths = eventStart.getMonth() + monthOffset;
		const year =
			eventStart.getFullYear() + Math.floor(totalMonths / 12);
		const month = ((totalMonths % 12) + 12) % 12;

		if (new Date(year, month + 1, 0) < eventStart && monthOffset === 0) {
			monthOffset += interval;
			continue;
		}

		const candidates: Date[] = [];

		if (byType === "dayOfMonth") {
			const day = rule.dayOfMonth ?? eventStart.getDate();
			const daysInMonth = new Date(year, month + 1, 0).getDate();
			if (day <= daysInMonth) {
				candidates.push(
					new Date(
						year,
						month,
						day,
						eventStart.getHours(),
						eventStart.getMinutes(),
						eventStart.getSeconds(),
					),
				);
			}
		} else {
			const weekday = rule.weekday ?? eventStart.getDay();
			const positions = rule.weekPositions ?? [
				Math.ceil(eventStart.getDate() / 7) as 1 | 2 | 3 | 4,
			];
			for (const pos of positions) {
				const d = getNthWeekdayOfMonth(year, month, weekday, pos);
				if (d) {
					d.setHours(
						eventStart.getHours(),
						eventStart.getMinutes(),
						eventStart.getSeconds(),
					);
					candidates.push(d);
				}
			}
		}

		candidates.sort((a, b) => a.getTime() - b.getTime());
		for (const d of candidates) {
			if (d >= hardEnd) return;
			if (!collect(d)) return;
		}

		monthOffset += interval;
		if (new Date(year, month, 1) > hardEnd) break;
	}
}

// ── Yearly ──────────────────────────────────────────────────────

function expandYearly(
	eventStart: Date,
	interval: number,
	rule: RecurrenceRule,
	hardEnd: Date,
	collect: (d: Date) => boolean,
): void {
	const byType = rule.byType ?? "dayOfMonth";
	const targetMonth = rule.month != null ? rule.month - 1 : eventStart.getMonth();
	let yearOffset = 0;
	let iterations = 0;

	while (iterations++ < MAX_ITERATIONS) {
		const year = eventStart.getFullYear() + yearOffset;
		if (year > hardEnd.getFullYear() + 1) break;

		const candidates: Date[] = [];

		if (byType === "dayOfMonth") {
			const day = rule.dayOfMonth ?? eventStart.getDate();
			const daysInMonth = new Date(year, targetMonth + 1, 0).getDate();
			if (day <= daysInMonth) {
				candidates.push(
					new Date(
						year,
						targetMonth,
						day,
						eventStart.getHours(),
						eventStart.getMinutes(),
						eventStart.getSeconds(),
					),
				);
			}
		} else {
			const weekday = rule.weekday ?? eventStart.getDay();
			const positions = rule.weekPositions ?? [
				Math.ceil(eventStart.getDate() / 7) as 1 | 2 | 3 | 4,
			];
			for (const pos of positions) {
				const d = getNthWeekdayOfMonth(year, targetMonth, weekday, pos);
				if (d) {
					d.setHours(
						eventStart.getHours(),
						eventStart.getMinutes(),
						eventStart.getSeconds(),
					);
					candidates.push(d);
				}
			}
		}

		candidates.sort((a, b) => a.getTime() - b.getTime());
		for (const d of candidates) {
			if (d >= hardEnd) return;
			if (!collect(d)) return;
		}

		yearOffset += interval;
	}
}

// ── Helpers ─────────────────────────────────────────────────────

function getMondayOfWeek(d: Date): Date {
	const date = new Date(d);
	const day = date.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	date.setDate(date.getDate() + diff);
	date.setHours(0, 0, 0, 0);
	return date;
}

/**
 * Get the Nth weekday of a given month.
 * position: 1–4 for first–fourth, -1 for last.
 */
export function getNthWeekdayOfMonth(
	year: number,
	month: number,
	weekday: number,
	position: number,
): Date | null {
	if (position === -1) {
		const lastDay = new Date(year, month + 1, 0);
		const diff = (lastDay.getDay() - weekday + 7) % 7;
		return new Date(year, month, lastDay.getDate() - diff);
	}

	const first = new Date(year, month, 1);
	const firstWeekday = first.getDay();
	let day = 1 + ((weekday - firstWeekday + 7) % 7);
	day += (position - 1) * 7;
	const daysInMonth = new Date(year, month + 1, 0).getDate();
	if (day > daysInMonth) return null;
	return new Date(year, month, day);
}

function isExcluded(date: Date, exclusions: Set<string>): boolean {
	const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	return exclusions.has(key);
}
