import assert from "node:assert/strict";
import { test } from "node:test";
import { authenticateInboundRequest } from "./inbound-auth.ts";
import type { LocalConfig } from "./types.ts";

const legacy: LocalConfig = { apiKey: "correct horse", auth: { supportedAuthModes: ["legacy-api-key"] } };

test("legacy authentication is constant-time policy gated", async () => {
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer correct horse", local: legacy })).principal?.mode, "legacy-api-key");
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer wrong", local: legacy })).status, 401);
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer correct horse", local: legacy, operation: "deploy", modernOnlySkills: ["deploy"] })).status, 403);
});

test("OAuth takes precedence over legacy credentials when both inbound modes are enabled", async () => {
	let verifications = 0;
	const result = await authenticateInboundRequest({
		authorization: "Bearer shared-token",
		local: { apiKey: "shared-token", auth: { supportedAuthModes: ["legacy-api-key", "oauth2"] } },
		supportedModes: ["legacy-api-key", "oauth2"],
		verifyOAuth: async () => {
			verifications++;
			return { subject: "agent", issuer: "https://issuer", audience: "api", expiresAt: Date.now() + 60_000 };
		},
	});
	assert.equal(verifications, 1);
	assert.equal(result.principal?.mode, "oauth2");
});

test("OAuth task claims must match the inbound request and required scope", async () => {
	const verifier = async () => ({
		subject: "agent", issuer: "https://issuer", audience: "target", expiresAt: Date.now() + 60_000,
		scopes: ["tasks:run"], taskId: "task-1", skill: "coding", tokenId: "jti-1",
	});
	const base = { authorization: "Bearer jwt", local: { auth: { supportedAuthModes: ["oauth2" as const] } }, supportedModes: ["oauth2" as const], verifyOAuth: verifier };
	assert.equal((await authenticateInboundRequest({ ...base, taskId: "task-1", requiredOAuthScope: "tasks:run" })).principal?.mode, "oauth2");
	assert.deepEqual(await authenticateInboundRequest({ ...base, taskId: "task-2", requiredOAuthScope: "tasks:run" }), { status: 403, reason: "oauth-task-binding-rejected" });
	assert.deepEqual(await authenticateInboundRequest({ ...base, taskId: "task-1", requiredOAuthScope: "tasks:cancel" }), { status: 403, reason: "oauth-scope-rejected" });
});

test("OAuth is verified and mTLS bindings are required when mTLS is the only enabled mode", async () => {
	const local: LocalConfig = { auth: { supportedAuthModes: ["oauth2+mtls"] } };
	const verifier = async () => ({ subject: "agent", issuer: "https://issuer", audience: "api", expiresAt: Date.now() + 60_000, scopes: ["a2a"], cnfThumbprint: "bound" });
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer jwt", local, supportedModes: ["oauth2+mtls"], verifyOAuth: verifier, mtlsEvidence: { verified: true, thumbprint: "bound" } })).principal?.mode, "oauth2+mtls");
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer jwt", local, supportedModes: ["oauth2+mtls"], verifyOAuth: verifier, mtlsEvidence: { verified: true, thumbprint: "other" } })).status, 403);
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer jwt", local: { auth: { supportedAuthModes: ["oauth2"], oauth2: { issuer: "https://other" } } }, supportedModes: ["oauth2"], verifyOAuth: verifier })).status, 401);
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer opaque", local: { auth: { supportedAuthModes: ["oauth2"] } } })).status, 401);
});
