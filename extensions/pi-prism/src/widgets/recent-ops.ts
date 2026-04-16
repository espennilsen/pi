import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { fmtTime } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class RecentOpsWidget implements Widget {
	readonly id = "recent-ops";
	readonly label = "Recent Ops";
	readonly icon = "⚡";
	private ops: Record<string, unknown>[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		try {
			this.ops = (
				await ctx.query(
					`SELECT tool_name, is_error, duration_ms, created_at
					FROM tool_calls ORDER BY id DESC LIMIT 8`,
				)
			).rows;
		} catch {
			this.ops = [];
		}
	}

	render(w: number, th: Theme): string[] {
		if (this.ops.length === 0) return [th.fg("muted", "  no recent ops")];
		const out: string[] = [];
		for (const op of this.ops) {
			const t = fmtTime(String(op.created_at ?? ""));
			const tool = String(op.tool_name ?? "?");
			const ok = op.is_error ? th.fg("error", "✗") : th.fg("success", "✓");
			const ms = op.duration_ms ? th.fg("dim", ` ${op.duration_ms}ms`) : "";
			out.push(truncateToWidth(` ${th.fg("muted", t)} ${ok} ${th.fg("accent", tool)}${ms}`, w));
		}
		return out;
	}
}
