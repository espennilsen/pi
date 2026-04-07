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

		// Fetch each active state separately so pagination doesn't hide results.
		// A single tasks.list call with no state filter could return limit rows
		// of queued/planning tasks, silently missing building/reviewing tasks.
		const projectFilter = ctx.project ? { project: ctx.project } : {};
		const [buildingRes, reviewingRes, prReadyRes] = await Promise.all([
			hubRpc(ctx.hubUrl, ctx.hubApiKey, "tasks.list", { ...projectFilter, state: "building", limit: 2 }),
			hubRpc(ctx.hubUrl, ctx.hubApiKey, "tasks.list", { ...projectFilter, state: "reviewing", limit: 1 }),
			hubRpc(ctx.hubUrl, ctx.hubApiKey, "tasks.list", { ...projectFilter, state: "pr_ready", limit: 1 }),
		]);

		if (!buildingRes && !reviewingRes && !prReadyRes) {
			this.error = "hub unreachable";
			return;
		}

		// building first (highest urgency), then reviewing, then pr_ready
		const building: HubTask[] = (buildingRes?.tasks as HubTask[]) ?? [];
		const reviewing: HubTask[] = (reviewingRes?.tasks as HubTask[]) ?? [];
		const prReady: HubTask[] = (prReadyRes?.tasks as HubTask[]) ?? [];
		this.tasks = [...building, ...reviewing, ...prReady].slice(0, 2);
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
