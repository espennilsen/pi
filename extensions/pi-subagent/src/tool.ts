/**
 * pi-subagent — Tool registration.
 *
 * Modes:
 *   - single:   one agent, one task
 *   - parallel:  multiple agents concurrently (with streaming progress)
 *   - chain:     sequential pipeline with {previous} placeholder
 *
 * Aligned with official pi subagent example:
 *   - Full Message[] capture for rich rendering
 *   - onUpdate streaming for parallel/chain progress
 *   - renderCall / renderResult for TUI display
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { runIsolatedAgent } from "./runner.ts";
import { discoverAgents } from "./agents.ts";
import { oneShotTracker } from "./tracker.ts";
import { AgentPool, type PoolLogger } from "./pool.ts";
import type {
	AgentConfig,
	AgentScope,
	PoolDetails,
	PoolEntry,
	SingleResult,
	SubagentDetails,
	SubagentSettings,
	UsageStats,
	OneShotStatus,
} from "./types.ts";
import * as os from "node:os";

// ── Helpers ─────────────────────────────────────────────────────

function fmtTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtUsage(u: UsageStats, model?: string): string {
	const p: string[] = [];
	if (u.turns) p.push(`${u.turns} turn${u.turns > 1 ? "s" : ""}`);
	if (u.input) p.push(`↑${fmtTokens(u.input)}`);
	if (u.output) p.push(`↓${fmtTokens(u.output)}`);
	if (u.cacheRead) p.push(`R${fmtTokens(u.cacheRead)}`);
	if (u.cacheWrite) p.push(`W${fmtTokens(u.cacheWrite)}`);
	if (u.cost) p.push(`$${u.cost.toFixed(4)}`);
	if (model) p.push(model);
	return p.join(" ");
}

function sumUsage(results: SingleResult[]): UsageStats {
	const t: UsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
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

function getFinalOutput(messages: any[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: any[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

function formatToolCall(name: string, args: Record<string, unknown>, fg: (c: any, t: string) => string): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};
	switch (name) {
		case "bash": {
			const cmd = (args.command as string) || "...";
			const preview = cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd;
			return fg("muted", "$ ") + fg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return fg("muted", "read ") + fg("accent", shortenPath(rawPath));
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return fg("muted", "write ") + fg("accent", shortenPath(rawPath));
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return fg("muted", "edit ") + fg("accent", shortenPath(rawPath));
		}
		default: {
			const s = JSON.stringify(args);
			const preview = s.length > 50 ? `${s.slice(0, 50)}...` : s;
			return fg("accent", name) + fg("dim", ` ${preview}`);
		}
	}
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

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

// Hard-blocked: pi-subagent can never be loaded in subagents (prevents recursion)
const ALWAYS_BLOCKED = new Set(["pi-subagent"]);

function isBlocked(ext: string, blocklist: Set<string>): boolean {
	const name = (ext.replace(/\/+$/, "").split("/").pop() ?? ext).toLowerCase();
	return ALWAYS_BLOCKED.has(name) || blocklist.has(name);
}

/** Overrides from the tool call params */
interface CallSiteOpts {
	extensions?: string[];
	skills?: string[];
	thinking?: string;
	model?: string;
	noTools?: boolean;
	noSkills?: boolean;
}

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
	log: Logger,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	allResults?: SingleResult[],
	resultIndex?: number,
	callSite?: CallSiteOpts,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);
	if (!agent) {
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			response: "",
			stderr: `Unknown agent: ${agentName}`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
		};
	}

	const trackingId = oneShotTracker.start(agentName, task.slice(0, 200));
	eventBus.emit("subagent:start", { agent: agentName, task: task.slice(0, 200), trackingId });
	log("spawn", { agent: agentName, trackingId });

	// Mutable result — updated as messages stream in
	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: -1, // -1 = running
		messages: [],
		response: "",
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: agent.model,
		step,
	};

	const emitUpdate = () => {
		if (!onUpdate) return;
		currentResult.response = getFinalOutput(currentResult.messages);
		if (allResults && resultIndex !== undefined) {
			allResults[resultIndex] = { ...currentResult };
		}
		onUpdate({
			content: [{ type: "text", text: currentResult.response || "(running...)" }],
			details: makeDetails(allResults ? [...allResults] : [currentResult]),
		});
	};

	// Merge global + per-agent + call-site extension whitelists, filter blocked
	const blocklist = new Set(settings.blockedExtensions.map(e => e.toLowerCase()));
	const mergedExtensions = [...new Set([
		...settings.extensions,
		...(agent.extensions ?? []),
		...(callSite?.extensions ?? []),
	])].filter(ext => !isBlocked(ext, blocklist));

	// Model priority: call-site > agent config > global settings
	const model = callSite?.model ?? agent.model ?? settings.model ?? undefined;

	const isolated = await runIsolatedAgent({
		prompt: `Task: ${task}`,
		cwd: cwd ?? defaultCwd,
		model,
		tools: callSite?.noTools ? undefined : (agent.tools?.length ? agent.tools.join(",") : undefined),
		noTools: callSite?.noTools,
		extensions: mergedExtensions,
		skills: callSite?.skills,
		noSkills: callSite?.noSkills,
		thinking: callSite?.thinking,
		systemPrompt: agent.systemPrompt.trim() || undefined,
		signal,
		timeoutMs: settings.timeoutMs,
		onMessage: (msg) => {
			currentResult.messages.push(msg);
			if (msg.role === "assistant") {
				currentResult.usage.turns++;
				const u = msg.usage;
				if (u) {
					currentResult.usage.input += u.input || 0;
					currentResult.usage.output += u.output || 0;
					currentResult.usage.cacheRead += u.cacheRead || 0;
					currentResult.usage.cacheWrite += u.cacheWrite || 0;
					currentResult.usage.cost += (u.cost?.input || 0) + (u.cost?.output || 0) + (u.cost?.cacheRead || 0) + (u.cost?.cacheWrite || 0);
					currentResult.usage.contextTokens = u.totalTokens || 0;
				}
				if (!currentResult.model && msg.model) currentResult.model = msg.model;
				if (msg.stopReason) currentResult.stopReason = msg.stopReason;
				if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
			}
			emitUpdate();
		},
	});

	const oneShotStatus: OneShotStatus =
		isolated.response === "(aborted)" ? "aborted"
		: isolated.response === "(timed out)" ? "timed_out"
		: isolated.exitCode !== 0 ? "failed"
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
		error: isolated.exitCode !== 0 ? isolated.stderr.slice(0, 200) : undefined,
	});

	eventBus.emit("subagent:complete", {
		agent: agentName,
		trackingId,
		status: oneShotStatus,
		tokens: isolated.totalTokens,
		cost: isolated.costTotal,
		durationMs: isolated.durationMs,
	});
	log("complete", { agent: agentName, trackingId, status: oneShotStatus, durationMs: isolated.durationMs },
		oneShotStatus === "completed" ? "INFO" : "ERROR");

	if (isolated.response === "(aborted)") {
		throw new Error("Subagent was aborted");
	}

	const result: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: isolated.exitCode,
		messages: isolated.messages,
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
		stopReason: isolated.stopReason ?? undefined,
		errorMessage: isolated.errorMessage ?? undefined,
		step,
	};

	return result;
}

