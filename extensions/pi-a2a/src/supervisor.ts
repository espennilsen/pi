/**
 * pi-a2a — Loop control supervisor.
 *
 * Pure-function supervisor that inspects A2A message/task metadata for
 * loop-control fields (under `pi:` prefix) and enforces safety policies:
 *
 *   1. Hop count — incremented at each agent, rejected if > maxHops
 *   2. Cycle detection — reject if this agent already appears in visitedAgents
 *   3. Budget limits — configurable maxHops (extensible to maxCalls, maxTokens)
 *
 * Metadata keys (spec-compliant transparent extensions — ignored by agents
 * that don't understand them):
 *   - `pi:hopCount` (number)  — incremented at each hop
 *   - `pi:visitedAgents` (string[]) — agent identities (URLs) visited so far
 *   - `pi:budgets` ({ maxHops?, maxCalls?, maxTokens? }) — configurable limits
 *
 * The supervisor is called in two places:
 *   - Inbound: before AgentExecutor.execute() processes a task
 *   - Outbound: to seed/propagate metadata on a2a_send messages
 */

// ── Types ───────────────────────────────────────────────────────

/** Budget constraints carried in message metadata. */
export interface LoopBudgets {
	/** Maximum number of hops (agent transitions) allowed. */
	maxHops?: number;
	/** Maximum total calls (reserved for future use). */
	maxCalls?: number;
	/** Maximum total tokens (reserved for future use). */
	maxTokens?: number;
}

/** Loop-control metadata extracted from A2A message/task metadata. */
export interface LoopMetadata {
	/** Current hop count (incremented at each agent). */
	hopCount: number;
	/** Agent identities (URLs) visited so far. */
	visitedAgents: string[];
	/** Budget constraints. */
	budgets?: LoopBudgets;
}

/** Supervisor configuration. */
export interface SupervisorConfig {
	/** This agent's identity (canonical URL — uniquely identifies the agent). */
	agentId: string;
	/** Default max hops when not specified in message budgets. */
	defaultMaxHops: number;
}

/** Result of a supervisor check. */
export interface SupervisorResult {
	/** Whether the task is approved for processing. */
	approved: boolean;
	/** Human-readable reason for rejection (only set when approved=false). */
	reason?: string;
	/** Updated metadata to carry forward (always set). */
	metadata: LoopMetadata;
}

// ── Default ─────────────────────────────────────────────────────

export const DEFAULT_MAX_HOPS = 10;
/** Cap on visitedAgents array length to bound memory from untrusted input. */
const MAX_VISITED_AGENTS = 64;

// ── Extract / Inject ────────────────────────────────────────────

/**
 * Extract loop-control metadata from an A2A metadata record.
 * Returns zero-state if no metadata or no pi: fields present.
 */
export function extractLoopMetadata(
	metadata?: Record<string, unknown> | null,
): LoopMetadata {
	if (!metadata) return { hopCount: 0, visitedAgents: [] };

	const hopCount =
		typeof metadata["pi:hopCount"] === "number"
			? (metadata["pi:hopCount"] as number)
			: 0;

	const visitedAgents = Array.isArray(metadata["pi:visitedAgents"])
		? (metadata["pi:visitedAgents"] as string[]).filter((v) => typeof v === "string").slice(0, MAX_VISITED_AGENTS)
		: [];

	const rawBudgets = metadata["pi:budgets"];
	let budgets: LoopBudgets | undefined;
	if (rawBudgets && typeof rawBudgets === "object" && !Array.isArray(rawBudgets)) {
		const b = rawBudgets as Record<string, unknown>;
		budgets = {};
		if (typeof b.maxHops === "number") budgets.maxHops = b.maxHops;
		if (typeof b.maxCalls === "number") budgets.maxCalls = b.maxCalls;
		if (typeof b.maxTokens === "number") budgets.maxTokens = b.maxTokens;
		// Drop empty budgets object
		if (budgets.maxHops === undefined && budgets.maxCalls === undefined && budgets.maxTokens === undefined) {
			budgets = undefined;
		}
	}

	return { hopCount, visitedAgents, budgets };
}

/**
 * Inject loop-control metadata into an existing metadata record.
 * Preserves all existing keys, overwriting only pi: loop-control fields.
 */
export function injectLoopMetadata(
	existing: Record<string, unknown> | undefined,
	loop: LoopMetadata,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...(existing ?? {}) };
	result["pi:hopCount"] = loop.hopCount;
	result["pi:visitedAgents"] = loop.visitedAgents;
	if (loop.budgets) {
		result["pi:budgets"] = loop.budgets;
	}
	return result;
}

// ── Supervisor ──────────────────────────────────────────────────

/**
 * Run supervisor checks on incoming loop metadata.
 *
 * Called before AgentExecutor processes a task. Returns approved=true
 * with updated metadata (incremented hopCount, self added to visitedAgents)
 * or approved=false with a rejection reason.
 */
export function supervise(
	incoming: LoopMetadata,
	config: SupervisorConfig,
): SupervisorResult {
	// Cap incoming budget at the server's own limit — untrusted callers
	// must not be able to override the configured hop ceiling.
	const maxHops = incoming.budgets?.maxHops !== undefined
		? Math.min(incoming.budgets.maxHops, config.defaultMaxHops)
		: config.defaultMaxHops;

	// ── 1. Cycle detection ──────────────────────────────────────
	// Check BEFORE incrementing — if we've been visited before, it's a cycle
	if (incoming.visitedAgents.includes(config.agentId)) {
		const chain = [...incoming.visitedAgents, config.agentId].join(" → ");
		return {
			approved: false,
			reason: `Cycle detected: agent "${config.agentId}" already visited. Chain: ${chain}`,
			metadata: {
				hopCount: incoming.hopCount + 1,
				visitedAgents: [...incoming.visitedAgents, config.agentId],
				budgets: incoming.budgets,
			},
		};
	}

	// ── 2. Hop count ────────────────────────────────────────────
	const newHopCount = incoming.hopCount + 1;
	if (newHopCount > maxHops) {
		return {
			approved: false,
			reason: `Hop limit exceeded: ${newHopCount} > ${maxHops} (max). Chain: ${incoming.visitedAgents.join(" → ")}`,
			metadata: {
				hopCount: newHopCount,
				visitedAgents: [...incoming.visitedAgents, config.agentId],
				budgets: incoming.budgets,
			},
		};
	}

	// ── 3. Approved ─────────────────────────────────────────────
	return {
		approved: true,
		metadata: {
			hopCount: newHopCount,
			visitedAgents: [...incoming.visitedAgents, config.agentId],
			budgets: incoming.budgets,
		},
	};
}

/**
 * Create seed metadata for an outbound message initiated by this agent
 * (not a response to an inbound task — fresh chain).
 */
export function seedLoopMetadata(
	agentId: string,
	maxHops?: number,
): LoopMetadata {
	return {
		hopCount: 0,
		visitedAgents: [agentId],
		budgets: maxHops !== undefined ? { maxHops } : undefined,
	};
}
