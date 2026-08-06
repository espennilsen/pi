import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentCard } from "./agent-card.ts";
import { findFreePort } from "./port-finder.ts";
import { startServer, stopServer } from "./server.ts";

const log = () => {};
const rpcHandler = { handle: async () => ({ jsonrpc: "2.0", id: 1, result: { accepted: true } }) } as never;

async function post(port: number, authorization: string, params: Record<string, unknown>): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: authorization, Connection: "close" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params }),
	});
}

test("server rejects OAuth A2A requests without an exact skill while legacy remains unaffected", async () => {
	const oauthPort = await findFreePort(28100, 28200, "127.0.0.1");
	assert.notEqual(oauthPort, null);
	await startServer({
		port: oauthPort!, bind: "127.0.0.1", supportedAuthModes: ["oauth2"],
		verifyOAuth: async () => ({
			subject: "caller", issuer: "https://hub.example", audience: "agent-1",
			expiresAt: Date.now() + 60_000, scopes: ["tasks:run"], taskId: "task-1", skill: "coding",
		}),
		agentCard: buildAgentCard({}, `http://127.0.0.1:${oauthPort}`, ["oauth2"], "hub-jwt"), rpcHandler, log,
	});
	try {
		assert.equal((await post(oauthPort!, "Bearer oauth", { taskId: "task-1", message: {} })).status, 403);
		assert.equal((await post(oauthPort!, "Bearer oauth", { taskId: "task-1", skillId: "other", message: {} })).status, 403);
		assert.equal((await post(oauthPort!, "Bearer oauth", { taskId: "task-1", skillId: "coding", message: {} })).status, 200);
	} finally {
		await stopServer(log);
	}

	const legacyPort = await findFreePort(28300, 28400, "127.0.0.1");
	assert.notEqual(legacyPort, null);
	await startServer({
		port: legacyPort!, bind: "127.0.0.1", apiKey: "legacy", supportedAuthModes: ["legacy-api-key"],
		agentCard: buildAgentCard({}, `http://127.0.0.1:${legacyPort}`, ["legacy-api-key"]), rpcHandler, log,
	});
	try {
		assert.equal((await post(legacyPort!, "Bearer legacy", { message: {} })).status, 200);
	} finally {
		await stopServer(log);
	}
});
