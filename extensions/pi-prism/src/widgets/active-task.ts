import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { hubRpc, type HubTask } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

const STATE_ICON: Record<string, string> = {
	building: "🔨",
	reviewing: "👀",
	pr_ready: "🚀",
	planning: "📐",
};

export class ActiveTaskWidget implements Widget {
	readonly id = "active-task";
	readonly label = "Active Task";
	readonly icon = "🎯";
	private tasks: HubTask[] = [];
	private error: string | null = null;

	async refresh(ctx: WidgetContext): Promise<void> {
		this.tasks = [];
		this.error = null;

		if (!ctx.hubUrl || !ctx.hubApiKey) {
			this.error = "hub not configured";
			return;
		}

		// Fetch tasks in active states — building first, then reviewing / pr_ready
		const result = await hubRpc(ctx.hubUrl, ctx.hubApiKey, "tasks.list", {
			...(ctx.project ? { project: ctx.project } : {}),
			limit: 3,
		});

		if (!result) {
			this.error = "hub unreachable";
			return;
		}

		const all = ((result.tasks as HubTask[]) ?? []);
		// Filter to active states, prefer building
		const active = all.filter((t) =>
			["building", "reviewing", "pr_ready"].includes(t.state),
		);
		this.tasks = active.slice(0, 2);
	}

	render(w: number, th: Theme): string[] {
		if (this.error) return [th.fg("muted", `  ${this.error}`)];
		if (this.tasks.length === 0) return [th.fg("muted", "  no active task")];

		const out: string[] = [];
		for (const task of this.tasks) {
			const icon = STATE_ICON[task.state] ?? "▸";
			const stateColor = task.state === "building" ? "warning"
				: task.state === "pr_ready" ? "success"
				: "accent";
			const stateLabel = th.fg(stateColor, `[${task.state}]`);
			const title = task.title.length > 38 ? task.title.slice(0, 35) + "…" : task.title;
			out.push(truncateToWidth(` ${icon} ${stateLabel} ${title}`, w));

			if (task.project) {
				out.push(truncateToWidth(`   ${th.fg("muted", `project: ${task.project}`)}`, w));
			}
			if (task.branch) {
				out.push(truncateToWidth(`   ${th.fg("muted", `branch:  ${task.branch}`)}`, w));
			}
			if (task.prNumber) {
				const prLine = `   ${th.fg("accent", `PR #${task.prNumber}`)}${task.prUrl ? th.fg("muted", ` · ${task.prUrl}`) : ""}`;
				out.push(truncateToWidth(prLine, w));
			}
		}
		return out;
	}
}
