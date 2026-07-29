import assert from "node:assert/strict";
import { test } from "node:test";
import { selectPeerAuth } from "./auth-selector.ts";
import type { AuthMode } from "./auth-types.ts";
import { authenticateInboundRequest } from "./inbound-auth.ts";
import { redactLogDetail } from "./logger.ts";
import { buildOutboundAuthContext } from "./outbound-auth.ts";
import { parseAgentCardAuthMetadata, resolvePeerMetadata } from "./peer-metadata.ts";
import { LegacyApiKeyProvider, OAuthClientCredentialsProvider } from "./token-provider.ts";

test("Hub OAuth metadata selects a resource-scoped bearer token and produces safe structured fields", async () => {
	const peer = await resolvePeerMetadata({ agentId: "hub-peer", endpoint: "https://peer.example", hubAgentId: "hub-peer" }, {
		getHubAgent: async () => ({ id: "hub-peer", auth: {
			agentId: "hub-peer", endpoint: "https://peer.example", supportedAuthModes: ["oauth2"],
			authorizationServer: "https://issuer.example/token", resource: "https://peer.example/resource",
		} }),
	});
	const selection = selectPeerAuth({ peer, local: { supportedAuthModes: ["oauth2"] } });
	assert.equal(selection.selectedAuthMode, "oauth2");
	assert.equal(selection.source, "hub");
	let requestBody = "";
	const provider = new OAuthClientCredentialsProvider({ clientId: "client", clientSecret: "secret", fetch: async (_url, init) => {
		requestBody = String(init?.body);
		return new Response(JSON.stringify({ access_token: "issued-token", expires_in: 3600 }), { status: 200 });
	} });
	const context = await buildOutboundAuthContext({ peer, selection, provider });
	assert.equal(context.headers.Authorization, "Bearer issued-token");
	assert.match(requestBody, /resource=https%3A%2F%2Fpeer.example%2Fresource/);
	assert.deepEqual(redactLogDetail({ peerId: peer.agentId, metadataSource: selection.source, mode: selection.selectedAuthMode, authorization: context.headers.Authorization, token: "issued-token", cert: "-----BEGIN CERTIFICATE-----\nsecret" }), {
		peerId: "hub-peer", metadataSource: "hub", mode: "oauth2", authorization: "[REDACTED]", token: "[REDACTED]", cert: "[REDACTED]",
	});
});

test("static legacy peer retains the existing Bearer API-key header", async () => {
	const peer = await resolvePeerMetadata({ agentId: "legacy", endpoint: "https://legacy.example", staticAgent: {
		name: "legacy", url: "https://legacy.example", apiKey: "legacy-key", auth: { supportedAuthModes: ["legacy-api-key"] },
	} });
	const selection = selectPeerAuth({ peer, local: { supportedAuthModes: ["legacy-api-key"] } });
	const context = await buildOutboundAuthContext({ peer, selection, provider: new LegacyApiKeyProvider("legacy-key") });
	assert.equal(context.headers.Authorization, "Bearer legacy-key");
	assert.equal(selection.source, "static-directory");
});

test("mixed peers rank mTLS, then OAuth, and use legacy only when explicitly preferred", () => {
	const modes: AuthMode[] = ["legacy-api-key", "oauth2", "oauth2+mtls"];
	const peer = { agentId: "mixed", endpoint: "https://mixed.example", source: "hub" as const, supportedAuthModes: modes, transport: { mtls: true } };
	assert.equal(selectPeerAuth({ peer, local: { supportedAuthModes: peer.supportedAuthModes, transport: { mtls: true, clientCertificate: true } } }).selectedAuthMode, "oauth2+mtls");
	assert.equal(selectPeerAuth({ peer, local: { supportedAuthModes: peer.supportedAuthModes } }).selectedAuthMode, "oauth2");
	assert.equal(selectPeerAuth({ peer, local: { supportedAuthModes: peer.supportedAuthModes, preferModern: false } }).selectedAuthMode, "legacy-api-key");
});

test("absent or malformed metadata and modern-only legacy requests deny before dispatch", async () => {
	const malformed = parseAgentCardAuthMetadata({ securitySchemes: { unknown: { type: "http" } }, security: [{ unknown: [] }] }, "unknown", "https://unknown.example");
	assert.equal(selectPeerAuth({ peer: malformed, local: { supportedAuthModes: ["oauth2", "legacy-api-key"] } }).selectedAuthMode, null);
	const legacyPeer = { agentId: "legacy", endpoint: "https://legacy.example", source: "static-directory" as const, supportedAuthModes: ["legacy-api-key"] as AuthMode[] };
	assert.equal(selectPeerAuth({ peer: legacyPeer, local: { supportedAuthModes: ["legacy-api-key"], modernOnlySkills: ["deploy"] }, skillId: "deploy" }).denial?.reason, "modern-auth-required");
	const denied = await authenticateInboundRequest({ authorization: "Bearer legacy-key", local: { apiKey: "legacy-key", auth: { supportedAuthModes: ["legacy-api-key"], modernOnlySkills: ["deploy"] } }, operation: "deploy" });
	assert.equal(denied.principal, undefined);
	assert.equal(denied.status, 403);
});
