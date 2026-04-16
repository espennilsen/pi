import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { todayIso } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class SessionStatsWidget implements Widget {
	readonly id = "session-stats";
	readonly label = "Session";
	readonly icon = "⏱";
	private startedAt = Date.now();
	private todayCost = 0;
	private todayJobs = 0;
	private todayToolCalls = 0;
	private model = "";

	async refresh(ctx: WidgetContext): Promise<void> {
		const today = todayIso();
		try {
			// Day totals — no GROUP BY so counts span all models used today
			const totals = await ctx.query(
				`SELECT SUM(cost_total) as cost, COUNT(*) as jobs, SUM(tool_call_count) as tools
				FROM jobs WHERE date(created_at) = ?`,
				[today],
			);
			const t = totals.rows[0];
			this.todayCost = Number(t?.cost ?? 0);
			this.todayJobs = Number(t?.jobs ?? 0);
			this.todayToolCalls = Number(t?.tools ?? 0);

			// Dominant model — separate query for display only
			const dominant = await ctx.query(
				`SELECT model FROM jobs WHERE date(created_at) = ?
				GROUP BY model ORDER BY SUM(cost_total) DESC LIMIT 1`,
				[today],
			);
			this.model = String(dominant.rows[0]?.model ?? "?");
		} catch {
			// stats unavailable
		}
	}

	render(w: number, th: Theme): string[] {
		const elapsed = Date.now() - this.startedAt;
		const mins = Math.floor(elapsed / 60000);
		const out: string[] = [];
		out.push(truncateToWidth(` ${th.fg("muted", "uptime")}  ${th.fg("accent", `${mins}m`)}`, w));
		out.push(truncateToWidth(` ${th.fg("muted", "model")}   ${th.fg("accent", truncateToWidth(this.model, w - 12))}`, w));
		out.push(
			truncateToWidth(
				` ${th.fg("muted", "today")}   ${th.fg("accent", `${this.todayJobs}`)} jobs · ${th.fg("accent", `${this.todayToolCalls}`)} tools · ${th.fg("success", `$${this.todayCost.toFixed(2)}`)}`,
				w,
			),
		);
		return out;
	}
}
