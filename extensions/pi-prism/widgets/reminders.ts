import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { fmtDate, todayIso, daysAheadIso } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class RemindersWidget implements Widget {
	readonly id = "reminders";
	readonly label = "Reminders";
	readonly icon = "🔔";
	private reminders: Record<string, unknown>[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		const today = todayIso();
		const end = daysAheadIso(14);
		try {
			this.reminders = (
				await ctx.query(
					`SELECT r.reminder_type, r.reminder_date, r.message,
					c.first_name, c.last_name
					FROM crm_reminders r
					LEFT JOIN crm_contacts c ON r.contact_id = c.id
					WHERE r.reminder_date >= ? AND r.reminder_date <= ?
					ORDER BY r.reminder_date ASC LIMIT 6`,
					[today, end],
				)
			).rows;
		} catch {
			this.reminders = [];
		}
	}

	render(w: number, th: Theme): string[] {
		if (this.reminders.length === 0) return [th.fg("muted", "  no upcoming reminders")];
		const out: string[] = [];
		for (const r of this.reminders) {
			const date = fmtDate(String(r.reminder_date ?? ""));
			const name = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
			const type = String(r.reminder_type ?? "");
			const icon = type === "birthday" ? "🎂" : type === "anniversary" ? "💍" : "📌";
			const msg = r.message ? String(r.message) : name;
			out.push(truncateToWidth(` ${icon} ${th.fg("muted", date)}  ${msg}`, w));
		}
		return out;
	}
}
