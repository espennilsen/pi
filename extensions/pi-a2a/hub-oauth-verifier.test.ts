import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { test } from "node:test";
import { createHubOAuthVerifier } from "./hub-oauth-verifier.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "hub-key";
const issuer = "https://hub.example";
const agentId = "agent-1";
const instanceId = "instance-1";
const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };

function jwt(overrides: Record<string, unknown> = {}): string {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({
		iss: issuer,
		sub: "caller-1",
		aud: agentId,
		target_instance_id: instanceId,
		task_id: "task-1",
		skill: "general_coding",
		scope: ["a2a:task.report-status"],
		jti: randomUUID(),
		iat: now,
		exp: now + 300,
		...overrides,
	})).toString("base64url");
	const input = `${header}.${payload}`;
	return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

const verifier = createHubOAuthVerifier(
	{ mode: "oauth2", issuer, jwks: { keys: [jwk] } },
	{ agentId, instanceId },
);

test("accepts a valid Hub JWT bound to the logical agent and exact instance", async () => {
	const principal = await verifier(jwt());
	assert.equal(principal?.subject, "caller-1");
	assert.equal(principal?.issuer, issuer);
	assert.deepEqual(principal?.scopes, ["a2a:task.report-status"]);
});

test("rejects task JWTs bound to a different instance or logical agent", async () => {
	assert.equal(await verifier(jwt({ target_instance_id: "instance-2" })), null);
	assert.equal(await verifier(jwt({ aud: "agent-2" })), null);
});

test("rejects invalid signatures, algorithms, and expired tokens", async () => {
	const invalid = jwt().replace(/.$/, (value) => value === "a" ? "b" : "a");
	assert.equal(await verifier(invalid), null);
	const now = Math.floor(Date.now() / 1000);
	assert.equal(await verifier(jwt({ exp: now - 1 })), null);
	assert.equal(await verifier(jwt({ iat: now + 30, exp: now + 20 })), null);
	assert.equal(await verifier(jwt({ iat: now, exp: now + 301 })), null);

	const parts = jwt().split(".");
	parts[0] = Buffer.from(JSON.stringify({ alg: "none", kid })).toString("base64url");
	assert.equal(await verifier(parts.join(".")), null);
});
