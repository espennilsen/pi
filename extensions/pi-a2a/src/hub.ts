/**
 * pi-a2a — A2A Hub registration client.
 *
 * Registers the pi agent with an A2A Discovery Hub using its
 * JSON-RPC 2.0 API. Hub config comes from settings.json.
 *
 * The hub only needs the agent's public URL — it fetches the Agent Card
 * from /.well-known/agent.json itself. Optionally, the agent's API key
 * is sent as `credential` so the hub can share it with other agents
 * that need to call this agent.
 */

import type { HubConfig, RemoteAgentSummary, RemoteAgentDetail, TelemetrySnapshot, PushEventPayload, PushEventType, AgentSelectionResult, AgentStrategy, ProjectSettings, PipelineStreamEvent } from "./types.ts";

export type PipelineState = "queued" | "planning" | "building" | "reviewing" | "pr_ready" | "blocked" | "approved" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "critical";

export interface HubTask {
	id: string;
	title: string;
	description: string | null;
	projectId: string | null;
	/** Legacy alias kept for existing UI rendering paths. */
	project: string | null;
	repo: string | null;
	state: PipelineState;
	priority: TaskPriority;
	assignedAgentId: string | null;
	createdBy: string;
	externalTaskId: string | null;
	branch: string | null;
	prUrl: string | null;
	prNumber: number | null;
	reportPath: string | null;
	blockedReason: string | null;
	reviewRound: number;
	maxReviewRounds: number;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	startedAt: string | null;
	completedAt: string | null;
	leaseOwnerAgentId: string | null;
	leaseOwnerInstanceId: string | null;
	leaseExpiresAt: string | null;
}

export type PipelineTask = HubTask;

export interface ClaimTaskParams {
	agentId: string;
	instanceId: string;
	taskId?: string;
	projectId?: string;
	/** Defaults to 900 seconds, max 86400 seconds. */
	leaseDurationSeconds?: number;
}

export interface ClaimTaskResult {
	task: PipelineTask | null;
	claimed: boolean;
}

export interface TaskHeartbeatParams {
	agentId: string;
	instanceId: string;
	taskId: string;
	/** Defaults to 900 seconds, max 86400 seconds. */
	leaseDurationSeconds?: number;
}

export interface TaskHeartbeatResult {
	task: PipelineTask;
	renewed: boolean;
}

export interface HubTaskTransition {
	id: string;
	taskId: string;
	fromState: PipelineState | null;
	toState: PipelineState;
	actorAgentId: string | null;
	actorUserId: string | null;
	note: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
}
import type { LogFn } from "./logger.ts";

interface HubRpcResponse {
	jsonrpc: "2.0";
	result?: Record<string, unknown>;
	error?: { code: number; message: string; data?: unknown };
	id: number;
}

export class HubRpcError extends Error {
	code: number;
	data?: unknown;

	constructor(code: number, message: string, data?: unknown) {
		super(message);
		this.name = "HubRpcError";
		this.code = code;
		this.data = data;
	}
}

// ── Helpers ─────────────────────────────────────────────────────

function hubRpcUrl(hubConfig: HubConfig): string {
	return `${hubConfig.url.replace(/\/$/, "")}/rpc`;
}

async function hubRpcResponse(
	rpcUrl: string,
	method: string,
	params: Record<string, unknown>,
	hubApiKey: string,
	log: LogFn,
	logPrefix: string,
): Promise<HubRpcResponse | null> {
	const payload = { jsonrpc: "2.0" as const, method, params, id: 1 };

	try {
		const res = await fetch(rpcUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": hubApiKey,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000),
		});

		if (!res.ok) {
			const text = await res.text();
			log(`${logPrefix}_http_error`, { status: res.status, body: text.slice(0, 500) }, "ERROR");
			return null;
		}

		return (await res.json()) as HubRpcResponse;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log(`${logPrefix}_error`, { error: msg }, "ERROR");
		return null;
	}
}

async function hubRpc(
	rpcUrl: string,
	method: string,
	params: Record<string, unknown>,
	hubApiKey: string,
	log: LogFn,
	logPrefix: string,
): Promise<Record<string, unknown> | null> {
	const data = await hubRpcResponse(rpcUrl, method, params, hubApiKey, log, logPrefix);
	if (!data) return null;

	if (data.error) {
		log(`${logPrefix}_rpc_error`, { code: data.error.code, message: data.error.message, data: data.error.data }, "ERROR");
		return null;
	}

	if (data.result) {
		return data.result;
	}

	log(`${logPrefix}_unexpected`, { response: JSON.stringify(data).slice(0, 500) }, "WARN");
	return null;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Register this agent with the A2A Hub.
 *
 * Sends the agent's public URL plus hub-specific metadata (categories,
 * tags, visibility). The hub fetches and validates the Agent Card from
 * the agent's /.well-known/agent.json endpoint.
 *
 * Does NOT send credentials inline — use `setCredentialOnHub` after
 * registration to store credentials separately.
 *
 * If the agent is already registered (conflict), falls back to finding
 * the existing agent by URL and returns its agentId.
 */
