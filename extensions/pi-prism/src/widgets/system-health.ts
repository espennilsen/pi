import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { execCmd, hubRpc, pad } from "../helpers.ts";
import type { Widget, WidgetContext } from "./index.ts";

export class SystemHealthWidget implements Widget {
	readonly id = "system-health";
	readonly label = "System";
	readonly icon = "🟢";
	private checks: { name: string; ok: boolean; detail: string }[] = [];

	async refresh(ctx: WidgetContext): Promise<void> {
		this.checks = [];

		// DB check
		try {
			const r = await ctx.query(`SELECT count(*) as c FROM tool_calls`);
			this.checks.push({ name: "DB", ok: true, detail: `${r.rows[0]?.c ?? 0} tool calls` });
		} catch {
			this.checks.push({ name: "DB", ok: false, detail: "unreachable" });
		}

		// Memory check
		try {
			const fs = await import("node:fs");
			const path = await import("node:path");
			const memDir = path.join(ctx.cwd, "memory");
			const files = fs.existsSync(memDir) ? fs.readdirSync(memDir).filter((f: string) => f.endsWith(".md")) : [];
			this.checks.push({ name: "Memory", ok: true, detail: `${files.length} logs` });
		} catch {
			this.checks.push({ name: "Memory", ok: false, detail: "error" });
		}

		// Git check
		const branch = await execCmd("git branch --show-current 2>/dev/null", ctx.cwd);
		this.checks.push({ name: "Git", ok: !!branch, detail: branch || "no repo" });

		// Hub reachability check (replaces retired td CLI)
		if (ctx.hubUrl && ctx.hubApiKey) {
			const hubResult = await hubRpc(ctx.hubUrl, ctx.hubApiKey, "tasks.list", { limit: 1 });
			this.checks.push({ name: "Hub", ok: !!hubResult, detail: hubResult ? "reachable" : "unreachable" });
		} else {
			this.checks.push({ name: "Hub", ok: false, detail: "not configured" });
		}
	}

	render(w: number, th: Theme): string[] {
		const out: string[] = [];
		for (const c of this.checks) {
			const dot = c.ok ? th.fg("success", "●") : th.fg("error", "●");
			out.push(truncateToWidth(` ${dot} ${pad(c.name, 8)} ${th.fg("muted", c.detail)}`, w));
		}
		return out;
	}
}
