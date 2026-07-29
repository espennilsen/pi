import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AuthSelection, PeerAuthMetadata } from "./auth-types.ts";
import { LegacyApiKeyProvider, OAuthClientCredentialsProvider } from "./token-provider.ts";

const peer: PeerAuthMetadata = {
	agentId: "peer-1", endpoint: "https://peer.example", source: "agent-card",
	supportedAuthModes: ["oauth2"], authorizationServer: "https://issuer.example/token", resource: "https://peer.example/a2a",
};
const oauthSelection: AuthSelection = { selectedAuthMode: "oauth2", source: "agent-card", denial: null };

describe("token providers", () => {
	it("returns the configured key from the legacy provider", async () => {
		const provider = new LegacyApiKeyProvider("legacy-secret");
		assert.deepEqual(await provider.getAccessToken({ ...peer, supportedAuthModes: ["legacy-api-key"] }, { ...oauthSelection, selectedAuthMode: "legacy-api-key" }), {
			value: "legacy-secret", tokenType: "Bearer", mode: "legacy-api-key",
		});
	});

	it("uses the peer authorization-server endpoint, requests resource/audience, and caches OAuth tokens", async () => {
		const requests: Array<{ url: string; body: URLSearchParams }> = [];
		const provider = new OAuthClientCredentialsProvider({ clientId: "client-id", clientSecret: "client-secret", trustedTokenEndpointOrigins: ["https://issuer.example"] }, async (url, init) => {
			requests.push({ url: String(url), body: new URLSearchParams(String(init?.body)) });
			return new Response(JSON.stringify({ access_token: "oauth-secret", token_type: "Bearer", expires_in: 3600 }), { status: 200 });
		});
		const first = await provider.getAccessToken(peer, oauthSelection);
		const second = await provider.getAccessToken(peer, oauthSelection);
		assert.equal(first.value, "oauth-secret");
		assert.equal(second.value, "oauth-secret");
		assert.equal(requests.length, 1);
		assert.equal(requests[0].url, "https://issuer.example/token");
		assert.equal(requests[0].body.get("grant_type"), "client_credentials");
		assert.equal(requests[0].body.get("resource"), "https://peer.example/a2a");
		assert.equal(requests[0].body.get("audience"), "https://peer.example/a2a");
		provider.invalidate(peer, oauthSelection);
		await provider.getAccessToken(peer, oauthSelection);
		assert.equal(requests.length, 2);
	});

	it("does not fall back to a legacy key when an OAuth token request fails", async () => {
		const provider = new OAuthClientCredentialsProvider({ clientId: "id", clientSecret: "secret", trustedTokenEndpointOrigins: ["https://issuer.example"] }, async () => new Response("denied", { status: 401 }));
		await assert.rejects(() => provider.getAccessToken(peer, oauthSelection), /OAuth token request failed/);
	});

	it("rejects unpinned or non-HTTPS token metadata before invoking fetch", async () => {
		let called = false;
		const provider = new OAuthClientCredentialsProvider({ clientId: "id", clientSecret: "secret", trustedTokenEndpointOrigins: ["https://issuer.example"] }, async () => {
			called = true;
			return new Response();
		});
		await assert.rejects(() => provider.getAccessToken({ ...peer, authorizationServer: "http://issuer.example/token" }, oauthSelection), /must be HTTPS/);
		await assert.rejects(() => provider.getAccessToken({ ...peer, authorizationServer: "https://attacker.example/token" }, oauthSelection), /not pinned/);
		assert.equal(called, false);
	});

	it("disables redirects on credential-bearing token requests", async () => {
		let redirect: RequestRedirect | undefined;
		const provider = new OAuthClientCredentialsProvider({ clientId: "id", clientSecret: "secret", trustedTokenEndpointOrigins: ["https://issuer.example"] }, async (_url, init) => {
			redirect = init?.redirect;
			return new Response(JSON.stringify({ access_token: "token" }));
		});
		await provider.getAccessToken(peer, oauthSelection);
		assert.equal(redirect, "error");
	});
});