export async function registerWithHub(
	agentUrl: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ agentId: string; status: string } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	const params: Record<string, unknown> = {
		url: agentUrl,
		category: hubConfig.categories ?? ["development-tools"],
		tags: hubConfig.tags ?? [],
		visibility: hubConfig.visibility ?? "public",
	};

	log("hub_register_start", { url: rpcUrl, agentUrl });

	const result = await hubRpc(rpcUrl, "agents.register", params, hubConfig.apiKey, log, "hub_register");
	if (result) {
		const agentId = result.agentId as string;
		const status = result.status as string;
		log("hub_register_success", { agentId, status });
		return { agentId, status };
	}

	// Registration failed — check if it was a conflict (already registered).
	// hubRpc already logged the error; try to find the existing agent by URL.
	const existing = await findAgentByUrl(agentUrl, hubConfig, log);
	if (existing) {
		log("hub_register_existing", { agentId: existing.agentId, url: agentUrl });
		return { agentId: existing.agentId, status: "existing" };
	}

	return null;
}

/** Deregister an agent instance from the hub (e.g., on session shutdown). */
export async function deregisterFromHub(
	agentId: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<boolean> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(
		rpcUrl,
		"agents.deregister",
		{ agentId },
		hubConfig.apiKey,
		log,
		"hub_deregister",
	);
	if (result) {
		log("hub_deregister_success", { agentId });
		return true;
	}
	return false;
}

/**
 * Find an agent on the hub by its URL.
 *
 * Searches agents and matches by URL. Returns the agentId if found.
 */
async function findAgentByUrl(
	agentUrl: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ agentId: string } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	// Search with a generous limit — we'll filter by URL client-side
	const result = await hubRpc(rpcUrl, "agents.search", { limit: 100 }, hubConfig.apiKey, log, "hub_find_by_url");
	if (!result) return null;

	const agents = result.agents as Array<{ id: string; url: string }>;
	const match = agents.find((a) => a.url === agentUrl);
	if (match) {
		return { agentId: match.id };
	}

	log("hub_find_by_url_not_found", { url: agentUrl }, "WARN");
	return null;
}

/**
 * Search for agents on the hub.
 *
 * Wraps `agents.search` — returns a paginated list of agent summaries
 * matching the query, categories, or tags.
 */
export async function discoverAgentsOnHub(
	hubConfig: HubConfig,
	log: LogFn,
	options?: { q?: string; category?: string[]; tags?: string[]; limit?: number },
): Promise<{ agents: RemoteAgentSummary[]; total: number } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const params: Record<string, unknown> = {};
	if (options?.q) params.q = options.q;
	if (options?.category?.length) params.category = options.category;
	if (options?.tags?.length) params.tags = options.tags;
	if (options?.limit) params.limit = options.limit;

	log("hub_discover_start", { q: options?.q ?? "*" });

	const result = await hubRpc(rpcUrl, "agents.search", params, hubConfig.apiKey, log, "hub_discover");
	if (result) {
		return {
			agents: result.agents as RemoteAgentSummary[],
			total: result.total as number,
		};
	}
	return null;
}

/**
 * Get full agent detail from the hub by ID.
 */
export async function getAgentFromHub(
	agentId: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<RemoteAgentDetail | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	const result = await hubRpc(rpcUrl, "agents.get", { agentId }, hubConfig.apiKey, log, "hub_get_agent");
	if (result) {
		return result as unknown as RemoteAgentDetail;
	}
	return null;
}

/**
 * Retrieve the stored credential for a remote agent.
 *
 * Only works for agents owned by the authenticated user (or admin).
 * Returns the decrypted plaintext credential.
 */
export async function getCredentialFromHub(
	agentId: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ credential: string | null; hasCredential: boolean } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	log("hub_get_credential_start", { agentId });

	const result = await hubRpc(rpcUrl, "agents.getCredential", { agentId }, hubConfig.apiKey, log, "hub_get_credential");
	if (result) {
		return {
			credential: (result.credential as string | null) ?? null,
			hasCredential: result.hasCredential as boolean,
		};
	}
	return null;
}

/**
 * Update the credential stored on the hub for this agent.
 *
 * Uses the dedicated `agents.setCredential` method so the agent card
 * and other metadata are left untouched.
 *
 * Pass `null` as credential to remove the stored credential.
 */
