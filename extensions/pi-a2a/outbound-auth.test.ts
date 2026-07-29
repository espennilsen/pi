import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AuthSelection, PeerAuthMetadata } from "./auth-types.ts";
import { LegacyApiKeyProvider } from "./token-provider.ts";
import { buildOutboundAuthContext } from "./outbound-auth.ts";

const peer: PeerAuthMetadata = { agentId: "peer-1", endpoint: "https://peer.example", source: "static-directory", supportedAuthModes: ["legacy-api-key", "oauth2+mtls"] };
const selection: AuthSelection = { selectedAuthMode: "legacy-api-key", source: "static-directory", denial: null };

describe("buildOutboundAuthContext", () => {
	it("returns a typed Bearer authorization header for legacy auth", async () => {
		const context = await buildOutboundAuthContext({ peer, selection, provider: new LegacyApiKeyProvider("legacy-secret") });
		assert.equal(context.headers.Authorization, "Bearer legacy-secret");
		assert.deepEqual(context.transport, { kind: "default" });
	});

	it("rejects oauth2+mtls before consulting a token provider", async () => {
		let acquired = false;
		const provider = { getAccessToken: async () => { acquired = true; return { value: "secret", tokenType: "Bearer" as const, mode: "oauth2+mtls" as const }; } };
		await assert.rejects(
			() => buildOutboundAuthContext({ peer, selection: { ...selection, selectedAuthMode: "oauth2+mtls" }, provider, localAuth: { mtls: { certPath: "cert.pem", keyPath: "key.pem" } } }),
			/unavailable until outbound mTLS transport is installed/,
		);
		assert.equal(acquired, false);
	});
});