// ── Tool Parameters ─────────────────────────────────────────────

const ExtensionsSchema = Type.Optional(Type.Array(Type.String(), {
	description: "Extension paths to load in the subagent (e.g. ['extensions/pi-brave-search']). Subagents run with -ne by default — only listed extensions are loaded.",
}));

const SkillsSchema = Type.Optional(Type.Array(Type.String(), {
	description: "Skill files or directories to load via --skill.",
}));

const ThinkingSchema = Type.Optional(StringEnum(
	["off", "minimal", "low", "medium", "high", "xhigh"] as const,
	{ description: "Thinking level for the subagent." },
));

const ModelSchema = Type.Optional(Type.String({
	description: "Model override for this specific task (e.g. 'claude-haiku-4-5', 'openai/gpt-4o'). Overrides agent and global defaults.",
}));

const TaskItem = Type.Object({
	agent: Type.String({ description: "Agent name" }),
	task: Type.String({ description: "Task description" }),
	cwd: Type.Optional(Type.String({ description: "Working directory override" })),
	extensions: ExtensionsSchema,
	skills: SkillsSchema,
	thinking: ThinkingSchema,
	model: ModelSchema,
	noTools: Type.Optional(Type.Boolean({ description: "Disable all built-in tools (--no-tools)" })),
	noSkills: Type.Optional(Type.Boolean({ description: "Disable skill discovery (-ns)" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Agent name for this step" }),
	task: Type.String({ description: "Task description. Use {previous} to inject output from the prior step." }),
	cwd: Type.Optional(Type.String({ description: "Working directory override" })),
	extensions: ExtensionsSchema,
	skills: SkillsSchema,
	thinking: ThinkingSchema,
	model: ModelSchema,
	noTools: Type.Optional(Type.Boolean({ description: "Disable all built-in tools (--no-tools)" })),
	noSkills: Type.Optional(Type.Boolean({ description: "Disable skill discovery (-ns)" })),
});

const OrchestratorItem = Type.Object({
	agent: Type.String({ description: "Agent type for the root orchestrator (e.g. 'planner', 'worker')" }),
	task: Type.String({ description: "High-level task for the orchestrator. It will spawn/manage sub-agents autonomously." }),
	id: Type.Optional(Type.String({ description: "ID for the root agent (default: 'root')" })),
	extensions: ExtensionsSchema,
	skills: SkillsSchema,
	thinking: ThinkingSchema,
	model: ModelSchema,
	noTools: Type.Optional(Type.Boolean({ description: "Disable all built-in tools for the root agent" })),
	noSkills: Type.Optional(Type.Boolean({ description: "Disable skill discovery for the root agent" })),
});

const SubagentParams = Type.Object({
	// ── Existing one-shot modes ──────────────────────
	agent: Type.Optional(Type.String({ description: "Agent name (single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	// ── New: orchestrator mode ───────────────────────
	orchestrator: Type.Optional(OrchestratorItem),
	// ── New: pool management actions ─────────────────
	action: Type.Optional(StringEnum(
		["spawn", "send", "list", "kill", "kill-all", "wait", "poll"] as const,
		{ description: "Pool management action. Use with id/message params." },
	)),
	id: Type.Optional(Type.String({ description: "Agent ID (for spawn/send/kill pool actions)" })),
	message: Type.Optional(Type.String({ description: "Message to send (for 'send' pool action)" })),
	background: Type.Optional(Type.Boolean({
		description: "Run spawn/send in background (non-blocking). Returns immediately — use wait/poll to collect results later. Enables parallel dispatch to multiple pool agents.",
	})),
	// ── Shared options ───────────────────────────────
	agentScope: Type.Optional(StringEnum(["user", "project", "both"] as const, {
		description: 'Agent discovery scope. Default: "user" (~/.pi/agent/agents). "both" includes project .pi/agents.',
		default: "user",
	})),
	extensions: ExtensionsSchema,
	skills: SkillsSchema,
	thinking: ThinkingSchema,
	model: ModelSchema,
	noTools: Type.Optional(Type.Boolean({ description: "Disable all built-in tools (--no-tools)" })),
	noSkills: Type.Optional(Type.Boolean({ description: "Disable skill discovery (-ns)" })),
	cwd: Type.Optional(Type.String({ description: "Working directory (single mode)" })),
});

// ── Registration ────────────────────────────────────────────────

export type Logger = (event: string, data: unknown, level?: string) => void;

const COLLAPSED_ITEM_COUNT = 10;

/** Shared pool instance — created on first orchestrator/pool use, disposed on session end. */
let activePool: AgentPool | null = null;

export function getActivePool(): AgentPool | null { return activePool; }

export async function disposePool(): Promise<void> {
	if (activePool) {
		await activePool.dispose();
		activePool = null;
	}
}

export function registerSubagentTool(
	pi: ExtensionAPI,
	getSettings: (cwd: string) => SubagentSettings,
	log: Logger = () => {},
): void {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents running as isolated pi subprocesses.",
			"Each subagent gets a fresh context window — no shared state with this session.",
			"",
			"MODES (one-shot — fire and forget):",
			"• Single: { agent, task } — one agent, one task",
			"• Parallel: { tasks: [{agent, task}, ...] } — concurrent execution with streaming progress",
			"• Chain: { chain: [{agent, task}, ...] } — sequential pipeline, use {previous} for prior output",
			"",
			"MODES (long-lived — persistent context):",
			"• Orchestrator: { orchestrator: {agent, task} } — hierarchical agent tree. The root agent gets",
			"  spawn_agent, send_message, kill_agent, list_agents tools and can build an org of sub-agents.",
			"  Sub-agents can spawn their own children, creating arbitrary depth hierarchies.",
			"• Pool actions: Manual pool management for long-lived agents:",
			'  - { action: "spawn", id: "worker-1", agent: "worker", task: "..." } — spawn a persistent agent',
			'  - { action: "send", id: "worker-1", message: "..." } — send follow-up (agent keeps context)',
			'  - { action: "spawn", ..., background: true } — spawn without waiting (non-blocking)',
			'  - { action: "send", ..., background: true } — send without waiting (non-blocking)',
			'  - { action: "wait" } — block until background ops complete, return results',
			'  - { action: "poll" } — check for completed background ops (non-blocking)',
			'  - { action: "list" } — show all pool agents',
			'  - { action: "kill", id: "worker-1" } — kill agent and its children',
			'  - { action: "kill-all" } — tear down entire pool',
			"",
			"AGENTS: Defined in ~/.pi/agent/agents/*.md (name, description, tools, model in frontmatter).",
			"",
			"PER-TASK OPTIONS (override defaults for specific tasks):",
			"• model — model override (e.g. 'claude-haiku-4-5' for fast tasks, 'claude-sonnet-4-5' for complex ones)",
			"• thinking — thinking level: off, minimal, low, medium, high, xhigh",
			"• extensions — extension paths to load (subagents run with -ne, only whitelisted extensions)",
			"• skills — skill files/dirs to load",
			"• noTools — disable all built-in tools (for analysis-only agents)",
			"• noSkills — disable skill discovery",
			"",
			"OPTIONS PRIORITY: per-task > top-level params > agent .md frontmatter > global settings",
		].join("\n"),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const settings = getSettings(ctx.cwd);
			const scope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, scope);
			const agents = discovery.agents;

			const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

			// ── Pool actions (spawn/send/list/kill/kill-all) ──
			if (params.action) {
				return await handlePoolAction(params, settings, agents, ctx.cwd, log, text);
			}

			// ── Orchestrator mode ─────────────────────────────
			if (params.orchestrator) {
				return await handleOrchestrator(params, settings, agents, ctx.cwd, log, text);
			}

			// ── One-shot modes (existing) ─────────────────────
			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails = (mode: "single" | "parallel" | "chain") => (results: SingleResult[]): SubagentDetails => ({
				mode,
				agentScope: scope,
				projectAgentsDir: discovery.projectAgentsDir,
				results,
			});

			if (modeCount !== 1) {
				const avail = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return text(`Provide exactly one mode (agent+task, tasks, chain, orchestrator, or action).\nAvailable agents: ${avail}`);
			}

			// ── Confirmation for project-local agents ─────────
			if ((scope === "project" || scope === "both") && ctx.hasUI) {
				const requested = new Set<string>();
				if (params.chain) for (const s of params.chain) requested.add(s.agent);
				if (params.tasks) for (const t of params.tasks) requested.add(t.agent);
				if (params.agent) requested.add(params.agent);

				const projectAgents = [...requested]
					.map((n) => agents.find((a) => a.name === n))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgents.length > 0) {
					const names = projectAgents.map((a) => a.name).join(", ");
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${discovery.projectAgentsDir}\n\nProject agents are repo-controlled. Only continue for trusted repos.`,
					);
					if (!ok) return text("Cancelled: project-local agents not approved.");
				}
			}

			// ── Chain mode ────────────────────────────────────
			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskText = step.task.replace(/\{previous\}/g, previousOutput);

					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
							const currentResult = partial.details?.results?.slice(-1)[0];
							if (currentResult) {
								onUpdate({
									content: partial.content,
									details: makeDetails("chain")([...results, currentResult]),
								});
							}
						}
						: undefined;

					const r = await runAgent(
						ctx.cwd, agents, step.agent, taskText, step.cwd, i + 1,
						signal, settings, pi.events, log,
						chainUpdate, makeDetails("chain"),
						undefined, undefined,
						{
							extensions: [...(params.extensions ?? []), ...(step.extensions ?? [])],
							skills: [...(params.skills ?? []), ...(step.skills ?? [])],
							thinking: step.thinking ?? params.thinking,
							model: step.model ?? params.model,
							noTools: step.noTools ?? params.noTools,
							noSkills: step.noSkills ?? params.noSkills,
						},
					);
					results.push(r);

					const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
					if (isError) {
						const msg = r.errorMessage || r.stderr || getFinalOutput(r.messages) || r.response || "(no output)";
						const usage = sumUsage(results);
						return {
							content: [{ type: "text" as const, text: `Chain stopped at step ${i + 1} (${step.agent}): ${msg}\n\nUsage: ${fmtUsage(usage)}` }],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(r.messages) || r.response;
				}

				const usage = sumUsage(results);
				const lastOutput = getFinalOutput(results[results.length - 1].messages) || results[results.length - 1].response;
				return {
					content: [{ type: "text" as const, text: lastOutput || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			// ── Parallel mode (with streaming progress) ───────
			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > settings.maxTotal) {
					return text(`Too many tasks (${params.tasks.length}). Max is ${settings.maxTotal}.`);
				}

				// Shared results array — updated by each task's onMessage callback
				const allResults: SingleResult[] = params.tasks.map(t => ({
					agent: t.agent,
					agentSource: "unknown" as const,
					task: t.task,
					exitCode: -1, // -1 = still running
					messages: [],
					response: "",
					stderr: "",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
				}));

				const emitParallelUpdate = () => {
					if (!onUpdate) return;
					const running = allResults.filter(r => r.exitCode === -1).length;
					const done = allResults.filter(r => r.exitCode !== -1).length;
					onUpdate({
						content: [{ type: "text" as const, text: `Parallel: ${done}/${allResults.length} done, ${running} running...` }],
						details: makeDetails("parallel")([...allResults]),
					});
				};

				const results = await mapConcurrent(
					params.tasks,
					settings.maxConcurrent,
					async (t, index) => {
						const result = await runAgent(
							ctx.cwd, agents, t.agent, t.task, t.cwd, undefined,
							signal, settings, pi.events, log,
							// Per-task streaming update
							(partial) => {
								if (partial.details?.results?.[index]) {
									allResults[index] = partial.details.results[index];
								}
								emitParallelUpdate();
							},
							makeDetails("parallel"),
							allResults,
							index,
							{
								extensions: [...(params.extensions ?? []), ...(t.extensions ?? [])],
								skills: [...(params.skills ?? []), ...(t.skills ?? [])],
								thinking: t.thinking ?? params.thinking,
								model: t.model ?? params.model,
								noTools: t.noTools ?? params.noTools,
								noSkills: t.noSkills ?? params.noSkills,
							},
						);
						allResults[index] = result;
						emitParallelUpdate();
						return result;
					},
				);

				const ok = results.filter((r) => r.exitCode === 0).length;
				const usage = sumUsage(results);
				const summaries = results.map((r) => {
					const output = getFinalOutput(r.messages) || r.response;
					const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
					return `[${r.agent}] ${r.exitCode === 0 ? "✓" : "✗"}: ${preview || "(no output)"}`;
				});
				return {
					content: [{ type: "text" as const, text: `Parallel: ${ok}/${results.length} succeeded (${fmtUsage(usage)})\n\n${summaries.join("\n\n")}` }],
					details: makeDetails("parallel")(results),
				};
			}

			// ── Single mode ───────────────────────────────────
			if (params.agent && params.task) {
				const r = await runAgent(
					ctx.cwd, agents, params.agent, params.task, params.cwd, undefined,
					signal, settings, pi.events, log,
					onUpdate, makeDetails("single"),
					undefined, undefined,
					{
						extensions: params.extensions,
						skills: params.skills,
						thinking: params.thinking,
						model: params.model,
						noTools: params.noTools,
						noSkills: params.noSkills,
					},
				);

				const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
				if (isError) {
					const msg = r.errorMessage || r.stderr || getFinalOutput(r.messages) || r.response || "(no output)";
					return {
						content: [{ type: "text" as const, text: `Agent ${r.stopReason || "failed"}: ${msg}\n\nUsage: ${fmtUsage(r.usage)}` }],
						details: makeDetails("single")([r]),
						isError: true,
					};
				}

				return {
					content: [{ type: "text" as const, text: getFinalOutput(r.messages) || r.response || "(no output)" }],
					details: makeDetails("single")([r]),
				};
			}

			const avail = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return text(`Invalid parameters. Available agents: ${avail}`);
		},

		// ── TUI Rendering ─────────────────────────────────────

		renderCall(args: any, theme: any) {
			// ── Orchestrator rendering ────────────────────
			if (args.orchestrator) {
				const o = args.orchestrator;
				const preview = o.task.length > 60 ? `${o.task.slice(0, 60)}...` : o.task;
				let t = theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `orchestrator`) +
					theme.fg("muted", ` [${o.agent}]`);
				t += `\n  ${theme.fg("dim", preview)}`;
				return new Text(t, 0, 0);
			}

			// ── Pool action rendering ─────────────────────
			if (args.action) {
				const bgLabel = args.background ? " (background)" : "";
				let t = theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `pool:${args.action}`) +
					(bgLabel ? theme.fg("warning", bgLabel) : "");
				if (args.id) t += theme.fg("muted", ` ${args.id}`);
				if (args.message) {
					const preview = args.message.length > 50 ? `${args.message.slice(0, 50)}...` : args.message;
					t += `\n  ${theme.fg("dim", preview)}`;
				}
				if (args.task) {
					const preview = args.task.length > 50 ? `${args.task.slice(0, 50)}...` : args.task;
					t += `\n  ${theme.fg("dim", preview)}`;
				}
				return new Text(t, 0, 0);
			}

			const scope: AgentScope = args.agentScope ?? "user";

			if (args.chain?.length > 0) {
				let t = theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					const clean = step.task.replace(/\{previous\}/g, "").trim();
					const preview = clean.length > 40 ? `${clean.slice(0, 40)}...` : clean;
					t += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", step.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.chain.length > 3) t += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(t, 0, 0);
			}

			if (args.tasks?.length > 0) {
				let t = theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const task of args.tasks.slice(0, 3)) {
					const preview = task.task.length > 40 ? `${task.task.slice(0, 40)}...` : task.task;
					t += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) t += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(t, 0, 0);
			}

			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let t = theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			t += `\n  ${theme.fg("dim", preview)}`;
			return new Text(t, 0, 0);
		},

		renderResult(result: any, { expanded }: { expanded: boolean }, theme: any) {
			// ── Pool/orchestrator details ─────────────────
			const poolDetails = result.details as PoolDetails | undefined;
			if (poolDetails && (poolDetails.mode === "orchestrator" || poolDetails.mode === "pool")) {
				return renderPoolResult(poolDetails, result, expanded, theme);
			}

			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();
			const fg = theme.fg.bind(theme);

			const renderItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let t = "";
				if (skipped > 0) t += fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						t += `${fg("toolOutput", preview)}\n`;
					} else {
						t += `${fg("muted", "→ ") + formatToolCall(item.name, item.args, fg)}\n`;
					}
				}
				return t.trimEnd();
			};

			// ── Single result ─────────────────────────────
			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
				const icon = isError ? fg("error", "✗") : fg("success", "✓");
				const items = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages) || r.response;

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${fg("toolTitle", theme.bold(r.agent))}${fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage) container.addChild(new Text(fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(fg("muted", "─── Output ───"), 0, 0));
					for (const item of items) {
						if (item.type === "toolCall")
							container.addChild(new Text(fg("muted", "→ ") + formatToolCall(item.name, item.args, fg), 0, 0));
					}
					if (finalOutput) {
						container.addChild(new Spacer(1));
						container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
					}
					const usageStr = fmtUsage(r.usage, r.model);
					if (usageStr) { container.addChild(new Spacer(1)); container.addChild(new Text(fg("dim", usageStr), 0, 0)); }
					return container;
				}

				let t = `${icon} ${fg("toolTitle", theme.bold(r.agent))}${fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) t += ` ${fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) t += `\n${fg("error", `Error: ${r.errorMessage}`)}`;
				else if (items.length === 0) t += `\n${fg("muted", "(no output)")}`;
				else {
					t += `\n${renderItems(items, COLLAPSED_ITEM_COUNT)}`;
					if (items.length > COLLAPSED_ITEM_COUNT) t += `\n${fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = fmtUsage(r.usage, r.model);
				if (usageStr) t += `\n${fg("dim", usageStr)}`;
				return new Text(t, 0, 0);
			}

			// ── Chain / Parallel results ──────────────────
			const isChain = details.mode === "chain";
			const running = details.results.filter(r => r.exitCode === -1).length;
			const successCount = details.results.filter(r => r.exitCode === 0).length;
			const failCount = details.results.filter(r => r.exitCode > 0).length;
			const isRunning = running > 0;

			const modeLabel = isChain ? "chain" : "parallel";
			const status = isChain
				? `${successCount}/${details.results.length} steps`
				: isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;
			const modeIcon = isRunning
				? fg("warning", "⏳")
				: failCount > 0 ? fg("warning", "◐") : fg("success", "✓");

			if (expanded && !isRunning) {
				const container = new Container();
				container.addChild(new Text(`${modeIcon} ${fg("toolTitle", theme.bold(modeLabel + " "))}${fg("accent", status)}`, 0, 0));

				for (const r of details.results) {
					const rIcon = r.exitCode === 0 ? fg("success", "✓") : fg("error", "✗");
					const label = isChain ? `Step ${r.step}: ${r.agent}` : r.agent;
					const finalOutput = getFinalOutput(r.messages) || r.response;

					container.addChild(new Spacer(1));
					container.addChild(new Text(`${fg("muted", "─── ")}${fg("accent", label)} ${rIcon}`, 0, 0));
					container.addChild(new Text(fg("muted", "Task: ") + fg("dim", r.task), 0, 0));
					for (const item of getDisplayItems(r.messages)) {
						if (item.type === "toolCall")
							container.addChild(new Text(fg("muted", "→ ") + formatToolCall(item.name, item.args, fg), 0, 0));
					}
					if (finalOutput) { container.addChild(new Spacer(1)); container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme)); }
					const u = fmtUsage(r.usage, r.model);
					if (u) container.addChild(new Text(fg("dim", u), 0, 0));
				}

				const totalUsage = fmtUsage(sumUsage(details.results));
				if (totalUsage) { container.addChild(new Spacer(1)); container.addChild(new Text(fg("dim", `Total: ${totalUsage}`), 0, 0)); }
				return container;
			}

			// Collapsed / still running
			let t = `${modeIcon} ${fg("toolTitle", theme.bold(modeLabel + " "))}${fg("accent", status)}`;
			for (const r of details.results) {
				const rIcon = r.exitCode === -1 ? fg("warning", "⏳") : r.exitCode === 0 ? fg("success", "✓") : fg("error", "✗");
				const label = isChain ? `Step ${r.step}: ${r.agent}` : r.agent;
				const items = getDisplayItems(r.messages);
				t += `\n\n${fg("muted", "─── ")}${fg("accent", label)} ${rIcon}`;
				if (items.length === 0) t += `\n${fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
				else t += `\n${renderItems(items, 5)}`;
			}
			if (!isRunning) {
				const totalUsage = fmtUsage(sumUsage(details.results));
				if (totalUsage) t += `\n\n${fg("dim", `Total: ${totalUsage}`)}`;
			}
			if (!expanded) t += `\n${fg("muted", "(Ctrl+O to expand)")}`;
			return new Text(t, 0, 0);
		},
	});
}

// ── Pool action handler ─────────────────────────────────────────

async function handlePoolAction(
	params: any,
	settings: SubagentSettings,
	agents: AgentConfig[],
	cwd: string,
	log: Logger,
	text: (t: string) => { content: { type: "text"; text: string }[]; details: {} },
): Promise<any> {
	const ensurePool = async (): Promise<AgentPool> => {
		if (!activePool) {
			activePool = new AgentPool(settings, agents, cwd, log as PoolLogger);
			await activePool.startServer();
		}
		return activePool;
	};

	switch (params.action) {
		case "spawn": {
			if (!params.id || !params.agent || !params.task) {
				return text('spawn requires id, agent, and task. Example: { action: "spawn", id: "worker-1", agent: "worker", task: "..." }');
			}
			const agentConfig = agents.find(a => a.name === params.agent);
			if (!agentConfig) {
				return text(`Unknown agent: ${params.agent}. Available: ${agents.map(a => a.name).join(", ")}`);
			}
			const pool = await ensurePool();
			const spawnOpts = {
				id: params.id,
				agent: agentConfig,
				task: params.task,
				cwd,
				model: params.model,
				thinking: params.thinking,
				extensions: params.extensions,
				skills: params.skills,
				noTools: params.noTools,
				noSkills: params.noSkills,
			};
			try {
				if (params.background) {
					const opId = await pool.spawnAsync(spawnOpts);
					return {
						content: [{ type: "text" as const, text: `✓ Spawned "${params.id}" (${params.agent}) in background [op:${opId}]. Use { action: "wait" } or { action: "poll" } to collect results.` }],
						details: makePoolDetails(pool),
					};
				}
				const result = await pool.spawn(spawnOpts);
				return {
					content: [{ type: "text" as const, text: `✓ Spawned "${params.id}" (${params.agent}). Response:\n\n${result.response}` }],
					details: makePoolDetails(pool),
				};
			} catch (err: any) {
				return { content: [{ type: "text" as const, text: `✗ Spawn failed: ${err.message}` }], details: {}, isError: true };
			}
		}

		case "send": {
			if (!params.id || !params.message) {
				return text('send requires id and message. Example: { action: "send", id: "worker-1", message: "..." }');
			}
			if (!activePool) return text("No active pool. Spawn an agent first.");
			try {
				if (params.background) {
					const opId = await activePool.sendAsync(params.id, params.message);
					return {
						content: [{ type: "text" as const, text: `✓ Message dispatched to "${params.id}" in background [op:${opId}]. Use { action: "wait" } or { action: "poll" } to collect results.` }],
						details: makePoolDetails(activePool),
					};
				}
				const result = await activePool.send(params.id, params.message);
				return {
					content: [{ type: "text" as const, text: `Response from ${params.id}:\n\n${result.response}` }],
					details: makePoolDetails(activePool),
				};
			} catch (err: any) {
				return { content: [{ type: "text" as const, text: `✗ Send failed: ${err.message}` }], details: makePoolDetails(activePool), isError: true };
			}
		}

		case "wait": {
			if (!activePool) return text("No active pool.");
			try {
				const results = await activePool.waitAny();
				if (results.length === 0) return text("No pending background operations.");
				const remaining = activePool.pendingCount;
				const lines = results.map(r => {
					if (r.error) return `### ${r.agentId} (${r.type}) ✗\nError: ${r.error}`;
					return `### ${r.agentId} (${r.type}) ✓\n${r.response || "(no output)"}`;
				});
				const suffix = remaining > 0 ? `\n\n_${remaining} operation(s) still pending._` : "";
				return {
					content: [{ type: "text" as const, text: `## ${results.length} operation(s) completed\n\n${lines.join("\n\n")}${suffix}` }],
					details: makePoolDetails(activePool),
				};
			} catch (err: any) {
				return { content: [{ type: "text" as const, text: `✗ Wait failed: ${err.message}` }], details: makePoolDetails(activePool), isError: true };
			}
		}

		case "poll": {
			if (!activePool) return text("No active pool.");
			const results = activePool.poll();
			const remaining = activePool.pendingCount;
			if (results.length === 0) {
				return text(remaining > 0
					? `No completed operations yet. ${remaining} still pending.`
					: "No pending background operations.");
			}
			const lines = results.map(r => {
				if (r.error) return `### ${r.agentId} (${r.type}) ✗\nError: ${r.error}`;
				return `### ${r.agentId} (${r.type}) ✓\n${r.response || "(no output)"}`;
			});
			const suffix = remaining > 0 ? `\n\n_${remaining} operation(s) still pending._` : "";
			return {
				content: [{ type: "text" as const, text: `## ${results.length} completed\n\n${lines.join("\n\n")}${suffix}` }],
				details: makePoolDetails(activePool),
			};
		}

		case "list": {
			if (!activePool || activePool.size === 0) return text("No active pool agents.");
			const entries = activePool.list();
			const lines = entries.map(e => {
				const indent = "  ".repeat(e.depth);
				const parent = e.parentId ? ` ← ${e.parentId}` : "";
				return `${indent}${e.id} (${e.agentName}) [${e.state}]${parent} — ${fmtUsage(e.usage, e.model ?? undefined)}`;
			});
			return {
				content: [{ type: "text" as const, text: `Pool: ${entries.length} agent(s)\n\n${lines.join("\n")}` }],
				details: makePoolDetails(activePool),
			};
		}

		case "kill": {
			if (!params.id) return text('kill requires id. Example: { action: "kill", id: "worker-1" }');
			if (!activePool) return text("No active pool.");
			try {
				await activePool.kill(params.id);
				return {
					content: [{ type: "text" as const, text: `✓ Killed "${params.id}"` }],
					details: makePoolDetails(activePool),
				};
			} catch (err: any) {
				return { content: [{ type: "text" as const, text: `✗ Kill failed: ${err.message}` }], details: {}, isError: true };
			}
		}

		case "kill-all": {
			if (!activePool) return text("No active pool.");
			await disposePool();
			return text("✓ All pool agents killed and pool disposed.");
		}

		default:
			return text(`Unknown action: ${params.action}`);
	}
}

