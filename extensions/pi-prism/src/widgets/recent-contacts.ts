import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { fmtDate } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class RecentContactsWidget implements Widget {
	readonly id = "recent-contacts";
	readonly label = "Contacts";
	readonly icon = "👥";
	private contacts: Record<string, unknown>[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		try {
			this.contacts = (
				await ctx.query(
					`SELECT c.first_name, c.last_name, co.name as company, c.last_contacted_at
					FROM crm_contacts c LEFT JOIN crm_companies co ON c.company_id = co.id
					ORDER BY c.last_contacted_at DESC NULLS LAST LIMIT 6`,
				)
			).rows;
		} catch {
			this.contacts = [];
		}
	}

	render(w: number, th: Theme): string[] {
		if (this.contacts.length === 0) return [th.fg("muted", "  no contacts")];
		const out: string[] = [];
		for (const c of this.contacts) {
			const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
			const co = c.company ? th.fg("dim", ` (${c.company})`) : "";
			const ago = c.last_contacted_at ? th.fg("muted", ` ${fmtDate(String(c.last_contacted_at))}`) : th.fg("muted", " never");
			out.push(truncateToWidth(` ${th.fg("accent", name)}${co}${ago}`, w));
		}
		return out;
	}
}
