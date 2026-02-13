/**
 * pi-jobs — LLM tool for querying job stats.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { getJobsStore } from "./store.ts";

interface JobsToolParams {
	action: "stats" | "recent" | "cost_report" | "models" | "tools";
	period?: string;
	channel?: string;
	limit?: number;
}

export function registerJobsTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "jobs",
		label: "Jobs",
		description:
			"Query agent run telemetry: stats (summary), recent (recent runs), " +
			"cost_report (cost by day), models (model usage), tools (tool call frequency).",
		parameters: Type.Object({
			action: StringEnum(
				["stats", "recent", "cost_report", "models", "tools"] as const,
				{ description: "What to query" },
			) as any,
			period: Type.Optional(
				Type.String({ description: "Time period: today, week, month, all (default: month)" }),
			),
			channel: Type.Optional(
				Type.String({ description: "Filter by channel: tui, cron, heartbeat, subagent" }),
			),
			limit: Type.Optional(
				Type.Number({ description: "Max results for recent (default: 20)" }),
			),
		}) as any,

		async execute(_toolCallId, _params) {
			const params = _params as JobsToolParams;
			const store = getJobsStore();
			let result: string;

			const days = periodToDays(params.period ?? "month");

			switch (params.action) {
				case "stats": {
					const totals = await store.getTotals(params.channel);
					result = [
						`**Job Statistics${params.channel ? ` (${params.channel})` : ""}:**`,
						`- Total runs: ${totals.jobs}`,
						`- Errors: ${totals.errors}`,
						`- Total tokens: ${totals.tokens.toLocaleString()}`,
						`- Total cost: $${totals.cost.toFixed(4)}`,
						`- Tool calls: ${totals.toolCalls}`,
						`- Avg duration: ${(totals.avgDurationMs / 1000).toFixed(1)}s`,
					].join("\n");
					break;
				}

				case "recent": {
					const jobs = await store.getRecentJobs(params.limit ?? 20, params.channel);
					if (jobs.length === 0) {
						result = "No jobs recorded yet.";
					} else {
						const lines = jobs.map((j) => {
							const status = j.status === "done" ? "✅" : j.status === "error" ? "❌" : "⏳";
							const cost = j.cost_total > 0 ? ` · $${j.cost_total.toFixed(4)}` : "";
							const tokens = j.total_tokens > 0 ? ` · ${j.total_tokens} tok` : "";
							const dur = j.duration_ms ? ` · ${(j.duration_ms / 1000).toFixed(1)}s` : "";
							return `${status} [${j.channel}] ${j.prompt.slice(0, 60)}${tokens}${cost}${dur}`;
						});
						result = `**Recent Jobs (${jobs.length}):**\n\n${lines.join("\n")}`;
					}
					break;
				}

				case "cost_report": {
					const daily = await store.getDailyStats(days, params.channel);
					if (daily.length === 0) {
						result = "No daily stats available.";
					} else {
						// Group by date
						const byDate = new Map<string, { jobs: number; tokens: number; cost: number }>();
						for (const row of daily) {
							const existing = byDate.get(row.date) ?? { jobs: 0, tokens: 0, cost: 0 };
							existing.jobs += row.job_count;
							existing.tokens += row.total_tokens;
							existing.cost += row.cost_total;
							byDate.set(row.date, existing);
						}

						const lines = [...byDate.entries()].map(([date, d]) =>
							`${date}: ${d.jobs} runs · ${d.tokens.toLocaleString()} tok · $${d.cost.toFixed(4)}`,
						);
						const totalCost = [...byDate.values()].reduce((s, d) => s + d.cost, 0);
						result = `**Cost Report (${days}d):**\n\n${lines.join("\n")}\n\n**Total: $${totalCost.toFixed(4)}**`;
					}
					break;
				}

				case "models": {
					const models = await store.getModelBreakdown(days);
					if (models.length === 0) {
						result = "No model usage data.";
					} else {
						const lines = models.map((m) =>
							`- ${m.provider}/${m.model}: ${m.job_count} runs · ${m.total_tokens.toLocaleString()} tok · $${m.cost_total.toFixed(4)}`,
						);
						result = `**Model Usage (${days}d):**\n\n${lines.join("\n")}`;
					}
					break;
				}

				case "tools": {
					const tools = await store.getToolBreakdown(days);
					if (tools.length === 0) {
						result = "No tool call data.";
					} else {
						const lines = tools.map((t) => {
							const errs = t.error_count > 0 ? ` · ${t.error_count} errors` : "";
							const dur = t.avg_duration_ms ? ` · avg ${(t.avg_duration_ms / 1000).toFixed(1)}s` : "";
							return `- ${t.tool_name}: ${t.call_count} calls${errs}${dur}`;
						});
						result = `**Tool Usage (${days}d):**\n\n${lines.join("\n")}`;
					}
					break;
				}

				default:
					result = `Unknown action: ${(params as any).action}`;
			}

			return {
				content: [{ type: "text" as const, text: result }],
				details: {},
			};
		},
	});
}

function periodToDays(period: string): number {
	switch (period) {
		case "today": return 1;
		case "week": return 7;
		case "month": return 30;
		case "all": return 3650;
		default: return 30;
	}
}
