import assert from "node:assert/strict";
import * as http from "node:http";
import { once } from "node:events";
import { afterEach, describe, it } from "node:test";
import { getRemoteTask, sendA2AMessage } from "./client.ts";
import type { OutboundAuthContext } from "./outbound-auth.ts";

const log = () => {};
const oauthContext: OutboundAuthContext = { headers: { Authorization: "Bearer oauth-old" }, mode: "oauth2", transport: { kind: "default" } };
const legacyContext: OutboundAuthContext = { headers: { Authorization: "Bearer legacy" }, mode: "legacy-api-key", transport: { kind: "default" } };

async function authServer(respond: (request: Record<string, unknown>) => unknown) {
	const headers: string[] = [];
	let calls = 0;
	const server = http.createServer(async (req, res) => {
		headers.push(String(req.headers.authorization ?? ""));
		const body = await new Promise<string>((resolve) => {
			let text = "";
			req.on("data", (chunk) => { text += chunk; });
			req.on("end", () => resolve(text));
		});
		calls++;
		if (calls === 1) { res.writeHead(401); res.end(); return; }
		const request = JSON.parse(body) as Record<string, unknown>;
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: respond(request) }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address() as { port: number };
	return { url: `http://127.0.0.1:${address.port}`, headers, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

afterEach(() => {});

describe("negotiated outbound auth", () => {
	it("retries OAuth send once using the refreshed bearer token", async () => {
		const testServer = await authServer(() => ({ kind: "task", id: "task-1", contextId: "ctx", status: { state: "working" } }));
		try {
			const result = await sendA2AMessage({ url: testServer.url, message: "hello", authContext: oauthContext, onRefreshCredential: async () => "oauth-fresh" }, log);
			assert.equal(result.ok, true);
			assert.deepEqual(testServer.headers, ["Bearer oauth-old", "Bearer oauth-fresh"]);
		} finally { await testServer.close(); }
	});

	it("does not retry legacy auth after a 401", async () => {
		const testServer = await authServer(() => ({}));
		try {
			const result = await sendA2AMessage({ url: testServer.url, message: "hello", authContext: legacyContext, onRefreshCredential: async () => "wrong" }, log);
			assert.equal(result.unauthorized, true);
			assert.deepEqual(testServer.headers, ["Bearer legacy"]);
		} finally { await testServer.close(); }
	});

	it("retries OAuth task polling with the refreshed bearer token", async () => {
		const testServer = await authServer(() => ({ kind: "task", id: "task-1", contextId: "ctx", status: { state: "completed" }, artifacts: [] }));
		try {
			const result = await getRemoteTask({ url: testServer.url, taskId: "task-1", authContext: oauthContext, onRefreshCredential: async () => "oauth-fresh" }, log);
			assert.equal(result.state, "completed");
			assert.deepEqual(testServer.headers, ["Bearer oauth-old", "Bearer oauth-fresh"]);
		} finally { await testServer.close(); }
	});
});
