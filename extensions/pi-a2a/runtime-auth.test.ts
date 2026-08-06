import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { initializeHubRuntimeAuth } from "./runtime-auth.ts";
import type { HubConfig } from "./types.ts";

const hub: HubConfig = { url: "https://hub.example", apiKey: "bootstrap" };
const log = () => {};
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const metadata = { mode: "oauth2" as const, issuer: "https://hub.example", jwks: { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "key-1" }] } };
const session = (accessToken: string) => ({ accessToken, expiresAt: new Date(Date.now() + 60_000).toISOString(), scopes: ["a2a:token:introspect"] });

function jwt(tokenId = "token-1"): string {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "key-1" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({
		iss: metadata.issuer, sub: "caller-1", aud: "agent-1", target_instance_id: "instance-1",
		task_id: "task-1", skill: "coding", scope: ["tasks:run"], jti: tokenId, iat: now, exp: now + 300,
	})).toString("base64url");
	const input = `${header}.${payload}`;
	return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

test("prefers enforceable Hub OAuth without exposing mutable binding state", async () => {
	let fallbackRequested = false;
	const auth = await initializeHubRuntimeAuth(hub, "instance-1", log, {
		getMetadata: async () => metadata,
		issueCredential: async () => { fallbackRequested = true; return null; },
	});
	assert.deepEqual(auth.supportedModes, ["oauth2"]);
	assert.equal(auth.managedOAuth, true);
	assert.equal(auth.credential, undefined);
	assert.equal("binding" in auth, false);
	assert.equal(auth.activateRegistration("agent-1", session("session-1")), true);
	assert.equal(auth.activateRegistration("agent-2", session("session-2")), false);
	assert.equal(fallbackRequested, false);
});

test("captures the exact session for each introspection and rotates only for the same agent", async () => {
	const seen: Array<{ token: string; session: string }> = [];
	let releaseOld!: () => void;
	const oldPending = new Promise<void>((resolve) => { releaseOld = resolve; });
	const auth = await initializeHubRuntimeAuth(hub, "instance-1", log, {
		getMetadata: async () => metadata,
		introspectToken: async (token, session) => {
			seen.push({ token, session });
			if (session === "session-old") await oldPending;
			return true;
		},
	});
	assert.equal(auth.activateRegistration("agent-1", session("session-old")), true);
	const oldToken = jwt();
	const oldCall = auth.verifyOAuth?.(oldToken);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(auth.activateRegistration("agent-1", session("session-new")), true);
	const newToken = oldToken;
	const newCall = auth.verifyOAuth?.(newToken);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(seen, [{ token: oldToken, session: "session-old" }, { token: newToken, session: "session-new" }]);
	releaseOld();
	assert.ok(await oldCall);
	assert.ok(await newCall);
});

test("fails before registration and after deactivation without stale introspection", async () => {
	const seen: string[] = [];
	const auth = await initializeHubRuntimeAuth(hub, "instance-1", log, {
		getMetadata: async () => metadata,
		introspectToken: async (_token, session) => { seen.push(session); return true; },
	});
	assert.equal(await auth.verifyOAuth?.(jwt()), null);
	assert.equal(auth.activateRegistration("agent-1", session("session-1")), true);
	assert.ok(await auth.verifyOAuth?.(jwt()));
	auth.deactivateRegistration();
	assert.equal(await auth.verifyOAuth?.(jwt()), null);
	assert.deepEqual(seen, ["session-1"]);
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