export async function setCredentialOnHub(
	agentId: string,
	credential: string | null,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ agentId: string; hasCredential: boolean; credentialUpdatedAt: string | null } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	log("hub_set_credential_start", { agentId, action: credential === null ? "remove" : "set" });

	const result = await hubRpc(
		rpcUrl,
		"agents.setCredential",
		{ agentId, credential },
		hubConfig.apiKey,
		log,
		"hub_set_credential",
	);
	if (result) {
		const out = {
			agentId: result.agentId as string,
			hasCredential: result.hasCredential as boolean,
			credentialUpdatedAt: (result.credentialUpdatedAt as string | null) ?? null,
		};
		log("hub_set_credential_success", out);
		return out;
	}
	return null;
}

// ── Clarification (Human-in-the-Loop) ───────────────────────

export interface ClarificationRequest {
	clarificationId: string;
	status: "pending";
	createdAt: string;
	expiresAt: string | null;
}

export interface ClarificationPollResult {
	clarificationId: string;
	status: "pending" | "answered" | "expired" | "cancelled";
	response: string | null;
	answeredAt: string | null;
}

/**
 * Request clarification from the agent owner via the A2A Hub.
 *
 * Sends a question to the hub which the owner can answer through the
 * hub's web UI. Returns the clarification ID for polling.
 */
export async function requestClarification(
	agentId: string,
	question: string,
	hubConfig: HubConfig,
	log: LogFn,
	options?: {
		context?: Record<string, unknown>;
		handoff?: Record<string, unknown>;
		priority?: "low" | "normal" | "urgent";
		expiresIn?: number;
	},
): Promise<ClarificationRequest | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	const params: Record<string, unknown> = { agentId, question };
	if (options?.context) params.context = options.context;
	if (options?.handoff) params.handoff = options.handoff;
	if (options?.priority) params.priority = options.priority;
	if (options?.expiresIn) params.expiresIn = options.expiresIn;

	log("hub_clarification_request_start", { agentId, questionLength: question.length, priority: options?.priority ?? "normal" });

	const result = await hubRpc(rpcUrl, "clarification.request", params, hubConfig.apiKey, log, "hub_clarification_request");
	if (result) {
		const out: ClarificationRequest = {
			clarificationId: result.clarificationId as string,
			status: "pending",
			createdAt: result.createdAt as string,
			expiresAt: (result.expiresAt as string | null) ?? null,
		};
		log("hub_clarification_request_success", { clarificationId: out.clarificationId });
		return out;
	}
	return null;
}

/**
 * Poll the hub for a clarification response.
 *
 * Returns the current status. When status is "answered", the response
 * field contains the owner's reply.
 */
export async function pollClarification(
	agentId: string,
	clarificationId: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<ClarificationPollResult | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	const result = await hubRpc(rpcUrl, "clarification.poll", { agentId, clarificationId }, hubConfig.apiKey, log, "hub_clarification_poll");
	if (result) {
		return {
			clarificationId: result.clarificationId as string,
			status: result.status as ClarificationPollResult["status"],
			response: (result.response as string | null) ?? null,
			answeredAt: (result.answeredAt as string | null) ?? null,
		};
	}
	return null;
}

/**
 * Cancel a pending clarification request.
 */
