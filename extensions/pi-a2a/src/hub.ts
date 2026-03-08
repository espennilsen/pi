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

import type { HubConfig, RemoteAgentSummary, RemoteAgentDetail, TelemetrySnapshot } from "./types.ts";
import type { LogFn } from "./logger.ts";

interface HubRpcResponse {
	jsonrpc: "2.0";
	result?: Record<string, unknown>;
	error?: { code: number; message: string; data?: unknown };
	id: number;
}

// ── Helpers ─────────────────────────────────────────────────────

function hubRpcUrl(hubConfig: HubConfig): string {
	return `${hubConfig.url.replace(/\/$/, "")}/rpc`;
}

async function hubRpc(
	rpcUrl: string,
	method: string,
	params: Record<string, unknown>,
	hubApiKey: string,
	log: LogFn,
	logPrefix: string,
): Promise<Record<string, unknown> | null> {
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

		const data = (await res.json()) as HubRpcResponse;

		if (data.error) {
			log(`${logPrefix}_rpc_error`, { code: data.error.code, message: data.error.message, data: data.error.data }, "ERROR");
			return null;
		}

		if (data.result) {
			return data.result;
		}

		log(`${logPrefix}_unexpected`, { response: JSON.stringify(data).slice(0, 500) }, "WARN");
		return null;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log(`${logPrefix}_error`, { error: msg }, "ERROR");
		return null;
	}
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Register this agent with the A2A Hub.
 *
 * Sends the agent's public URL plus hub-specific metadata (categories,
 * tags, visibility). The hub fetches and validates the Agent Card from
 * the agent's /.well-known/agent.json endpoint.
 *
 * When `agentApiKey` is provided, it is sent as `credential` so the hub
 * can share it with other agents that want to call this agent's A2A endpoint.
 */
export async function registerWithHub(
	agentUrl: string,
	hubConfig: HubConfig,
	log: LogFn,
	agentApiKey?: string,
): Promise<{ agentId: string; status: string } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	const params: Record<string, unknown> = {
		url: agentUrl,
		category: hubConfig.categories ?? ["development-tools"],
		tags: hubConfig.tags ?? [],
		visibility: hubConfig.visibility ?? "public",
	};
	if (agentApiKey) {
		params.credential = agentApiKey;
	}

	log("hub_register_start", { url: rpcUrl, agentUrl, hasCredential: !!agentApiKey });

	const result = await hubRpc(rpcUrl, "agents.register", params, hubConfig.apiKey, log, "hub_register");
	if (result) {
		const agentId = result.agentId as string;
		const status = result.status as string;
		log("hub_register_success", { agentId, status });
		return { agentId, status };
	}
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
): Promise<{ telemetryUpdatedAt: string } | null> {
	const rpcUrl = hubRpcUrl(hubConfig);

	const params: Record<string, unknown> = {
		agentId,
		queueDepth: telemetry.queueDepth,
		activeTasks: telemetry.activeTasks,
		maxConcurrent: telemetry.maxConcurrent,
	};
	if (telemetry.lastTaskDurationMs !== undefined) {
		params.lastTaskDurationMs = telemetry.lastTaskDurationMs;
	}
	if (telemetry.lastTaskStatus !== undefined) {
		params.lastTaskStatus = telemetry.lastTaskStatus;
	}

	const result = await hubRpc(rpcUrl, "agents.reportTelemetry", params, hubConfig.apiKey, log, "hub_telemetry");
	if (result) {
		return { telemetryUpdatedAt: result.telemetryUpdatedAt as string };
	}
	return null;
}
