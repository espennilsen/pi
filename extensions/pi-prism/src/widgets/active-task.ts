import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { execCmd } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class ActiveTaskWidget implements Widget {
	readonly id = "active-task";
	readonly label = "Active Task";
	readonly icon = "🎯";
	private lines: string[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		const raw = await execCmd("td status 2>/dev/null", ctx.cwd);
		this.lines = raw ? raw.split("\n").slice(0, 8) : [];
	}

	render(w: number, th: Theme): string[] {
		if (this.lines.length === 0) return [th.fg("muted", "  no active task")];
		const out: string[] = [];
		for (const l of this.lines) {
			let s = l;
			if (/\[WIP\]|\[PROGRESS\]/i.test(l)) s = th.fg("warning", l);
			else if (/\[DONE\]|\[CLOSED\]|\[APPROVED\]/i.test(l)) s = th.fg("success", l);
			else if (/\[BLOCKED\]/i.test(l)) s = th.fg("error", l);
			else if (/branch:|session:/i.test(l)) s = th.fg("muted", l);
			out.push(truncateToWidth(` ${s}`, w));
		}
		return out;
	}
}