export async function cancelClarification(
	agentId: string,
	clarificationId: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<boolean> {
	const rpcUrl = hubRpcUrl(hubConfig);

	log("hub_clarification_cancel", { agentId, clarificationId });

	const result = await hubRpc(rpcUrl, "clarification.cancel", { agentId, clarificationId }, hubConfig.apiKey, log, "hub_clarification_cancel");
	return result !== null;
}

// ── Answered clarification types ─────────────────────────────

export interface AnsweredClarification {
	clarificationId: string;
	question: string;
	handoff: Record<string, unknown> | null;
	context: Record<string, unknown> | null;
	priority: "low" | "normal" | "urgent";
	response: string;
	answeredAt: string;
	createdAt: string;
}

/**
 * List all answered but unacknowledged clarifications for this agent.
 *
 * Returns the full payload for each (question, handoff context, owner
 * response) so a fresh subprocess can resume work without local state.
 */
export async function listAnsweredClarifications(
	agentId: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<AnsweredClarification[]> {
	const rpcUrl = hubRpcUrl(hubConfig);

	log("hub_clarification_list_answered_start", { agentId });

	const result = await hubRpc(rpcUrl, "clarification.list_answered", { agentId }, hubConfig.apiKey, log, "hub_clarification_list_answered");
	if (result && Array.isArray(result.clarifications)) {
		const items: AnsweredClarification[] = [];
		for (const c of result.clarifications as unknown[]) {
			// Guard against null or non-object elements from hub
			if (!c || typeof c !== "object") {
				log("hub_clarification_list_answered_skip_non_object", { raw: JSON.stringify(c).slice(0, 100) }, "WARN");
				continue;
			}
			const rec = c as Record<string, unknown>;
			const clarificationId = (rec.clarificationId as string) ?? "";
			// Skip malformed items — without a clarificationId we can't
			// acknowledge them, which would cause an infinite retry loop.
			if (!clarificationId) {
				log("hub_clarification_list_answered_skip_malformed", { raw: JSON.stringify(rec).slice(0, 200) }, "WARN");
				continue;
			}
			items.push({
				clarificationId,
				question: (rec.question as string) ?? "",
				handoff: (rec.handoff as Record<string, unknown> | null) ?? null,
				context: (rec.context as Record<string, unknown> | null) ?? null,
				priority: (rec.priority as "low" | "normal" | "urgent") ?? "normal",
				response: (rec.response as string) ?? "",
				answeredAt: (rec.answeredAt as string) ?? "",
				createdAt: (rec.createdAt as string) ?? "",
			});
		}
		log("hub_clarification_list_answered_success", { agentId, count: items.length });
		return items;
	}
	return [];
}

/**
 * Acknowledge a clarification so it won't appear in future list_answered calls.
 *
 * Atomic: if two agents race, only the first acknowledgement succeeds
 * (subsequent calls return ok but acknowledged=false).
 */
export async function acknowledgeClarification(
	agentId: string,
	clarificationId: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<boolean> {
	const rpcUrl = hubRpcUrl(hubConfig);

	log("hub_clarification_acknowledge", { agentId, clarificationId });

	const result = await hubRpc(rpcUrl, "clarification.acknowledge", { agentId, clarificationId }, hubConfig.apiKey, log, "hub_clarification_acknowledge");
	if (result) {
		const acknowledged = (result.acknowledged as boolean) ?? false;
		log("hub_clarification_acknowledge_result", { clarificationId, acknowledged });
		return acknowledged;
	}
	return false;
}

/**
 * Report pipeline task status to the A2A Hub.
 *
 * Called by coding agents when the state of a hub-assigned task changes
 * (e.g. started planning, opened a PR, got blocked). The hub uses this
 * to track the full pipeline; local td state is separate.
 */
export async function reportPipelineStatus(
	hubTaskId: string,
	toState: PipelineState,
	hubConfig: HubConfig,
	log: LogFn,
	options?: {
		note?: string;
		externalTaskId?: string;
		branch?: string;
		prUrl?: string;
		prNumber?: number;
		blockedReason?: string;
		metadata?: Record<string, unknown>;
	},
): Promise<{ id: string; state: string; updatedAt: string } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	const params: Record<string, unknown> = { hubTaskId, toState };
	if (options?.note !== undefined) params.note = options.note;
	if (options?.externalTaskId !== undefined) params.externalTaskId = options.externalTaskId;
	if (options?.branch !== undefined) params.branch = options.branch;
	if (options?.prUrl !== undefined) params.prUrl = options.prUrl;
	if (options?.prNumber !== undefined) params.prNumber = options.prNumber;
	if (options?.blockedReason !== undefined) params.blockedReason = options.blockedReason;
	if (options?.metadata !== undefined) params.metadata = options.metadata;

	log("hub_pipeline_status_start", { hubTaskId, toState });

	const result = await hubRpc(rpcUrl, "tasks.reportStatus", params, hubConfig.apiKey, log, "hub_pipeline_status");
	if (result) {
		const out = {
			id: result.id as string,
			state: result.state as string,
			updatedAt: result.updatedAt as string,
		};
		log("hub_pipeline_status_success", out);
		return out;
	}
	return null;
}

/**
 * Report telemetry to the A2A Hub.
 *
 * Sends the agent's current operational state (queue depth, active tasks,
 * response times) so the hub can compute availability and rank agents
 * in search results. If the agent doesn't report for 5 minutes, the hub
 * resets its telemetry to unknown.
 */
export async function reportTelemetryToHub(
	agentId: string,
	telemetry: TelemetrySnapshot,
	hubConfig: HubConfig,
	log: LogFn,
	instanceId?: string,
): Promise<{ telemetryUpdatedAt: string } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	const params: Record<string, unknown> = {
		agentId,
		queueDepth: telemetry.queueDepth,
		activeTasks: telemetry.activeTasks,
		maxConcurrent: telemetry.maxConcurrent,
	};
	if (instanceId !== undefined) {
		params.instanceId = instanceId;
	}
	if (telemetry.lastTaskDurationMs !== undefined) {
		params.lastTaskDurationMs = telemetry.lastTaskDurationMs;
	}
	if (telemetry.lastTaskStatus !== undefined) {
		params.lastTaskStatus = telemetry.lastTaskStatus;
	}
	if (telemetry.recentToolCalls !== undefined && telemetry.recentToolCalls.length > 0) {
		params.recentToolCalls = telemetry.recentToolCalls;
	}
	if (telemetry.costInfo !== undefined) {
		params.costInfo = telemetry.costInfo;
	}

	const result = await hubRpc(rpcUrl, "agents.reportTelemetry", params, hubConfig.apiKey, log, "hub_telemetry");
	if (result) {
		return { telemetryUpdatedAt: result.telemetryUpdatedAt as string };
	}
	return null;
}

// ── Pipeline Tasks ───────────────────────────────────────────

function asTask(r: Record<string, unknown>): HubTask {
	const projectId = (r.projectId as string | null | undefined) ?? (r.project as string | null | undefined) ?? null;
	const project = (r.project as string | null | undefined) ?? projectId;
	return {
		id: r.id as string,
		title: r.title as string,
		description: (r.description as string | null | undefined) ?? null,
		projectId,
		project: project ?? null,
		repo: (r.repo as string | null | undefined) ?? null,
		state: r.state as PipelineState,
		priority: r.priority as TaskPriority,
		assignedAgentId: (r.assignedAgentId as string | null | undefined) ?? null,
		createdBy: r.createdBy as string,
		externalTaskId: (r.externalTaskId as string | null | undefined) ?? null,
		branch: (r.branch as string | null | undefined) ?? null,
		prUrl: (r.prUrl as string | null | undefined) ?? null,
		prNumber: (r.prNumber as number | null | undefined) ?? null,
		reportPath: (r.reportPath as string | null | undefined) ?? null,
		blockedReason: (r.blockedReason as string | null | undefined) ?? null,
		reviewRound: (r.reviewRound as number | undefined) ?? 0,
		maxReviewRounds: (r.maxReviewRounds as number | undefined) ?? 0,
		metadata: (r.metadata as Record<string, unknown> | undefined) ?? {},
		createdAt: r.createdAt as string,
		updatedAt: r.updatedAt as string,
		startedAt: (r.startedAt as string | null | undefined) ?? null,
		completedAt: (r.completedAt as string | null | undefined) ?? null,
		leaseOwnerAgentId: (r.leaseOwnerAgentId as string | null | undefined) ?? null,
		leaseOwnerInstanceId: (r.leaseOwnerInstanceId as string | null | undefined) ?? null,
		leaseExpiresAt: (r.leaseExpiresAt as string | null | undefined) ?? null,
	};
}

function asTaskList(r: Record<string, unknown>): { tasks: HubTask[]; total: number; page: number; limit: number } {
	return {
		tasks: ((r.tasks as unknown[]) ?? []).map((t) => asTask(t as Record<string, unknown>)),
		total: (r.total as number) ?? 0,
		page: (r.page as number) ?? 1,
		limit: (r.limit as number) ?? 0,
	};
}

export async function createHubTask(
	params: {
		title: string;
		project: string;
		description?: string;
		repo?: string;
		priority?: TaskPriority;
		assignedAgentId?: string;
		metadata?: Record<string, unknown>;
	},
	hubConfig: HubConfig,
	log: LogFn,
): Promise<HubTask | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "tasks.create", params as Record<string, unknown>, hubConfig.apiKey, log, "tasks_create");
	return result ? asTask(result) : null;
}

