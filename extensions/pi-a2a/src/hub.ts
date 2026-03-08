/**
 * pi-a2a — A2A Hub registration client.
 *
 * Registers the pi agent with an A2A Discovery Hub using its
 * JSON-RPC 2.0 API. Hub config comes from settings.json.
 */

import type { AgentCard, HubConfig } from "./types.ts";
import type { LogFn } from "./logger.ts";

interface HubRpcResponse {
	jsonrpc: "2.0";
	result?: { agentId: string; status: string };
	error?: { code: number; message: string; data?: unknown };
	id: number;
}

/**
 * Register this agent with the A2A Hub.
 *
 * The Hub API expects a JSON-RPC 2.0 call to `agents.register` with
 * an agentCard object, categories, tags, and visibility.
 */
export async function registerWithHub(
	agentCard: AgentCard,
	hubConfig: HubConfig,
	log: LogFn,
): Promise<{ agentId: string; status: string } | null> {
	const rpcUrl = `${hubConfig.url.replace(/\/$/, "")}/rpc`;

	const payload = {
		jsonrpc: "2.0" as const,
		method: "agents.register",
		params: {
			agentCard: {
				name: agentCard.name,
				description: agentCard.description,
				url: agentCard.url,
				version: agentCard.version,
				provider: agentCard.provider,
				capabilities: {
					acceptsText: true,
					acceptsImages: false,
					acceptsAudio: false,
					acceptsVideo: false,
					acceptsFiles: false,
					producesText: true,
					producesImages: false,
					producesAudio: false,
					producesVideo: false,
					producesFiles: false,
					supportsStreaming: agentCard.capabilities.streaming ?? true,
					supportsPushNotifications: agentCard.capabilities.pushNotifications ?? false,
					supportsMultiTurn: agentCard.capabilities.multiTurn ?? true,
				},
				skills: agentCard.skills.map((s) => ({
					name: s.name,
					description: s.description,
				})),
			},
			category: hubConfig.categories ?? ["development-tools"],
			tags: hubConfig.tags ?? [],
			visibility: hubConfig.visibility ?? "public",
		},
		id: 1,
	};

	log("hub_register_start", { url: rpcUrl, agentName: agentCard.name });

	try {
		const res = await fetch(rpcUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${hubConfig.apiKey}`,
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
			log("hub_register_rpc_error", { code: data.error.code, message: data.error.message }, "ERROR");
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
