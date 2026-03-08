/**
 * pi-a2a — A2A Hub registration client.
 *
 * Registers the pi agent with an A2A Discovery Hub using its
 * JSON-RPC 2.0 API. Hub config comes from settings.json.
 *
 * The hub only needs the agent's public URL — it fetches the Agent Card
 * from /.well-known/agent.json itself.
 */

import type { HubConfig } from "./types.ts";
import type { LogFn } from "./logger.ts";

interface HubRpcResponse {
	jsonrpc: "2.0";
	result?: { agentId: string; status: string; message?: string };
	error?: { code: number; message: string; data?: unknown };
	id: number;
}

/**
 * Register this agent with the A2A Hub.
 *
 * Sends the agent's public URL plus hub-specific metadata (categories,
 * tags, visibility). The hub fetches and validates the Agent Card from
 * the agent's /.well-known/agent.json endpoint.
 */
export async function registerWithHub(
	agentUrl: string,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ agentId: string; status: string } | null> {
	const rpcUrl = `${hubConfig.url.replace(/\/$/, "")}/rpc`;

	const payload = {
		jsonrpc: "2.0" as const,
		method: "agents.register",
		params: {
			url: agentUrl,
			category: hubConfig.categories ?? ["development-tools"],
			tags: hubConfig.tags ?? [],
			visibility: hubConfig.visibility ?? "public",
		},
		id: 1,
	};

	log("hub_register_start", { url: rpcUrl, agentUrl });

	try {
		const res = await fetch(rpcUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-Key": hubConfig.apiKey,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000),
		});

		if (!res.ok) {
			const text = await res.text();
			log("hub_register_http_error", { status: res.status, body: text.slice(0, 500) }, "ERROR");
			return null;
		}

		const data = (await res.json()) as HubRpcResponse;

		if (data.error) {
			log("hub_register_rpc_error", { code: data.error.code, message: data.error.message, data: data.error.data }, "ERROR");
			return null;
		}

		if (data.result) {
			log("hub_register_success", { agentId: data.result.agentId, status: data.result.status });
			return data.result;
		}

		log("hub_register_unexpected", { response: JSON.stringify(data).slice(0, 500) }, "WARN");
		return null;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log("hub_register_error", { error: msg }, "ERROR");
		return null;
	}
}