export async function getHubTask(
	taskId: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<HubTask | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "tasks.get", { taskId }, hubConfig.apiKey, log, "tasks_get");
	return result ? asTask(result) : null;
}

export async function listHubTasks(
	params: {
		project?: string;
		state?: PipelineState;
		assignedAgentId?: string;
		priority?: TaskPriority;
		page?: number;
		limit?: number;
		includeTerminal?: boolean;
	},
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ tasks: HubTask[]; total: number; page: number; limit: number } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "tasks.list", params as Record<string, unknown>, hubConfig.apiKey, log, "tasks_list");
	return result ? asTaskList(result) : null;
}

export async function updateHubTask(
	params: {
		taskId: string;
		title?: string;
		description?: string;
		priority?: TaskPriority;
		assignedAgentId?: string | null;
		metadata?: Record<string, unknown>;
		externalTaskId?: string;
		branch?: string;
		prUrl?: string;
		prNumber?: number;
		blockedReason?: string;
	},
	hubConfig: HubConfig,
	log: LogFn,
): Promise<HubTask | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "tasks.update", params as Record<string, unknown>, hubConfig.apiKey, log, "tasks_update");
	return result ? asTask(result) : null;
}

export async function transitionHubTask(
	params: {
		taskId: string;
		toState: PipelineState;
		note?: string;
		metadata?: Record<string, unknown>;
		actorAgentId?: string;
	},
	hubConfig: HubConfig,
	log: LogFn,
): Promise<HubTask | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "tasks.transition", params as Record<string, unknown>, hubConfig.apiKey, log, "tasks_transition");
	return result ? asTask(result) : null;
}

export async function deleteHubTask(
	taskId: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ deleted: boolean; taskId: string } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "tasks.delete", { taskId }, hubConfig.apiKey, log, "tasks_delete");
	return result ? { deleted: result.deleted as boolean, taskId: result.taskId as string } : null;
}

