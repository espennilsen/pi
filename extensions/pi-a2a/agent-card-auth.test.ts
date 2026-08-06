import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentCard } from "./agent-card.ts";
import type { A2AConfig } from "./types.ts";

test("security reflects runtime-supported modes without leaking configuration secrets", () => {
	const legacy = buildAgentCard({ local: { apiKey: "secret", auth: { supportedAuthModes: ["legacy-api-key"] } } }, "http://x", ["legacy-api-key"]) as any;
	assert.deepEqual(Object.keys(legacy.securitySchemes), ["bearerAuth"]);
	const config: A2AConfig = {
		local: { apiKey: "secret", auth: {
			supportedAuthModes: ["legacy-api-key", "oauth2", "oauth2+mtls"],
			oauth2: {
				clientSecret: "nope",
				authorizationServer: "https://issuer.example/token",
				trustedTokenEndpointOrigins: ["https://issuer.example"],
			},
			mtls: { keyPath: "nope" },
		} },

	};
	const mixed = buildAgentCard(config, "http://x", ["legacy-api-key", "oauth2", "oauth2+mtls"]) as any;
	assert.deepEqual(Object.keys(mixed.securitySchemes).sort(), ["bearerAuth", "oauth2", "mutualTLS"].sort());
	assert.deepEqual(mixed.security, [{ bearerAuth: [] }, { oauth2: [] }, { oauth2: [], mutualTLS: [] }]);
	assert.equal(JSON.stringify(mixed).includes("secret"), false);
	assert.equal(JSON.stringify(mixed).includes("nope"), false);
	assert.equal(mixed.securitySchemes.oauth2.flows.clientCredentials.tokenUrl, "https://issuer.example/token");
});

test("advertises verifier-backed Hub JWT OAuth without local client credentials", () => {
	const card = buildAgentCard({}, "https://agent.example", ["oauth2"], "hub-jwt") as any;
	assert.deepEqual(card.security, [{ oauth2: [] }]);
	assert.deepEqual(card.securitySchemes.oauth2, {
		type: "http", scheme: "bearer", bearerFormat: "JWT",
		description: "Hub-managed OAuth 2.0 JWT access token",
	});
});

test("does not advertise OAuth without a pinned HTTPS token endpoint", () => {
	const card = buildAgentCard(
		{ local: { auth: { supportedAuthModes: ["oauth2"], oauth2: { authorizationServer: "https://issuer.example/token" } } } },
		"https://agent.example",
		["oauth2"],
	) as any;
	assert.equal(card.securitySchemes, undefined);
	assert.equal(card.security, undefined);
});
