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

function createVerifier(introspect: (token: string) => Promise<boolean> = async () => true) {
	return createHubOAuthVerifier(
		{ mode: "oauth2", issuer, jwks: { keys: [jwk] } },
		{ agentId, instanceId },
		introspect,
	);
}

const verifier = createVerifier();

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
	const invalidParts = jwt().split(".");
	invalidParts[2] = `${invalidParts[2]?.startsWith("a") ? "b" : "a"}${invalidParts[2]?.slice(1)}`;
	assert.equal(await verifier(invalidParts.join(".")), null);
	const now = Math.floor(Date.now() / 1000);
	assert.equal(await verifier(jwt({ exp: now - 1 })), null);
	assert.equal(await verifier(jwt({ iat: now + 30, exp: now + 20 })), null);
	assert.equal(await verifier(jwt({ iat: now, exp: now + 301 })), null);

	const parts = jwt().split(".");
	parts[0] = Buffer.from(JSON.stringify({ alg: "none", kid })).toString("base64url");
	assert.equal(await verifier(parts.join(".")), null);
});

test("coalesces concurrent introspection of the same token and does not cache after settlement", async () => {
	const tokens: string[] = [];
	let release!: (active: boolean) => void;
	const pending = new Promise<boolean>((resolve) => { release = resolve; });
	const verifier = createVerifier(async (token) => { tokens.push(token); return pending; });
	const token = jwt();
	const first = verifier(token);
	const second = verifier(token);
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(tokens, [token]);
	release(true);
	assert.ok(await first);
	assert.ok(await second);
	assert.ok(await verifier(token));
	assert.deepEqual(tokens, [token, token]);
});

test("fails closed above the concurrent distinct introspection limit", async () => {
	const releases: Array<(active: boolean) => void> = [];
	let calls = 0;
	const verifier = createVerifier(async () => {
		calls++;
		return new Promise<boolean>((resolve) => { releases.push(resolve); });
	});
	const pending = Array.from({ length: 16 }, (_, index) => verifier(jwt({ jti: `jti-${index}` })));
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(calls, 16);
	assert.equal(await verifier(jwt({ jti: "jti-over-limit" })), null);
	assert.equal(calls, 16);
	for (const release of releases) release(true);
	assert.equal((await Promise.all(pending)).every(Boolean), true);
});

test("fails closed when introspection is inactive or rejects", async () => {
	assert.equal(await createVerifier(async () => false)(jwt()), null);
	assert.equal(await createVerifier(async () => { throw new Error("timeout"); })(jwt()), null);
	const token = jwt();
	let reject!: (error: Error) => void;
	const verifier = createVerifier(() => new Promise<boolean>((_resolve, rejectPromise) => { reject = rejectPromise; }));
	const first = verifier(token);
	const second = verifier(token);
	await new Promise<void>((resolve) => setImmediate(resolve));
	reject(new Error("shared timeout"));
	assert.deepEqual(await Promise.all([first, second]), [null, null]);
});

test("never introspects a locally invalid token", async () => {
	let calls = 0;
	const verifier = createVerifier(async () => { calls++; return true; });
	assert.equal(await verifier(jwt({ target_instance_id: "other-instance" })), null);
	assert.equal(calls, 0);
});
