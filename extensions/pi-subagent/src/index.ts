/**
 * pi-subagent — Task delegation extension for pi.
 *
 * Provides:
 *   - subagent tool — spawn isolated pi subprocesses (single/parallel/chain)
 *   - Orchestrator mode — hierarchical agent trees with inter-agent messaging
 *   - Pool management — long-lived RPC agents with persistent context
 *   - Agent discovery from ~/.pi/agent/agents/*.md and .pi/agents/*.md
 *   - One-shot tracking with event bus integration
 *
 * Configuration (settings.json under "pi-subagent"):
 *   {
 *     "pi-subagent": {
 *       "maxConcurrent": 4,
 *       "maxTotal": 8,
 *       "timeoutMs": 600000,
 *       "model": null,
 *       "maxPoolSize": 20,
 *       "maxDepth": 4
 *     }
 *   }
 *
 * Events emitted:
 *   - subagent:start    { agent, task, trackingId }
 *   - subagent:complete { agent, trackingId, status, tokens, cost, durationMs }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSubagentTool, disposePool } from "./tool.ts";
import { resolveSettings } from "./settings.ts";
import { discoverAgents } from "./agents.ts";
import { createLogger } from "./logger.ts";

export { runIsolatedAgent } from "./runner.ts";
export { discoverAgents } from "./agents.ts";
export { oneShotTracker } from "./tracker.ts";
export { AgentPool } from "./pool.ts";
export { RpcAgent } from "./rpc-agent.ts";
export type {
	AgentConfig,
	AgentScope,
	RunnerResult,
	SingleResult,
	SubagentSettings,
	OneShotEntry,
	OneShotStatus,
	PoolAgentNode,
	PoolEntry,
	PoolDetails,
} from "./types.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	// Register tool synchronously — tools registered in session_start are not visible to the model.
	// Settings are resolved lazily per-invocation using ctx.cwd so project-level settings
	// (.pi/settings.json) are read from the correct directory, not process.cwd() at load time.
	registerSubagentTool(pi, resolveSettings, log);

	// Inject available agents into system prompt (user-scope only to prevent prompt injection from untrusted repos)
	pi.on("before_agent_start", async (event: any, ctx: any) => {
		const discovery = discoverAgents(ctx.cwd, "user");
		if (discovery.agents.length === 0) return;

		const agentList = discovery.agents.map(a => {
			const parts = [`**${a.name}** (${a.source}) — ${a.description}`];
			if (a.model) parts.push(`  model: ${a.model}`);
			if (a.tools?.length) parts.push(`  tools: ${a.tools.join(", ")}`);
			if (a.extensions?.length) parts.push(`  extensions: ${a.extensions.join(", ")}`);
			return parts.join("\n");
		}).join("\n");

		const prompt = [
			"",
			"---",
			"",
			"## Subagent Orchestration",
			"",
			"You can delegate tasks to specialized subagents via the `subagent` tool.",
			"Each subagent runs as an isolated pi subprocess with its own context window.",
			"",
			"### Available Agents",
			"",
			agentList,
			"",
			"### Usage Patterns",
			"",
			"**Single task (fast recon):**",
			'```json',
			'{ "agent": "scout", "task": "Map the auth module — list files, key types, entry points" }',
			'```',
			"",
			"**Parallel tasks (independent work):**",
			'```json',
			'{ "tasks": [',
			'    { "agent": "scout", "task": "Map the API routes", "model": "claude-haiku-4-5" },',
			'    { "agent": "scout", "task": "Map the database schema", "model": "claude-haiku-4-5" }',
			'  ] }',
			'```',
			"",
			"**Chain (pipeline — each step gets prior output via {previous}):**",
			'```json',
			'{ "chain": [',
			'    { "agent": "scout", "task": "Map the auth module" },',
			'    { "agent": "planner", "task": "Plan refactoring based on: {previous}" },',
			'    { "agent": "worker", "task": "Implement the plan: {previous}" }',
			'  ] }',
			'```',
			"",
			"**Per-task overrides:** model, thinking (off/minimal/low/medium/high/xhigh), extensions, skills, noTools, noSkills",
			"",
			"**Orchestrator (hierarchical agent tree — agents spawn and message each other):**",
			'```json',
			'{ "orchestrator": { "agent": "planner", "task": "Build the auth system. Spawn specialists as needed." } }',
			'```',
			"The root agent gets spawn_agent, send_message, kill_agent, list_agents tools.",
			"Sub-agents also get these tools and can spawn their own children (max depth: 4).",
			"",
			"**Pool (manual long-lived agents — persistent context across messages):**",
			'```json',
			'{ "action": "spawn", "id": "worker-1", "agent": "worker", "task": "Start on auth" }',
			'{ "action": "send", "id": "worker-1", "message": "Now refactor the middleware" }',
			'{ "action": "list" }',
			'{ "action": "kill", "id": "worker-1" }',
			'```',
			"",
			"**Tips:**",
			"- Use scout (haiku) for fast recon, planner/reviewer (sonnet) for analysis, worker for implementation",
			"- Parallel is ideal for independent tasks — results stream back as they complete",
			"- Chain is ideal for multi-step workflows where each step builds on the previous",
			"- Orchestrator is ideal when the task benefits from autonomous delegation and coordination",
			"- Pool is ideal when you want to manually manage long-lived agents with persistent context",
			"- Extensions: subagents run with -ne (no extensions). Whitelist only what's needed.",
		].join("\n");

		return { systemPrompt: event.systemPrompt + prompt };
	});

	pi.on("session_shutdown", async () => {
		// Pool cleanup — kill all long-lived agents
		await disposePool();
		// Tracker cleanup
		const { oneShotTracker } = await import("./tracker.ts");
		oneShotTracker.dispose();
	});
}
