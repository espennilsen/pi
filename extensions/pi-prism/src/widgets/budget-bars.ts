import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { bar, pad } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class BudgetBarsWidget implements Widget {
	readonly id = "budget-bars";
	readonly label = "Budget";
	readonly icon = "📊";
	private budgets: Record<string, unknown>[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		const now = new Date();
		const m = now.getMonth() + 1;
		const y = now.getFullYear();
		const ms = String(m).padStart(2, "0");
		const ys = String(y);
		try {
			this.budgets = (
				await ctx.query(
					`SELECT b.id, c.name as category, c.icon, b.amount as budget_amount,
					COALESCE((
						SELECT SUM(t.amount) FROM finance_transactions t
						WHERE t.category_id = b.category_id AND t.transaction_type = 'out'
						AND strftime('%m', t.date) = ? AND strftime('%Y', t.date) = ?
					), 0) as spent
					FROM finance_budgets b JOIN finance_categories c ON b.category_id = c.id
					WHERE b.month = ? AND b.year = ? ORDER BY b.amount DESC LIMIT 8`,
					[ms, ys, m, y],
				)
			).rows;
		} catch {
			this.budgets = [];
		}
	}

	render(w: number, th: Theme): string[] {
		if (this.budgets.length === 0) return [th.fg("muted", "  no budgets this month")];
		const barW = Math.max(6, Math.min(12, w - 18));
		const out: string[] = [];
		for (const b of this.budgets) {
			const cat = String(b.category ?? "?");
			const icon = b.icon ? `${b.icon} ` : "";
			const budget = Number(b.budget_amount ?? 0);
			const spent = Number(b.spent ?? 0);
			const ratio = budget > 0 ? spent / budget : 0;
			const pct = Math.round(ratio * 100);
			const color: "error" | "warning" | "success" = ratio > 0.9 ? "error" : ratio > 0.7 ? "warning" : "success";
			const labelW = Math.max(6, w - barW - 8);
			out.push(` ${pad(truncateToWidth(`${icon}${cat}`, labelW), labelW)} ${th.fg(color, bar(ratio, barW))} ${th.fg(color, `${pct}%`)}`);
		}
		return out;
	}
}
