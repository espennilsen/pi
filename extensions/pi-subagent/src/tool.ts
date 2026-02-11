/**
 * pi-subagent — Tool registration.
 *
 * Modes:
 *   - single:   one agent, one task
 *   - parallel:  multiple agents concurrently
 *   - chain:     sequential pipeline with {previous} placeholder
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { runIsolatedAgent } from "./runner.ts";
import { discoverAgents } from "./agents.ts";
import { oneShotTracker } from "./tracker.ts";
import type {
	AgentConfig,
	AgentScope,
	SingleResult,
	SubagentSettings,
	UsageStats,
	OneShotStatus,
} from "./types.ts";

// ── Helpers ─────────────────────────────────────────────────────

function fmtTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtUsage(u: UsageStats): string {
	const p: string[] = [];
	if (u.turns) p.push(`${u.turns} turn${u.turns > 1 ? "s" : ""}`);
	if (u.input) p.push(`↑${fmtTokens(u.input)}`);
	if (u.output) p.push(`↓${fmtTokens(u.output)}`);
	if (u.cost) p.push(`$${u.cost.toFixed(4)}`);
	return p.join(" ");
}

function sumUsage(results: SingleResult[]): UsageStats {
	const t: UsageStats = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
	for (const r of results) {
		t.input += r.usage.input;
		t.output += r.usage.output;
		t.cacheRead += r.usage.cacheRead;
		t.cacheWrite += r.usage.cacheWrite;
		t.cost += r.usage.cost;
		t.turns += r.usage.turns;
	}
	return t;
}

// ── Concurrency limiter ─────────────────────────────────────────

async function mapConcurrent<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const cap = Math.max(1, Math.min(limit, items.length));
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: cap }, async () => {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return results;
}

// ── Core: run a single agent subprocess ─────────────────────────

async function runAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	settings: SubagentSettings,
	eventBus: ExtensionAPI["events"],
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);
	if (!agent) {
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			response: "",
			stderr: `Unknown agent: ${agentName}`,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				contextTokens: 0,
				turns: 0,
			},
			step,
		};
	}

	const trackingId = oneShotTracker.start(agentName, task.slice(0, 200));

	eventBus.emit("subagent:start", {
		agent: agentName,
		task: task.slice(0, 200),
		trackingId,
	});

	const isolated = await runIsolatedAgent({
		prompt: `Task: ${task}`,
		cwd: cwd ?? defaultCwd,
		model: agent.model ?? settings.model ?? undefined,
		tools: agent.tools?.length ? agent.tools.join(",") : undefined,
		systemPrompt: agent.systemPrompt.trim() || undefined,
		signal,
		timeoutMs: settings.timeoutMs,
	});

	const oneShotStatus: OneShotStatus =
		isolated.response === "(aborted)"
			? "aborted"
			: isolated.response === "(timed out)"
				? "timed_out"
				: isolated.exitCode !== 0
					? "failed"
					: "completed";

	oneShotTracker.complete(trackingId, {
		status: oneShotStatus,
		usage: {
			input: isolated.inputTokens,
			output: isolated.outputTokens,
			cacheRead: isolated.cacheReadTokens,
			cacheWrite: isolated.cacheWriteTokens,
			cost: isolated.costTotal,
		},
		model: isolated.model,
		exitCode: isolated.exitCode,
		responsePreview: isolated.response.slice(0, 500),
		error:
			isolated.exitCode !== 0
				? isolated.stderr.slice(0, 200)
				: undefined,
	});

	eventBus.emit("subagent:complete", {
		agent: agentName,
		trackingId,
		status: oneShotStatus,
		tokens: isolated.totalTokens,
		cost: isolated.costTotal,
		durationMs: isolated.durationMs,
	});

	if (isolated.response === "(aborted)") {
		throw new Error("Subagent was aborted");
	}

	return {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: isolated.exitCode,
		response: isolated.response,
		stderr: isolated.stderr,
		usage: {
			input: isolated.inputTokens,
			output: isolated.outputTokens,
			cacheRead: isolated.cacheReadTokens,
			cacheWrite: isolated.cacheWriteTokens,
			cost: isolated.costTotal,
			contextTokens: isolated.totalTokens,
			turns: isolated.turnCount,
		},
		model: isolated.model ?? undefined,
		step,
	};
}

// ── Tool Parameters ─────────────────────────────────────────────

const TaskItem = Type.Object({
	agent: Type.String({ description: "Agent name" }),
	task: Type.String({ description: "Task description" }),
	cwd: Type.Optional(
		Type.String({ description: "Working directory override" }),
	),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Agent name for this step" }),
	task: Type.String({
		description:
			"Task description. Use {previous} to inject output from the prior step.",
	}),
	cwd: Type.Optional(
		Type.String({ description: "Working directory override" }),
	),
});

const SubagentParams = Type.Object({
	agent: Type.Optional(
		Type.String({ description: "Agent name (single mode)" }),
	),
	task: Type.Optional(
		Type.String({ description: "Task to delegate (single mode)" }),
	),
	tasks: Type.Optional(
		Type.Array(TaskItem, {
			description:
				"Array of {agent, task} for parallel execution",
		}),
	),
	chain: Type.Optional(
		Type.Array(ChainItem, {
			description:
				"Array of {agent, task} for sequential execution",
		}),
	),
	agentScope: Type.Optional(
		StringEnum(["user", "project", "both"] as const, {
			description:
				'Agent discovery scope. Default: "user" (~/.pi/agent/agents). "both" includes project .pi/agents.',
			default: "user",
		}),
	),
	cwd: Type.Optional(
		Type.String({ description: "Working directory (single mode)" }),
	),
});

// ── Registration ────────────────────────────────────────────────

export function registerSubagentTool(
	pi: ExtensionAPI,
	settings: SubagentSettings,
): void {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context windows.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			'Default scope: "user" (from ~/.pi/agent/agents).',
			'Set agentScope: "both" to include project-local .pi/agents/*.md.',
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const scope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, scope);
			const agents = discovery.agents;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount =
				Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const text = (t: string) => ({
				content: [{ type: "text" as const, text: t }],
				details: {},
			});

			if (modeCount !== 1) {
				const avail =
					agents
						.map((a) => `${a.name} (${a.source})`)
						.join(", ") || "none";
				return text(
					`Provide exactly one mode (agent+task, tasks, or chain).\nAvailable agents: ${avail}`,
				);
			}

			// ── Confirmation for project-local agents ─────────
			if (
				(scope === "project" || scope === "both") &&
				ctx.hasUI
			) {
				const requested = new Set<string>();
				if (params.chain)
					for (const s of params.chain)
						requested.add(s.agent);
				if (params.tasks)
					for (const t of params.tasks)
						requested.add(t.agent);
				if (params.agent) requested.add(params.agent);

				const projectAgents = [...requested]
					.map((n) => agents.find((a) => a.name === n))
					.filter(
						(a): a is AgentConfig =>
							a?.source === "project",
					);

				if (projectAgents.length > 0) {
					const names = projectAgents
						.map((a) => a.name)
						.join(", ");
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${discovery.projectAgentsDir}\n\nProject agents are repo-controlled. Only continue for trusted repos.`,
					);
					if (!ok)
						return text(
							"Cancelled: project-local agents not approved.",
						);
				}
			}

			// ── Chain mode ────────────────────────────────────
			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskText = step.task.replace(
						/\{previous\}/g,
						previousOutput,
					);

					const r = await runAgent(
						ctx.cwd,
						agents,
						step.agent,
						taskText,
						step.cwd,
						i + 1,
						signal,
						settings,
						pi.events,
					);
					results.push(r);

					if (r.exitCode !== 0) {
						const msg =
							r.errorMessage ||
							r.stderr ||
							r.response ||
							"(no output)";
						const usage = sumUsage(results);
						return {
							content: [
								{
									type: "text" as const,
									text: `Chain stopped at step ${i + 1} (${step.agent}): ${msg}\n\nUsage: ${fmtUsage(usage)}`,
								},
							],
							details: { mode: "chain", results },
							isError: true,
						};
					}
					previousOutput = r.response;
				}

				const usage = sumUsage(results);
				return {
					content: [
						{
							type: "text" as const,
							text:
								results[results.length - 1]
									.response ||
								"(no output)",
						},
					],
					details: {
						mode: "chain",
						results,
						usage: fmtUsage(usage),
					},
				};
			}

			// ── Parallel mode ─────────────────────────────────
			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > settings.maxTotal) {
					return text(
						`Too many tasks (${params.tasks.length}). Max is ${settings.maxTotal}.`,
					);
				}

				const results = await mapConcurrent(
					params.tasks,
					settings.maxConcurrent,
					async (t) => {
						return runAgent(
							ctx.cwd,
							agents,
							t.agent,
							t.task,
							t.cwd,
							undefined,
							signal,
							settings,
							pi.events,
						);
					},
				);

				const ok = results.filter(
					(r) => r.exitCode === 0,
				).length;
				const usage = sumUsage(results);
				const summaries = results.map((r) => {
					const preview =
						r.response.slice(0, 100) +
						(r.response.length > 100 ? "..." : "");
					return `[${r.agent}] ${r.exitCode === 0 ? "✓" : "✗"}: ${preview || "(no output)"}`;
				});
				return {
					content: [
						{
							type: "text" as const,
							text: `Parallel: ${ok}/${results.length} succeeded (${fmtUsage(usage)})\n\n${summaries.join("\n\n")}`,
						},
					],
					details: {
						mode: "parallel",
						results,
						usage: fmtUsage(usage),
					},
				};
			}

			// ── Single mode ───────────────────────────────────
			if (params.agent && params.task) {
				const r = await runAgent(
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					settings,
					pi.events,
				);

				if (r.exitCode !== 0) {
					const msg =
						r.errorMessage ||
						r.stderr ||
						r.response ||
						"(no output)";
					return {
						content: [
							{
								type: "text" as const,
								text: `Agent failed: ${msg}\n\nUsage: ${fmtUsage(r.usage)}`,
							},
						],
						details: {
							mode: "single",
							results: [r],
						},
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: r.response || "(no output)",
						},
					],
					details: {
						mode: "single",
						results: [r],
						usage: fmtUsage(r.usage),
					},
				};
			}

			const avail =
				agents
					.map((a) => `${a.name} (${a.source})`)
					.join(", ") || "none";
			return text(
				`Invalid parameters. Available agents: ${avail}`,
			);
		},
	});
}
