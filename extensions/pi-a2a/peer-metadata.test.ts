import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePeerMetadata } from "./peer-metadata.ts";

const oauthCard = {
	securitySchemes: {
		oauth2: {
			type: "oauth2",
			authorizationServer: "https://issuer.example/.well-known/oauth-authorization-server",
			flows: { clientCredentials: { tokenUrl: "https://issuer.example/token" } },
		},
		mtls: { type: "mutualTLS" },
	},
	security: [{ oauth2: [] }, { oauth2: [], mtls: [] }],
};

describe("resolvePeerMetadata", () => {
	it("uses Hub-provided metadata for a Hub-resolved peer", async () => {
		const metadata = await resolvePeerMetadata(
			{ agentId: "hub-1", endpoint: "https://peer.example", hubAgentId: "hub-1" },
			{ getHubAgent: async () => ({ id: "hub-1", auth: { agentId: "hub-1", endpoint: "https://hub-peer.example", supportedAuthModes: ["oauth2"], source: "agent-card", authorizationServer: "https://issuer.example" } }) },
		);
		assert.deepEqual(metadata, { agentId: "hub-1", endpoint: "https://hub-peer.example", supportedAuthModes: ["oauth2"], source: "hub", authorizationServer: "https://issuer.example" });
	});

	it("uses a static auth override before fetching its card", async () => {
		let fetched = false;
		const metadata = await resolvePeerMetadata(
			{ agentId: "static-1", endpoint: "https://peer.example", staticAgent: { name: "static-1", url: "https://peer.example", auth: { supportedAuthModes: ["legacy-api-key"], resource: "peer" } } },
			{ fetchAgentCard: async () => { fetched = true; return oauthCard; } },
		);
		assert.deepEqual(metadata, { agentId: "static-1", endpoint: "https://peer.example", supportedAuthModes: ["legacy-api-key"], source: "static-directory", resource: "peer" });
		assert.equal(fetched, false);
	});

	it("falls back to the static peer Agent Card", async () => {
		const metadata = await resolvePeerMetadata(
			{ agentId: "static-1", endpoint: "https://peer.example", staticAgent: { name: "static-1", url: "https://peer.example" } },
			{ fetchAgentCard: async () => oauthCard },
		);
		assert.deepEqual(metadata, { agentId: "static-1", endpoint: "https://peer.example", supportedAuthModes: ["oauth2", "oauth2+mtls"], source: "agent-card", authorizationServer: "https://issuer.example/.well-known/oauth-authorization-server" });
	});

	it("does not treat a token URL as authorization-server metadata", async () => {
		const metadata = await resolvePeerMetadata(
			{ agentId: "static-1", endpoint: "https://peer.example", staticAgent: { name: "static-1", url: "https://peer.example" } },
			{ fetchAgentCard: async () => ({ securitySchemes: { oauth2: { type: "oauth2", flows: { clientCredentials: { tokenUrl: "https://issuer.example/token" } } } }, security: [{ oauth2: [] }] }) },
		);
		assert.equal(metadata.authorizationServer, undefined);
	});

	it("fails closed for an unknown card scheme", async () => {
		const metadata = await resolvePeerMetadata(
			{ agentId: "static-1", endpoint: "https://peer.example", staticAgent: { name: "static-1", url: "https://peer.example" } },
			{ fetchAgentCard: async () => ({ securitySchemes: { custom: { type: "http", scheme: "digest" } }, security: [{ custom: [] }] }) },
		);
		assert.deepEqual(metadata.supportedAuthModes, []);
		assert.equal(metadata.source, "agent-card");
	});

	it("does not send a static legacy API key while fetching an Agent Card", async () => {
		let headers: HeadersInit | undefined;
		await resolvePeerMetadata(
			{ agentId: "static-1", endpoint: "https://peer.example", staticAgent: { name: "static-1", url: "https://peer.example", apiKey: "legacy-secret" } },
			{ fetchAgentCard: async (_endpoint, init) => { headers = init?.headers; return { securitySchemes: {}, security: [] }; } },
		);
		assert.equal(new Headers(headers).has("authorization"), false);
	});
});
