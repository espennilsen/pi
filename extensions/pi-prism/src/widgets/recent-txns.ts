import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { fmtDate, fmtMoney, pad } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class RecentTxnsWidget implements Widget {
	readonly id = "recent-txns";
	readonly label = "Transactions";
	readonly icon = "💸";
	private txns: Record<string, unknown>[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		try {
			this.txns = (
				await ctx.query(
					`SELECT t.date, t.description, t.amount, t.transaction_type,
					a.currency, v.name as vendor_name
					FROM finance_transactions t
					LEFT JOIN finance_accounts a ON t.account_id = a.id
					LEFT JOIN finance_vendors v ON t.vendor_id = v.id
					ORDER BY t.date DESC, t.id DESC LIMIT 5`,
				)
			).rows;
		} catch {
			this.txns = [];
		}
	}

	render(w: number, th: Theme): string[] {
		if (this.txns.length === 0) return [th.fg("muted", "  no transactions")];
		const out: string[] = [];
		for (const tx of this.txns) {
			const date = fmtDate(String(tx.date ?? ""));
			const desc = String(tx.vendor_name ?? tx.description ?? "?");
			const amt = Number(tx.amount ?? 0);
			const type = String(tx.transaction_type ?? "out");
			const cur = String(tx.currency ?? "NOK");
			const amtStr = type === "in" ? th.fg("success", `+${fmtMoney(amt, cur)}`) : th.fg("error", `-${fmtMoney(amt, cur)}`);
			const descW = Math.max(6, w - visibleWidth(date) - visibleWidth(amtStr) - 5);
			out.push(` ${th.fg("muted", date)} ${pad(truncateToWidth(desc, descW), descW)} ${amtStr}`);
		}
		return out;
	}
}
