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

test("OAuth is verified and mTLS bindings are required when mTLS is the only enabled mode", async () => {
	const local: LocalConfig = { auth: { supportedAuthModes: ["oauth2+mtls"] } };
	const verifier = async () => ({ subject: "agent", issuer: "https://issuer", audience: "api", expiresAt: Date.now() + 1, scopes: ["a2a"], cnfThumbprint: "bound" });
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer jwt", local, supportedModes: ["oauth2+mtls"], verifyOAuth: verifier, mtlsEvidence: { verified: true, thumbprint: "bound" } })).principal?.mode, "oauth2+mtls");
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer jwt", local, supportedModes: ["oauth2+mtls"], verifyOAuth: verifier, mtlsEvidence: { verified: true, thumbprint: "other" } })).status, 403);
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer jwt", local: { auth: { supportedAuthModes: ["oauth2"], oauth2: { issuer: "https://other" } } }, supportedModes: ["oauth2"], verifyOAuth: verifier })).status, 401);
	assert.equal((await authenticateInboundRequest({ authorization: "Bearer opaque", local: { auth: { supportedAuthModes: ["oauth2"] } } })).status, 401);
});
