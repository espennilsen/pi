import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { fmtDate, fmtTime, todayIso, daysAheadIso } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class WeekCalendarWidget implements Widget {
	readonly id = "week-calendar";
	readonly label = "This Week";
	readonly icon = "🗓️";
	private events: Record<string, unknown>[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		const today = todayIso();
		const end = daysAheadIso(7);
		try {
			this.events = (
				await ctx.query(
					`SELECT title, start_time, all_day FROM calendar_events
					WHERE date(start_time) >= ? AND date(start_time) <= ?
					ORDER BY start_time ASC LIMIT 12`,
					[today, end],
				)
			).rows;
		} catch {
			this.events = [];
		}
	}

	render(w: number, th: Theme): string[] {
		if (this.events.length === 0) return [th.fg("muted", "  no events this week")];
		const today = todayIso();
		const out: string[] = [];
		let curDate = "";
		for (const ev of this.events) {
			const start = String(ev.start_time ?? "");
			const date = start.slice(0, 10);
			if (date !== curDate) {
				const label = date === today ? th.fg("warning", "TODAY") : th.fg("muted", fmtDate(date));
				out.push(` ${th.bold(label)}`);
				curDate = date;
			}
			const time = ev.all_day ? th.fg("muted", "all day") : th.fg("accent", fmtTime(start));
			out.push(truncateToWidth(`   ${time}  ${ev.title}`, w));
		}
		return out;
	}
}
