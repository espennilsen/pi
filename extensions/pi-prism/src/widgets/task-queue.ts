import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { execCmd } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class TaskQueueWidget implements Widget {
	readonly id = "task-queue";
	readonly label = "Task Queue";
	readonly icon = "📋";
	private lines: string[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		const raw = await execCmd("td list --limit 6 2>/dev/null", ctx.cwd);
		this.lines = raw ? raw.split("\n").slice(0, 8) : [];
	}

	render(w: number, th: Theme): string[] {
		if (this.lines.length === 0) return [th.fg("muted", "  no tasks")];
		const out: string[] = [];
		for (const l of this.lines) {
			let s = l;
			if (/\[WIP\]|\[PROGRESS\]/i.test(l)) s = th.fg("warning", l);
			else if (/\[DONE\]|\[CLOSED\]/i.test(l)) s = th.fg("success", l);
			else if (/\[BLOCKED\]/i.test(l)) s = th.fg("error", l);
			else if (/\[RDY\]|\[READY\]/i.test(l)) s = th.fg("accent", l);
			else if (/\[REV\]|\[REVIEW\]/i.test(l)) s = th.fg("warning", l);
			out.push(truncateToWidth(` ${s}`, w));
		}
		return out;
	}
}