export async function getHubTaskHistory(
	taskId: string,
	hubConfig: HubConfig,
	log: LogFn,
	limit = 50,
): Promise<{ taskId: string; transitions: HubTaskTransition[] } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "tasks.history", { taskId, limit }, hubConfig.apiKey, log, "tasks_history");
	if (!result) return null;
	return {
		taskId: result.taskId as string,
		transitions: ((result.transitions as unknown[]) ?? []).map((t) => t as HubTaskTransition),
	};
}

export async function getHubTaskBoard(
	params: { project?: string; assignedAgentId?: string },
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ board: Record<PipelineState, HubTask[]>; total: number; projects: string[] } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "tasks.board", params as Record<string, unknown>, hubConfig.apiKey, log, "tasks_board");
	if (!result) return null;
	return {
		board: (result.board as Record<PipelineState, HubTask[]>) ?? {},
		total: (result.total as number) ?? 0,
		projects: (result.projects as string[]) ?? [],
	};
}

export async function reportHubTaskStatus(
	params: {
		hubTaskId: string;
		toState: PipelineState;
		note?: string;
		externalTaskId?: string;
		branch?: string;
		prUrl?: string;
		prNumber?: number;
		blockedReason?: string;
		metadata?: Record<string, unknown>;
	},
	hubConfig: HubConfig,
	log: LogFn,
): Promise<HubTask | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "tasks.reportStatus", params as Record<string, unknown>, hubConfig.apiKey, log, "tasks_report_status");
	return result ? asTask(result) : null;
}

function normalizeLeaseDurationSeconds(leaseDurationSeconds?: number): number {
	const defaultLeaseDurationSeconds = 900;
	const maxLeaseDurationSeconds = 86_400;
	if (leaseDurationSeconds === undefined || Number.isNaN(leaseDurationSeconds)) {
		return defaultLeaseDurationSeconds;
	}
	return Math.min(Math.max(Math.floor(leaseDurationSeconds), 1), maxLeaseDurationSeconds);
}

function asClaimResult(r: Record<string, unknown>): ClaimTaskResult {
	const claimed = (r.claimed as boolean) ?? false;
	const rawTask = r.task;
	if (rawTask !== null && rawTask !== undefined && typeof rawTask !== "object") {
		throw new HubRpcError(-1, "Malformed claim response from hub");
	}
	if (claimed && (!rawTask || typeof rawTask !== "object")) {
		throw new HubRpcError(-1, "Malformed claim response from hub");
	}
	return {
		task: rawTask && typeof rawTask === "object" ? asTask(rawTask as Record<string, unknown>) : null,
		claimed,
	};
}

function asHeartbeatResult(r: Record<string, unknown>): TaskHeartbeatResult {
	const rawTask = r.task;
	if (!rawTask || typeof rawTask !== "object") {
		throw new HubRpcError(-1, "Malformed heartbeat response from hub");
	}
	return {
		task: asTask(rawTask as Record<string, unknown>),
		renewed: (r.renewed as boolean) ?? false,
	};
}

export async function claimHubTask(
	params: ClaimTaskParams,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<ClaimTaskResult> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpcResponse(
		rpcUrl,
		"tasks.claim",
		{
			agentId: params.agentId,
			instanceId: params.instanceId,
			...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
			...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
			leaseDurationSeconds: normalizeLeaseDurationSeconds(params.leaseDurationSeconds),
		},
		hubConfig.apiKey,
		log,
		"tasks_claim",
	);

	if (!result) {
		throw new HubRpcError(-1, "No response from hub");
	}

	if (result.error) {
		log("tasks_claim_rpc_error", { code: result.error.code, message: result.error.message, data: result.error.data }, "ERROR");
		throw new HubRpcError(result.error.code, result.error.message, result.error.data);
	}

	if (!result.result || typeof result.result !== "object") {
		throw new HubRpcError(-1, "Malformed claim response from hub");
	}

	return asClaimResult(result.result);
}

export async function heartbeatHubTask(
	params: TaskHeartbeatParams,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<TaskHeartbeatResult> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpcResponse(
		rpcUrl,
		"tasks.heartbeat",
		{
			agentId: params.agentId,
			instanceId: params.instanceId,
			taskId: params.taskId,
			leaseDurationSeconds: normalizeLeaseDurationSeconds(params.leaseDurationSeconds),
		},
		hubConfig.apiKey,
		log,
		"tasks_heartbeat",
	);

	if (!result) {
		throw new HubRpcError(-1, "No response from hub");
	}

	if (result.error) {
		log("tasks_heartbeat_rpc_error", { code: result.error.code, message: result.error.message, data: result.error.data }, "ERROR");
		throw new HubRpcError(result.error.code, result.error.message, result.error.data);
	}

	if (!result.result) {
		throw new HubRpcError(-1, "Malformed heartbeat response from hub");
	}

	return asHeartbeatResult(result.result);
}

