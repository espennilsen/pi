/**
 * pi-subagent — Pool shim extension.
 *
 * Loaded inside RPC subagents that are part of an agent pool.
 * Registers spawn_agent, send_message, kill_agent, and list_agents tools
 * that communicate with the parent pool via HTTP IPC.
 *
 * Environment variables (set by pool when spawning):
 *   PI_POOL_PORT     — HTTP port of the pool server on 127.0.0.1
 *   PI_POOL_AGENT_ID — This agent's ID in the pool
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as http from "node:http";

const POOL_PORT = process.env.PI_POOL_PORT;
const AGENT_ID = process.env.PI_POOL_AGENT_ID;

let _reqSeq = 0;

/** Make an IPC request to the pool server. */
function poolRequest(action: string, params: Record<string, unknown>): Promise<{ success: boolean; data?: string; error?: string }> {
	return new Promise((resolve, reject) => {
		const body = JSON.stringify({
			requestId: `${AGENT_ID}-${++_reqSeq}`,
			agentId: AGENT_ID,
			action,
			...params,
		});

		const req = http.request({
			hostname: "127.0.0.1",
			port: Number(POOL_PORT),
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(body),
			},
		}, (res) => {
			let data = "";
			res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
			res.on("end", () => {
				try {
					resolve(JSON.parse(data));
				} catch {
					reject(new Error(`Invalid response from pool: ${data}`));
				}
			});
		});

		req.on("error", (err) => reject(err));
		req.setTimeout(300_000, () => { req.destroy(new Error("Pool request timed out")); });
		req.write(body);
		req.end();
	});
}

function text(t: string) {
	return { content: [{ type: "text" as const, text: t }], details: {} };
}

export default function (pi: ExtensionAPI) {
	if (!POOL_PORT || !AGENT_ID) return; // Not in pool mode

	// ── spawn_agent ─────────────────────────────────────────────

	pi.registerTool({
		name: "spawn_agent",
		label: "Spawn Agent",
		description: [
			"Spawn a new child agent in the pool. The child runs as an isolated subprocess",
			"with its own context and can be communicated with via send_message.",
			"",
			"The child agent will have spawn_agent, send_message, kill_agent, and list_agents",
			"tools available — it can create its own sub-hierarchy.",
		].join("\n"),
		parameters: Type.Object({
			id: Type.String({ description: "Unique ID for the new agent (e.g. 'backend-lead', 'auth-worker')" }),
			agent: Type.String({ description: "Agent type to spawn (e.g. 'worker', 'scout', 'planner')" }),
			task: Type.String({ description: "Initial task description for the agent" }),
		}),
		async execute(_toolCallId, params) {
			try {
				const result = await poolRequest("spawn", {
					spawnId: params.id,
					agentName: params.agent,
					task: params.task,
				});
				if (result.success) {
					return text(`✓ Spawned agent "${params.id}" (${params.agent}). Initial response:\n\n${result.data}`);
				}
				return { ...text(`✗ Failed to spawn agent: ${result.error}`), isError: true };
			} catch (err: any) {
				return { ...text(`✗ Spawn error: ${err.message}`), isError: true };
			}
		},
	});

	// ── send_message ────────────────────────────────────────────

	pi.registerTool({
		name: "send_message",
		label: "Send Message",
		description: [
			"Send a message to another agent in the pool and wait for their response.",
			"The target agent receives the message as a prompt and processes it with",
			"their full accumulated context.",
			"",
			"This is a blocking call — you will wait until the target agent responds.",
			"Avoid sending messages that would create a cycle (A → B → A).",
		].join("\n"),
		parameters: Type.Object({
			to: Type.String({ description: "Target agent ID to send the message to" }),
			message: Type.String({ description: "Message content to send" }),
		}),
		async execute(_toolCallId, params) {
			try {
				const result = await poolRequest("send", {
					targetId: params.to,
					message: params.message,
				});
				if (result.success) {
					return text(`Response from ${params.to}:\n\n${result.data}`);
				}
				return { ...text(`✗ Send failed: ${result.error}`), isError: true };
			} catch (err: any) {
				return { ...text(`✗ Send error: ${err.message}`), isError: true };
			}
		},
	});

	// ── kill_agent ──────────────────────────────────────────────

	pi.registerTool({
		name: "kill_agent",
		label: "Kill Agent",
		description: [
			"Kill a child agent and all of its descendants. The agent's process is",
			"terminated and its context is lost. You can only kill your own descendants.",
		].join("\n"),
		parameters: Type.Object({
			id: Type.String({ description: "ID of the agent to kill" }),
		}),
		async execute(_toolCallId, params) {
			try {
				const result = await poolRequest("kill", { killId: params.id });
				if (result.success) {
					return text(`✓ Agent "${params.id}" killed.`);
				}
				return { ...text(`✗ Kill failed: ${result.error}`), isError: true };
			} catch (err: any) {
				return { ...text(`✗ Kill error: ${err.message}`), isError: true };
			}
		},
	});

	// ── list_agents ─────────────────────────────────────────────

	pi.registerTool({
		name: "list_agents",
		label: "List Agents",
		description: "List all agents currently in the pool with their status, depth, and parent.",
		parameters: Type.Object({}),
		async execute() {
			try {
				const result = await poolRequest("list", {});
				if (result.success) {
					return text(result.data || "(no agents in pool)");
				}
				return { ...text(`✗ List failed: ${result.error}`), isError: true };
			} catch (err: any) {
				return { ...text(`✗ List error: ${err.message}`), isError: true };
			}
		},
	});
}
