import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { fmtTime } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class TodayCalendarWidget implements Widget {
	readonly id = "today-calendar";
	readonly label = "Today";
	readonly icon = "📅";
	private events: Record<string, unknown>[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		const today = new Date().toISOString().slice(0, 10);
		try {
			this.events = (
				await ctx.query(
					`SELECT title, start_time, end_time, all_day FROM calendar_events
					WHERE date(start_time) = ? ORDER BY start_time ASC LIMIT 8`,
					[today],
				)
			).rows;
		} catch {
			this.events = [];
		}
	}

	render(w: number, th: Theme): string[] {
		if (this.events.length === 0) return [th.fg("muted", "  no events today")];
		const out: string[] = [];
		for (const ev of this.events) {
			const time = ev.all_day ? th.fg("muted", "all day") : th.fg("accent", fmtTime(String(ev.start_time ?? "")));
			out.push(truncateToWidth(` ${time}  ${ev.title}`, w));
		}
		return out;
	}
}