// ── Push Notifications (Agent → Hub) ───────────────────────────────────────────

export interface RegisterPushEndpointParams {
	agentId: string;
	url: string;
	events: PushEventType[];
}

export interface RegisterPushEndpointResult {
	agentId: string;
	url: string;
	events: PushEventType[];
	message: string;
}

export async function registerPushEndpoint(
	params: RegisterPushEndpointParams,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<RegisterPushEndpointResult | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	
	const result = await hubRpc(
		rpcUrl,
		"telemetry.push.register",
		params as unknown as Record<string, unknown>,
		hubConfig.apiKey,
		log,
		"telemetry_push_register",
	);
	
	if (!result) return null;
	
	return {
		agentId: result.agentId as string,
		url: result.url as string,
		events: result.events as PushEventType[],
		message: result.message as string,
	};
}

export async function sendPushEvent(
	agentId: string,
	eventType: PushEventType,
	payload: PushEventPayload,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<boolean> {
	const rpcUrl = hubRpcUrl(hubConfig);
	
	const params: Record<string, unknown> = {
		agentId,
		eventType,
		payload: {
			...payload,
			timestamp: payload.timestamp || new Date().toISOString(),
		},
	};
	
	const result = await hubRpc(
		rpcUrl,
		"telemetry.push.handle",
		params,
		hubConfig.apiKey,
		log,
		"telemetry_push_event",
	);
	
	return !!result;
}

export async function sendTaskStateChanged(
	agentId: string,
	taskId: string,
	fromState: string | null,
	toState: string,
	hubConfig: HubConfig,
	log: LogFn,
	artifact?: unknown,
): Promise<boolean> {
	return sendPushEvent(
		agentId,
		"task.stateChanged",
		{
			taskId,
			fromState,
			toState,
			artifact,
			timestamp: new Date().toISOString(),
		},
		hubConfig,
		log,
	);
}

export async function sendTaskProgress(
	agentId: string,
	taskId: string,
	progress: number,
	message?: string,
	hubConfig?: HubConfig,
	log?: LogFn,
): Promise<boolean> {
	if (!hubConfig || !log) return false;
	
	return sendPushEvent(
		agentId,
		"task.progress",
		{
			taskId,
			progress: Math.min(100, Math.max(0, progress)),
			message,
			timestamp: new Date().toISOString(),
		},
		hubConfig,
		log,
	);
}

export async function sendTaskError(
	agentId: string,
	taskId: string,
	error: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<boolean> {
	return sendPushEvent(
		agentId,
		"task.error",
		{
			taskId,
			error,
			timestamp: new Date().toISOString(),
		},
		hubConfig,
		log,
	);
}

export async function sendHeartbeat(
	agentId: string,
	queueDepth: number,
	activeTasks: number,
	maxConcurrent: number,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<boolean> {
	return sendPushEvent(
		agentId,
		"heartbeat",
		{
			queueDepth,
			activeTasks,
			maxConcurrent,
			timestamp: new Date().toISOString(),
		},
		hubConfig,
		log,
	);
}
// ── Orchestrator ───────────────────────────────────────────

export async function selectAgent(
	params: {
		projectId: string;
		taskTags?: string[];
		taskType?: string;
		strategy?: string;
		eligibleAgentIds?: string[];
	},
	hubConfig: HubConfig,
	log: LogFn,
): Promise<AgentSelectionResult | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "orchestrator.selectAgent", params as Record<string, unknown>, hubConfig.apiKey, log, "orchestrator_select_agent");
	return result ? { agentId: result.agentId as string } : null;
}

export async function listStrategies(
	hubConfig: HubConfig,
	log: LogFn,
): Promise<AgentStrategy[] | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "orchestrator.listStrategies", {}, hubConfig.apiKey, log, "orchestrator_list_strategies");
	return result ? (result.strategies as AgentStrategy[]) ?? null : null;
}

export async function createProject(
	params: {
		project: string;
		displayName?: string;
		maxConcurrent?: number;
		stallTimeoutMs?: number;
		turnTimeoutMs?: number;
		maxRetryBackoffMs?: number;
		pollIntervalMs?: number;
		autoApprove?: boolean;
		inputRequiredPolicy?: "block" | "ask";
		eligibleAgents?: string[];
	},
	hubConfig: HubConfig,
	log: LogFn,
): Promise<ProjectSettings | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "projects.create", params as Record<string, unknown>, hubConfig.apiKey, log, "projects_create");
	return result ? (result as unknown as ProjectSettings) : null;
}

export async function getProject(
	params: { project: string },
	hubConfig: HubConfig,
	log: LogFn,
): Promise<ProjectSettings | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "projects.get", params as Record<string, unknown>, hubConfig.apiKey, log, "projects_get");
	return result ? (result as unknown as ProjectSettings) : null;
}

