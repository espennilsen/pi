import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { fmtMoney, pad } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class AccountsWidget implements Widget {
	readonly id = "accounts";
	readonly label = "Accounts";
	readonly icon = "💳";
	private accounts: Record<string, unknown>[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		try {
			this.accounts = (await ctx.query(`SELECT name, currency, balance FROM finance_accounts ORDER BY name ASC`)).rows;
		} catch {
			this.accounts = [];
		}
	}

	render(w: number, th: Theme): string[] {
		if (this.accounts.length === 0) return [th.fg("muted", "  no accounts")];
		const out: string[] = [];
		for (const a of this.accounts) {
			const name = String(a.name ?? "?");
			const bal = Number(a.balance ?? 0);
			const cur = String(a.currency ?? "NOK");
			const balStr = bal >= 0 ? th.fg("success", fmtMoney(bal, cur)) : th.fg("error", fmtMoney(bal, cur));
			const nameW = Math.max(8, w - visibleWidth(balStr) - 3);
			out.push(` ${pad(truncateToWidth(name, nameW), nameW)} ${balStr}`);
		}
		return out;
	}
}
