import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { execCmd } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class GitStatusWidget implements Widget {
	readonly id = "git-status";
	readonly label = "Git Status";
	readonly icon = "🔀";
	private branch = "";
	private ahead = 0;
	private behind = 0;
	private staged = 0;
	private modified = 0;
	private untracked = 0;

	async refresh(ctx: WidgetContext): Promise<void> {
		const branchRaw = await execCmd("git branch --show-current 2>/dev/null", ctx.cwd);
		this.branch = branchRaw || "detached";

		const status = await execCmd("git status --porcelain -b 2>/dev/null", ctx.cwd);
		this.staged = 0;
		this.modified = 0;
		this.untracked = 0;
		this.ahead = 0;
		this.behind = 0;

		for (const line of status.split("\n")) {
			if (line.startsWith("##")) {
				const m = line.match(/ahead (\d+)/);
				if (m) this.ahead = parseInt(m[1]);
				const m2 = line.match(/behind (\d+)/);
				if (m2) this.behind = parseInt(m2[1]);
			} else if (line.length >= 2) {
				const x = line[0], y = line[1];
				if (x === "?" && y === "?") this.untracked++;
				else {
					if (x !== " " && x !== "?") this.staged++;
					if (y !== " " && y !== "?") this.modified++;
				}
			}
		}
	}

	render(w: number, th: Theme): string[] {
		const out: string[] = [];
		const branchColor = this.branch === "main" || this.branch === "master" ? "error" : "accent";
		out.push(truncateToWidth(` ${th.fg("muted", "branch")} ${th.fg(branchColor, this.branch)}`, w));

		const parts: string[] = [];
		if (this.ahead) parts.push(th.fg("success", `↑${this.ahead}`));
		if (this.behind) parts.push(th.fg("warning", `↓${this.behind}`));
		if (this.staged) parts.push(th.fg("success", `${this.staged} staged`));
		if (this.modified) parts.push(th.fg("warning", `${this.modified} modified`));
		if (this.untracked) parts.push(th.fg("muted", `${this.untracked} untracked`));

		if (parts.length === 0) {
			out.push(` ${th.fg("success", "✓")} ${th.fg("muted", "clean")}`);
		} else {
			out.push(truncateToWidth(` ${parts.join(th.fg("dim", " · "))}`, w));
		}
		return out;
	}
}
