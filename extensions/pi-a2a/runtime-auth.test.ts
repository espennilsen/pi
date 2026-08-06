import assert from "node:assert/strict";
import { test } from "node:test";
import { initializeHubRuntimeAuth } from "./runtime-auth.ts";
import type { HubConfig } from "./types.ts";

const hub: HubConfig = { url: "https://hub.example", apiKey: "bootstrap" };
const log = () => {};
const metadata = { mode: "oauth2" as const, issuer: "https://hub.example", jwks: { keys: [{ kty: "RSA", kid: "key-1", n: "n", e: "AQAB" }] } };

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
