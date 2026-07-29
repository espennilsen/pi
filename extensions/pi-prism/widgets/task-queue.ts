import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { hubRpc, type HubTask } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

const PRIORITY_COLOR: Record<string, ThemeColor> = {
	critical: "error",
	high: "warning",
	normal: "text",
	low: "muted",
};

const STATE_ICON: Record<string, string> = {
	queued: "📋",
	planning: "📐",
	building: "🔨",
	reviewing: "👀",
	pr_ready: "🚀",
	blocked: "🚧",
};

export class TaskQueueWidget implements Widget {
	readonly id = "task-queue";
	readonly label = "Task Queue";
	readonly icon = "📋";
	private tasks: HubTask[] = [];
	private total = 0;
	private error: string | null = null;

	async refresh(ctx: WidgetContext): Promise<void> {
		this.tasks = [];
		this.total = 0;
		this.error = null;

		if (!ctx.hubUrl || !ctx.hubApiKey) {
			this.error = "hub not configured";
			return;
		}

		// Fetch queued + planning tasks (the backlog / upcoming work)
		const [queuedRes, planningRes] = await Promise.all([
			hubRpc(ctx.hubUrl, ctx.hubApiKey, "tasks.list", {
				...(ctx.project ? { project: ctx.project } : {}),
				state: "queued",
				limit: 4,
			}),
			hubRpc(ctx.hubUrl, ctx.hubApiKey, "tasks.list", {
				...(ctx.project ? { project: ctx.project } : {}),
				state: "planning",
				limit: 2,
			}),
		]);

		if (!queuedRes && !planningRes) {
			this.error = "hub unreachable";
			return;
		}

		const queued: HubTask[] = ((queuedRes?.tasks as HubTask[]) ?? []);
		const planning: HubTask[] = ((planningRes?.tasks as HubTask[]) ?? []);

		// planning first (higher priority), then queued
		this.tasks = [...planning, ...queued].slice(0, 6);
		this.total = ((queuedRes?.total as number) ?? 0) + ((planningRes?.total as number) ?? 0);
	}

	render(w: number, th: Theme): string[] {
		if (this.error) return [th.fg("muted", `  ${this.error}`)];
		if (this.tasks.length === 0) return [th.fg("muted", "  queue empty")];

		const out: string[] = [];
		for (const task of this.tasks) {
			const icon = STATE_ICON[task.state] ?? "▸";
			const prioColor = PRIORITY_COLOR[task.priority] ?? "fg";
			const prio = task.priority !== "normal" ? th.fg(prioColor, `[${task.priority}]`) + " " : "";
			const title = task.title.length > 36 ? task.title.slice(0, 33) + "…" : task.title;
			out.push(truncateToWidth(` ${icon} ${prio}${title}`, w));
			if (task.project) {
				out.push(truncateToWidth(`   ${th.fg("muted", task.project)}`, w));
			}
		}

		if (this.total > this.tasks.length) {
			out.push(th.fg("muted", `  … ${this.total - this.tasks.length} more in queue`));
		}

		return out;
	}
}