// ── Orchestrator handler ────────────────────────────────────────

async function handleOrchestrator(
	params: any,
	settings: SubagentSettings,
	agents: AgentConfig[],
	cwd: string,
	log: Logger,
	text: (t: string) => { content: { type: "text"; text: string }[]; details: {} },
): Promise<any> {
	const o = params.orchestrator;
	const agentConfig = agents.find(a => a.name === o.agent);
	if (!agentConfig) {
		return text(`Unknown agent: ${o.agent}. Available: ${agents.map(a => a.name).join(", ")}`);
	}

	// Create or reuse pool
	if (!activePool) {
		activePool = new AgentPool(settings, agents, cwd, log as PoolLogger);
	}
	await activePool.startServer();

	const rootId = o.id ?? "root";

	try {
		const result = await activePool.spawn({
			id: rootId,
			agent: agentConfig,
			task: o.task,
			cwd,
			model: o.model ?? params.model,
			thinking: o.thinking ?? params.thinking,
			extensions: [...(params.extensions ?? []), ...(o.extensions ?? [])],
			skills: [...(params.skills ?? []), ...(o.skills ?? [])],
			noTools: o.noTools ?? params.noTools,
			noSkills: o.noSkills ?? params.noSkills,
		});

		const pool = activePool;
		const poolEntries = pool.list();
		const totalUsage = pool.totalUsage();

		return {
			content: [{ type: "text" as const, text: result.response || "(no output)" }],
			details: {
				mode: "orchestrator" as const,
				agents: poolEntries,
				rootId,
				totalUsage,
			} satisfies PoolDetails,
		};
	} catch (err: any) {
		return {
			content: [{ type: "text" as const, text: `✗ Orchestrator failed: ${err.message}` }],
			details: activePool ? makePoolDetails(activePool) : {},
			isError: true,
		};
	}
}

