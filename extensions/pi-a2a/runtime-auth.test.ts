import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { initializeHubRuntimeAuth } from "./runtime-auth.ts";
import type { HubConfig } from "./types.ts";

const hub: HubConfig = { url: "https://hub.example", apiKey: "bootstrap" };
const log = () => {};
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const metadata = { mode: "oauth2" as const, issuer: "https://hub.example", jwks: { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "key-1" }] } };

function jwt(): string {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "key-1" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({
		iss: metadata.issuer, sub: "caller-1", aud: "agent-1", target_instance_id: "instance-1",
		task_id: "task-1", skill: "coding", scope: ["tasks:run"], jti: "token-1", iat: now, exp: now + 300,
	})).toString("base64url");
	const input = `${header}.${payload}`;
	return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

test("prefers enforceable Hub OAuth and exposes a mutable post-registration binding", async () => {
	let fallbackRequested = false;
	const auth = await initializeHubRuntimeAuth(hub, "instance-1", log, {
		getMetadata: async () => metadata,
		issueCredential: async () => { fallbackRequested = true; return null; },
	});
	assert.deepEqual(auth.supportedModes, ["oauth2"]);
	assert.equal(auth.managedOAuth, true);
	assert.equal(auth.credential, undefined);
	assert.equal(auth.binding?.agentId, "");
	auth.bindAgent("agent-1");
	assert.equal(auth.binding?.agentId, "agent-1");
	assert.equal(fallbackRequested, false);
});

test("composes local OAuth verification with the configured Hub introspection", async () => {
	const seen: string[] = [];
	const auth = await initializeHubRuntimeAuth(hub, "instance-1", log, {
		getMetadata: async () => metadata,
		introspectToken: async (token) => { seen.push(token); return true; },
	});
	auth.bindAgent("agent-1");
	const token = jwt();
	assert.ok(await auth.verifyOAuth?.(token));
	assert.deepEqual(seen, [token]);
});

test("fails OAuth verification before registration establishes an instance session", async () => {
	const auth = await initializeHubRuntimeAuth(hub, "instance-1", log, { getMetadata: async () => metadata });
	auth.bindAgent("agent-1");
	assert.equal(await auth.verifyOAuth?.(jwt()), null);
});

test("uses the memory-only legacy credential only when the Hub explicitly selects legacy", async () => {
	const auth = await initializeHubRuntimeAuth(hub, "instance-1", log, {
		getMetadata: async () => ({ mode: "legacy-api-key" }),
		issueCredential: async () => ({ mode: "legacy-api-key", credential: "runtime-only" }),
	});
	assert.deepEqual(auth.supportedModes, ["legacy-api-key"]);
	assert.equal(auth.managedOAuth, false);
	assert.equal(auth.credential, "runtime-only");
	assert.equal(auth.verifyOAuth, undefined);
});

test("fails closed instead of downgrading when metadata retrieval fails", async () => {
	let fallbackRequested = false;
	await assert.rejects(() => initializeHubRuntimeAuth(hub, "instance-1", log, {
		getMetadata: async () => { throw new Error("unavailable"); },
		issueCredential: async () => { fallbackRequested = true; return { mode: "legacy-api-key", credential: "runtime-only" }; },
	}), /unavailable/);
	assert.equal(fallbackRequested, false);
});
