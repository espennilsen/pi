/**
 * pi-subagent — Agent pool manager.
 *
 * Manages a pool of long-lived RPC agents with optional tree hierarchy.
 * Two modes:
 *   - "pool":          Flat pool, user-controlled spawn/send/kill
 *   - "orchestrator":  Hierarchical tree, agents can spawn children via shim tools
 *
 * Internally uses PoolServer (HTTP IPC) so shim extensions in subprocesses
 * can call back to spawn/send/kill agents.
 */

import * as path from "node:path";
import { RpcAgent, type RpcAgentOpts, type RpcPromptResult } from "./rpc-agent.ts";
import { PoolServer, type PoolRequestHandler } from "./pool-server.ts";
import { MessageRouter } from "./router.ts";
import type {
	AgentConfig,
	PendingOpResult,
	PoolAgentNode,
	PoolEntry,
	PoolIpcRequest,
	PoolIpcResponse,
	SubagentSettings,
	UsageStats,
} from "./types.ts";

export type PoolLogger = (event: string, data: unknown, level?: string) => void;

/** Options for spawning an agent in the pool */
export interface PoolSpawnOpts {
	/** Unique ID for this agent */
	id: string;
	/** Agent config to use */
	agent: AgentConfig;
	/** Initial task/prompt */
	task: string;
	/** Working directory */
	cwd: string;
	/** Parent agent ID (null for root or flat pool) */
	parentId?: string | null;
	/** Override model */
	model?: string;
	/** Override thinking level */
	thinking?: string;
	/** Additional extensions */
	extensions?: string[];
	/** Additional skills */
	skills?: string[];
	/** Disable tools */
	noTools?: boolean;
	/** Disable skills */
	noSkills?: boolean;
}

// Hard-blocked: pi-subagent can never be loaded in subagents
const ALWAYS_BLOCKED = new Set(["pi-subagent"]);

function isBlocked(ext: string, blocklist: Set<string>): boolean {
	const name = (ext.replace(/\/+$/, "").split("/").pop() ?? ext).toLowerCase();
	return ALWAYS_BLOCKED.has(name) || blocklist.has(name);
}

/** Internal tracking for async (background) operations */
interface InternalPendingOp {
	opId: number;
	agentId: string;
	type: "spawn" | "send";
	startedAt: number;
	settled: boolean;
	result?: RpcPromptResult;
	error?: Error;
	promise: Promise<void>;
}

export class AgentPool {
	private agents = new Map<string, { rpc: RpcAgent; node: PoolAgentNode }>();
	private server: PoolServer | null = null;
	private router = new MessageRouter();
	private settings: SubagentSettings;
	private allAgentConfigs: AgentConfig[] = [];
	private cwd: string;
	private log: PoolLogger;
	private shimPath: string;
	private disposed = false;
	private pendingOps = new Map<number, InternalPendingOp>();
	private nextOpId = 1;