// ── Pool details helper ─────────────────────────────────────────

function makePoolDetails(pool: AgentPool): PoolDetails {
	return {
		mode: "pool",
		agents: pool.list(),
		rootId: null,
		totalUsage: pool.totalUsage(),
	};
}

// ── Pool result renderer ────────────────────────────────────────

function renderPoolResult(details: PoolDetails, result: any, expanded: boolean, theme: any): any {
	const fg = theme.fg.bind(theme);
	const agents = details.agents;

	if (agents.length === 0) {
		const t = result.content[0];
		return new Text(t?.type === "text" ? t.text : "(no output)", 0, 0);
	}

	const modeLabel = details.mode === "orchestrator" ? "orchestrator" : "pool";
	const alive = agents.filter(a => a.state !== "dead").length;
	const statusText = `${alive}/${agents.length} agents alive`;
	const icon = fg("accent", "🔷");

	if (expanded) {
		const container = new Container();
		container.addChild(new Text(`${icon} ${fg("toolTitle", theme.bold(modeLabel + " "))}${fg("accent", statusText)}`, 0, 0));

		// Build tree display
		const roots = agents.filter(a => !a.parentId);
		const childrenOf = (parentId: string) => agents.filter(a => a.parentId === parentId);

		const renderNode = (agent: PoolEntry, indent: number) => {
			const stateIcon = agent.state === "idle" ? fg("success", "●")
				: agent.state === "streaming" ? fg("warning", "◉")
				: agent.state === "dead" ? fg("error", "○")
				: fg("muted", "◌");
			const prefix = "  ".repeat(indent);
			const usage = fmtUsage(agent.usage, agent.model ?? undefined);
			container.addChild(new Text(
				`${prefix}${stateIcon} ${fg("accent", agent.id)} ${fg("muted", `(${agent.agentName})`)} ${fg("dim", usage)}`,
				0, 0,
			));
			const taskPreview = agent.task.length > 60 ? `${agent.task.slice(0, 60)}...` : agent.task;
			container.addChild(new Text(`${prefix}  ${fg("dim", taskPreview)}`, 0, 0));
			for (const child of childrenOf(agent.id)) {
				renderNode(child, indent + 1);
			}
		};

		container.addChild(new Spacer(1));
		for (const root of roots) renderNode(root, 0);

		const totalUsage = fmtUsage(details.totalUsage);
		if (totalUsage) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(fg("dim", `Total: ${totalUsage}`), 0, 0));
		}

		// Show final output
		const mdTheme = getMarkdownTheme();
		const outputText = result.content[0]?.type === "text" ? result.content[0].text : "";
		if (outputText) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(fg("muted", "─── Output ───"), 0, 0));
			container.addChild(new Markdown(outputText.trim(), 0, 0, mdTheme));
		}

		return container;
	}

	// Collapsed view
	let t = `${icon} ${fg("toolTitle", theme.bold(modeLabel + " "))}${fg("accent", statusText)}`;
	for (const agent of agents) {
		const stateIcon = agent.state === "idle" ? fg("success", "●")
			: agent.state === "streaming" ? fg("warning", "◉")
			: agent.state === "dead" ? fg("error", "○")
			: fg("muted", "◌");
		const indent = "  ".repeat(agent.depth);
		t += `\n${indent}${stateIcon} ${fg("accent", agent.id)} ${fg("muted", `(${agent.agentName})`)}`;
	}
	const totalUsage = fmtUsage(details.totalUsage);
	if (totalUsage) t += `\n${fg("dim", `Total: ${totalUsage}`)}`;

	const outputText = result.content[0]?.type === "text" ? result.content[0].text : "";
	if (outputText) {
		const preview = outputText.split("\n").slice(0, 5).join("\n");
		t += `\n\n${fg("toolOutput", preview)}`;
		if (outputText.split("\n").length > 5) t += `\n${fg("muted", "(Ctrl+O to expand)")}`;
	}

	return new Text(t, 0, 0);
}