export async function listProjects(
	params: { page?: number; limit?: number } | undefined,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ projects: ProjectSettings[]; total: number; page: number; limit: number } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "projects.list", (params ?? {}) as Record<string, unknown>, hubConfig.apiKey, log, "projects_list");
	return result ? (result as { projects: ProjectSettings[]; total: number; page: number; limit: number }) : null;
}

export async function updateProject(
	params: {
		project: string;
		displayName?: string;
		maxConcurrent?: number;
		stallTimeoutMs?: number;
		turnTimeoutMs?: number;
		maxRetryBackoffMs?: number;
		pollIntervalMs?: number;
		autoApprove?: boolean;
		inputRequiredPolicy?: "block" | "ask";
		eligibleAgents?: string[];
	},
	hubConfig: HubConfig,
	log: LogFn,
): Promise<ProjectSettings | null> {
	const rpcUrl = hubRpcUrl(hubConfig);
	const result = await hubRpc(rpcUrl, "projects.update", params as Record<string, unknown>, hubConfig.apiKey, log, "projects_update");
	return result ? (result as unknown as ProjectSettings) : null;
}

// ── SSE Stream ───────────────────────────────────────────

export interface SSEStreamOptions {
	project?: string;
	assignedAgentId?: string;
	states?: string[];
}

export async function connectToPipelineStream(
	options: SSEStreamOptions | undefined,
	hubConfig: HubConfig,
): Promise<{ url: string }> {
	const baseUrl = hubConfig.url.replace(/\/$/, "");
	// Normalize: avoid double /api when hubConfig.url already ends with /api
	const apiBase = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
	const params = new URLSearchParams();
	
	if (options?.project) params.append("project", options.project);
	if (options?.assignedAgentId) params.append("assignedAgentId", options.assignedAgentId);
	if (options?.states?.length) params.append("states", options.states.join(","));
	
	const queryString = params.toString();
	const url = queryString 
		? `${apiBase}/v1/pipeline/stream?${queryString}`
		: `${apiBase}/v1/pipeline/stream`;
	
	return { url };
}

export interface SSEEventCallback {
	(event: PipelineStreamEvent): void;
}

export async function listenToSSEStream(
	url: string,
	callback: SSEEventCallback,
	log: LogFn,
	apiKey: string,
): Promise<{ abort: () => void }> {
	const controller = new AbortController();
	let reconnectAttempts = 0;
	const maxReconnectDelay = 30_000;
	
	/** Background read loop — processes SSE events with reconnect on close/error. */
	const runReadLoop = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> => {
		const decoder = new TextDecoder();
		let buffer = "";
		
		try {
			while (!controller.signal.aborted) {
				const { done, value } = await reader.read();
				if (done) {
					// Clean stream close — trigger reconnect
					if (!controller.signal.aborted) {
						throw new Error("SSE stream closed by server");
					}
					return;
				}
				
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						try {
							const data = JSON.parse(line.slice(6)) as PipelineStreamEvent;
							if (data.type === "task.stateChanged") {
								callback(data);
							}
						} catch (e) {
							log("sse_parse_error", { error: e instanceof Error ? e.message : String(e) }, "WARN");
						}
					}
				}
			}
		} catch (error) {
			if (controller.signal.aborted) return;
			
			const errorMsg = error instanceof Error ? error.message : String(error);
			log("sse_connection_error", { error: errorMsg, attempt: reconnectAttempts }, "ERROR");
			
			// Retry loop with exponential backoff
			while (!controller.signal.aborted) {
				const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay);
				reconnectAttempts++;

				log("sse_reconnect_scheduled", { delay, attempt: reconnectAttempts }, "WARN");

				await new Promise(resolve => setTimeout(resolve, delay));
				if (controller.signal.aborted) return;

				try {
					const newReader = await performHandshake();
					void runReadLoop(newReader);
					return;
				} catch (handshakeErr) {
					const hsMsg = handshakeErr instanceof Error ? handshakeErr.message : String(handshakeErr);
					log("sse_handshake_failed", { error: hsMsg, attempt: reconnectAttempts }, "ERROR");
				}
			}
		}
	};
	
	/** Perform initial handshake — returns reader on success, throws on failure. */
	const performHandshake = async (): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				Accept: "text/event-stream",
				"X-API-Key": apiKey,
			},
		});
		
		if (!response.ok) {
			throw new Error(`SSE connection failed: HTTP ${response.status}`);
		}
		
		reconnectAttempts = 0;
		const reader = response.body?.getReader();
		if (!reader) throw new Error("No response body");
		return reader;
	};
	
	// Perform handshake before returning abort handle
	const reader = await performHandshake();
	
	// Start background read loop (don't await — runs indefinitely)
	void runReadLoop(reader);
	
	return {
		abort: () => {
			controller.abort();
		},
	};
}