	constructor(settings: SubagentSettings, allAgentConfigs: AgentConfig[], cwd: string, log: PoolLogger) {
		this.settings = settings;
		this.allAgentConfigs = allAgentConfigs;
		this.cwd = cwd;
		this.log = log;

		// Resolve shim extension path relative to this file
		// src/pool.ts → ../shim/
		this.shimPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "shim");
	}

	/** Start the IPC server. Must be called before spawning orchestrator agents. */
	async startServer(): Promise<void> {
		if (this.server) return;
		this.server = new PoolServer(this.handleIpcRequest.bind(this));
		await this.server.start();
		this.log("pool-server-started", { port: this.server.port });
	}

	/**
	 * Internal: validate, create RpcAgent, add to pool, and start subprocess.
	 * Does NOT send the initial prompt — caller decides sync vs async.
	 */
	private async setupAgent(opts: PoolSpawnOpts): Promise<{ rpc: RpcAgent; node: PoolAgentNode }> {
		if (this.disposed) throw new Error("Pool is disposed");
		if (this.agents.has(opts.id)) throw new Error(`Agent "${opts.id}" already exists in pool`);
		if (this.agents.size >= this.settings.maxPoolSize) {
			throw new Error(`Pool is full (${this.settings.maxPoolSize} agents max)`);
		}

		// Enforce depth limit
		const parentNode = opts.parentId ? this.agents.get(opts.parentId)?.node : null;
		const depth = parentNode ? parentNode.depth + 1 : 0;
		if (depth > this.settings.maxDepth) {
			throw new Error(`Max depth ${this.settings.maxDepth} exceeded (depth ${depth})`);
		}

		// Build extensions list: settings defaults + agent config + call-site, minus blocked
		const blocklist = new Set(this.settings.blockedExtensions.map(e => e.toLowerCase()));
		const extensions = [...new Set([
			...this.settings.extensions,
			...(opts.agent.extensions ?? []),
			...(opts.extensions ?? []),
		])].filter(ext => !isBlocked(ext, blocklist));

		// Add shim extension for orchestrator mode (if server is running)
		if (this.server) {
			extensions.push(this.shimPath);
		}

		// Model priority: call-site > agent config > global settings
		const model = opts.model ?? opts.agent.model ?? this.settings.model ?? undefined;

		const rpcOpts: RpcAgentOpts = {
			cwd: opts.cwd,
			model,
			tools: opts.noTools ? undefined : (opts.agent.tools?.length ? opts.agent.tools.join(",") : undefined),
			noTools: opts.noTools,
			extensions,
			skills: opts.skills,
			noSkills: opts.noSkills,
			thinking: opts.thinking,
			systemPrompt: opts.agent.systemPrompt.trim() || undefined,
			promptTimeoutMs: this.settings.timeoutMs,
			env: this.server ? {
				PI_POOL_PORT: String(this.server.port),
				PI_POOL_AGENT_ID: opts.id,
			} : {},
		};

		const rpc = new RpcAgent(opts.id, rpcOpts);

		const node: PoolAgentNode = {
			id: opts.id,
			agentName: opts.agent.name,
			parentId: opts.parentId ?? null,
			childIds: [],
			depth,
			state: "starting",
			startedAt: Date.now(),
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			model: model ?? null,
			task: opts.task,
			agentSource: opts.agent.source,
		};

		this.agents.set(opts.id, { rpc, node });

		// Wire into parent's children
		if (parentNode) {
			parentNode.childIds.push(opts.id);
		}

		this.log("pool-spawn", { id: opts.id, agent: opts.agent.name, depth, parentId: opts.parentId ?? null });

		await rpc.start();
		node.state = "idle";

		return { rpc, node };
	}

	/** Spawn a new agent in the pool (blocking — waits for initial task to complete). */
	async spawn(opts: PoolSpawnOpts): Promise<RpcPromptResult> {
		const { rpc, node } = await this.setupAgent(opts);
		try {
			const result = await rpc.prompt(`Task: ${opts.task}`);
			this.syncUsage(opts.id);
			return result;
		} catch (err: any) {
			node.state = "dead";
			throw err;
		}
	}

	/** Spawn a new agent in the background (non-blocking — returns immediately). */
	async spawnAsync(opts: PoolSpawnOpts): Promise<number> {
		const { rpc, node } = await this.setupAgent(opts);
		node.state = "streaming";

		const opId = this.nextOpId++;
		const op: InternalPendingOp = {
			opId,
			agentId: opts.id,
			type: "spawn",
			startedAt: Date.now(),
			settled: false,
			promise: null!,
		};

		op.promise = rpc.prompt(`Task: ${opts.task}`)
			.then(result => {
				this.syncUsage(opts.id);
				op.settled = true;
				op.result = result;
			})
			.catch(err => {
				op.settled = true;
				op.error = err instanceof Error ? err : new Error(String(err));
				node.state = "dead";
			});

		this.pendingOps.set(opId, op);
		this.log("pool-spawn-async", { id: opts.id, opId });
		return opId;
	}

	/** Send a message to an existing agent. Returns the agent's response. */
	async send(targetId: string, message: string, fromId?: string): Promise<RpcPromptResult> {
		const entry = this.agents.get(targetId);
		if (!entry) throw new Error(`Agent "${targetId}" not found in pool`);
		if (entry.node.state === "dead") throw new Error(`Agent "${targetId}" is dead`);
		if (entry.node.state === "streaming") throw new Error(`Agent "${targetId}" is busy processing another prompt`);

		// Cycle detection
		if (fromId) {
			if (this.router.wouldCycle(fromId, targetId)) {
				throw new Error(`Deadlock detected: ${fromId} → ${targetId} would create a cycle. Include your response in the current message instead.`);
			}
			this.router.markWaiting(fromId, targetId);
		}

		const prefix = fromId ? `Message from ${fromId}: ` : "";

		try {
			const result = await entry.rpc.prompt(`${prefix}${message}`);
			this.syncUsage(targetId);
			return result;
		} finally {
			if (fromId) {
				this.router.clearWaiting(fromId);
			}
		}
	}

	/** Send a message to an agent in the background (non-blocking — returns immediately). */
	async sendAsync(targetId: string, message: string, fromId?: string): Promise<number> {
		const entry = this.agents.get(targetId);
		if (!entry) throw new Error(`Agent "${targetId}" not found in pool`);
		if (entry.node.state === "dead") throw new Error(`Agent "${targetId}" is dead`);
		if (entry.node.state === "streaming") throw new Error(`Agent "${targetId}" is busy processing another prompt`);

		if (fromId && this.router.wouldCycle(fromId, targetId)) {
			throw new Error(`Deadlock detected: ${fromId} → ${targetId} would create a cycle.`);
		}
		if (fromId) this.router.markWaiting(fromId, targetId);

		entry.node.state = "streaming";
		const prefix = fromId ? `Message from ${fromId}: ` : "";

		const opId = this.nextOpId++;
		const op: InternalPendingOp = {
			opId,
			agentId: targetId,
			type: "send",
			startedAt: Date.now(),
			settled: false,
			promise: null!,
		};

		op.promise = entry.rpc.prompt(`${prefix}${message}`)
			.then(result => {
				this.syncUsage(targetId);
				op.settled = true;
				op.result = result;
			})
			.catch(err => {
				op.settled = true;
				op.error = err instanceof Error ? err : new Error(String(err));
				entry.node.state = "idle";
			})
			.finally(() => {
				if (fromId) this.router.clearWaiting(fromId);
			});

		this.pendingOps.set(opId, op);
		this.log("pool-send-async", { targetId, opId });
		return opId;
	}

	/** Return all completed async operations and remove them from the pending queue. */
	poll(): PendingOpResult[] {
		const settled: PendingOpResult[] = [];
		for (const [id, op] of this.pendingOps) {
			if (op.settled) {
				settled.push({
					opId: op.opId,
					agentId: op.agentId,
					type: op.type,
					startedAt: op.startedAt,
					response: op.result?.response,
					error: op.error?.message,
				});
				this.pendingOps.delete(id);
			}
		}
		return settled;
	}

	/** Wait until at least one async operation completes, then return all completed. */
	async waitAny(timeout?: number): Promise<PendingOpResult[]> {
		// Check already settled first
		const alreadySettled = this.poll();
		if (alreadySettled.length > 0) return alreadySettled;

		// Nothing pending at all?
		if (this.pendingOps.size === 0) return [];

		// Wait for any one to settle
		const ops = [...this.pendingOps.values()];
		const racePromises: Promise<void>[] = ops.map(op => op.promise);

		if (timeout && timeout > 0) {
			let timer: ReturnType<typeof setTimeout>;
			const timeoutPromise = new Promise<void>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`Wait timed out after ${timeout}ms`)), timeout);
			});
			try {
				await Promise.race([...racePromises, timeoutPromise]);
			} catch (err: any) {
				if (err?.message?.startsWith("Wait timed out")) {
					// Return whatever settled during the wait
					const partial = this.poll();
					if (partial.length > 0) return partial;
					throw err;
				}
				// Op failure — that's fine, it settled with an error
			} finally {
				clearTimeout(timer!);
			}
		} else {
			try {
				await Promise.race(racePromises);
			} catch {
				// Op failure — that's fine, it settled with an error
			}
		}

		// Collect everything that settled
		return this.poll();
	}

	/** Number of async operations still in progress. */
	get pendingCount(): number {
		let count = 0;
		for (const op of this.pendingOps.values()) {
			if (!op.settled) count++;
		}
		return count;
	}

	/** List all agents in the pool. */
	list(): PoolEntry[] {
		return Array.from(this.agents.values()).map(({ node }) => ({
			id: node.id,
			agentName: node.agentName,
			state: node.state,
			parentId: node.parentId,
			childIds: [...node.childIds],
			depth: node.depth,
			startedAt: node.startedAt,
			usage: { ...node.usage },
			model: node.model,
			task: node.task,
		}));
	}

	/** Get a specific agent's info. */
	get(id: string): PoolEntry | null {
		const entry = this.agents.get(id);
		if (!entry) return null;
		const { node } = entry;
		return {
			id: node.id,
			agentName: node.agentName,
			state: node.state,
			parentId: node.parentId,
			childIds: [...node.childIds],
			depth: node.depth,
			startedAt: node.startedAt,
			usage: { ...node.usage },
			model: node.model,
			task: node.task,
		};
	}

	/** Kill an agent and all its children (recursive). */
	async kill(id: string): Promise<void> {
		const entry = this.agents.get(id);
		if (!entry) return;

		// Kill children first (depth-first)
		for (const childId of [...entry.node.childIds]) {
			await this.kill(childId);
		}

		entry.rpc.kill();
		entry.node.state = "dead";

		// Remove from parent's children
		if (entry.node.parentId) {
			const parent = this.agents.get(entry.node.parentId);
			if (parent) {
				parent.node.childIds = parent.node.childIds.filter(c => c !== id);
			}
		}

		this.agents.delete(id);
		this.log("pool-kill", { id });
	}

	/** Kill all agents and shut down. */
	async killAll(): Promise<void> {
		// Kill in reverse order (children before parents)
		const ids = Array.from(this.agents.keys());
		for (const id of ids.reverse()) {
			const entry = this.agents.get(id);
			if (entry) {
				entry.rpc.kill();
				entry.node.state = "dead";
			}
		}
		this.agents.clear();
		this.router.reset();
		this.log("pool-kill-all", {});
	}

	/** Total usage across all agents (alive and dead). */
	totalUsage(): UsageStats {
		const t: UsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
		for (const { node } of this.agents.values()) {
			t.input += node.usage.input;
			t.output += node.usage.output;
			t.cacheRead += node.usage.cacheRead;
			t.cacheWrite += node.usage.cacheWrite;
			t.cost += node.usage.cost;
			t.contextTokens += node.usage.contextTokens;
			t.turns += node.usage.turns;
		}
		return t;
	}

	get size(): number { return this.agents.size; }

	/** Full teardown. */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.killAll();
		this.server?.dispose();
		this.server = null;
	}

	// ── IPC request handler (called by PoolServer) ──────────────

	private async handleIpcRequest(req: PoolIpcRequest): Promise<PoolIpcResponse> {
		const reply = (success: boolean, data?: string, error?: string): PoolIpcResponse => ({
			requestId: req.requestId,
			success,
			data,
			error,
		});

		try {
			switch (req.action) {
				case "spawn": {
					if (!req.agentName || !req.task || !req.spawnId) {
						return reply(false, undefined, "spawn requires agentName, task, and spawnId");
					}
					const agentConfig = this.allAgentConfigs.find(a => a.name === req.agentName);
					if (!agentConfig) {
						return reply(false, undefined, `Unknown agent: ${req.agentName}. Available: ${this.allAgentConfigs.map(a => a.name).join(", ")}`);
					}
					const result = await this.spawn({
						id: req.spawnId,
						agent: agentConfig,
						task: req.task,
						cwd: this.cwd,
						parentId: req.agentId,
					});
					return reply(true, result.response);
				}

				case "send": {
					if (!req.targetId || !req.message) {
						return reply(false, undefined, "send requires targetId and message");
					}
					const result = await this.send(req.targetId, req.message, req.agentId);
					return reply(true, result.response);
				}

				case "kill": {
					const killId = req.killId ?? req.targetId;
					if (!killId) {
						return reply(false, undefined, "kill requires killId");
					}
					// Only allow killing own children (or self)
					const requester = this.agents.get(req.agentId);
					const target = this.agents.get(killId);
					if (!target) return reply(false, undefined, `Agent "${killId}" not found`);
					if (requester && !this.isAncestor(req.agentId, killId) && req.agentId !== killId) {
						return reply(false, undefined, `Agent "${req.agentId}" can only kill its own descendants`);
					}
					await this.kill(killId);
					return reply(true, `Agent "${killId}" killed`);
				}

				case "list": {
					const agents = this.list();
					const summary = agents.map(a =>
						`${a.id} (${a.agentName}) [${a.state}] depth=${a.depth} parent=${a.parentId ?? "none"}`
					).join("\n");
					return reply(true, summary || "(no agents)");
				}

				default:
					return reply(false, undefined, `Unknown action: ${req.action}`);
			}
		} catch (err: any) {
			this.log("pool-ipc-error", { action: req.action, agentId: req.agentId, error: err?.message }, "ERROR");
			return reply(false, undefined, err?.message ?? "Unknown error");
		}
	}

	// ── Helpers ─────────────────────────────────────────────────

	/** Check if `ancestorId` is a (transitive) ancestor of `descendantId`. */
	private isAncestor(ancestorId: string, descendantId: string): boolean {
		let current = this.agents.get(descendantId);
		while (current?.node.parentId) {
			if (current.node.parentId === ancestorId) return true;
			current = this.agents.get(current.node.parentId);
		}
		return false;
	}

	/** Sync usage stats from RpcAgent into the PoolAgentNode. */
	private syncUsage(id: string): void {
		const entry = this.agents.get(id);
		if (!entry) return;
		const rpcUsage = entry.rpc.usage;
		entry.node.usage = { ...rpcUsage };
		if (entry.rpc.model) entry.node.model = entry.rpc.model;
		entry.node.state = entry.rpc.state;
	}
}
