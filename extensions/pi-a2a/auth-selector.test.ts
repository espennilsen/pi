/** pi-a2a peer-auth selection policy tests. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectPeerAuth } from "./auth-selector.ts";
import type { AuthSelectionInput, PeerAuthMetadata } from "./auth-types.ts";

const peer = (supportedAuthModes: PeerAuthMetadata["supportedAuthModes"]): PeerAuthMetadata => ({
	agentId: "peer-1",
	endpoint: "https://peer.example/a2a",
	supportedAuthModes,
	source: "hub",
});

function select(overrides: Partial<AuthSelectionInput> & { peer?: PeerAuthMetadata } = {}) {
	return selectPeerAuth({
		local: {
			supportedAuthModes: ["legacy-api-key", "oauth2", "oauth2+mtls"],
			transport: { mtls: true, clientCertificate: true },
		},
		peer: {
			...peer(["legacy-api-key", "oauth2", "oauth2+mtls"]),
			transport: { mtls: true },
		},
		...overrides,
	});
}

describe("selectPeerAuth", () => {
	it("chooses the strongest runtime-enforceable mutually supported mode", () => {
		assert.deepEqual(select(), {
			selectedAuthMode: "oauth2",
			source: "hub",
			denial: null,
		});
	});

	it("requires HTTPS and non-disabled TLS before selecting OAuth", () => {
		assert.equal(
			select({ peer: { ...peer(["oauth2"]), endpoint: "http://peer.example/a2a" } }).selectedAuthMode,
			null,
		);
		assert.equal(
			select({ peer: { ...peer(["oauth2"]), transport: { tls: false } } }).selectedAuthMode,
			null,
		);
		assert.equal(
			select({ local: { supportedAuthModes: ["oauth2"], transport: { tls: false } }, peer: peer(["oauth2"]) }).selectedAuthMode,
			null,
		);
	});

	it("does not select oauth2+mtls until a certificate-bound transport exists", () => {
		assert.deepEqual(
			select({ peer: peer(["oauth2+mtls"]), local: { supportedAuthModes: ["oauth2+mtls"], transport: { mtls: true, clientCertificate: true } } }),
			{ selectedAuthMode: null, source: "hub", denial: { reason: "no-mutual-auth-mode" } },
		);
	});

	it("re-evaluates the mode from immutable peer capabilities for every selection", () => {
		const metadata = { ...peer(["legacy-api-key", "oauth2"]) };
		assert.deepEqual(
			select({ peer: metadata, local: { supportedAuthModes: ["legacy-api-key", "oauth2"], preferModern: false } }),
			{ selectedAuthMode: "legacy-api-key", source: "hub", denial: null },
		);
		assert.deepEqual(
			select({ peer: metadata, local: { supportedAuthModes: ["legacy-api-key", "oauth2"] }, modernOnly: true }),
			{ selectedAuthMode: "oauth2", source: "hub", denial: null },
		);
	});

	it("honors a legacy preference when the skill is not modern-only", () => {
		assert.deepEqual(
			select({ local: { supportedAuthModes: ["legacy-api-key", "oauth2"], preferModern: false } }),
			{ selectedAuthMode: "legacy-api-key", source: "hub", denial: null },
		);
	});

	it("does not honor a legacy preference for a modern-only skill", () => {
		assert.deepEqual(
			select({
				local: { supportedAuthModes: ["legacy-api-key", "oauth2"], preferModern: false },
				skillId: "deploy-production",
				modernOnly: true,
			}),
			{ selectedAuthMode: "oauth2", source: "hub", denial: null },
		);
	});

	it("fails closed when a modern-only skill has no OAuth mode", () => {
		assert.deepEqual(
			select({
				peer: peer(["legacy-api-key"]),
				local: { supportedAuthModes: ["legacy-api-key"], modernOnlySkills: ["deploy-production"] },
				skillId: "deploy-production",
			}),
			{
				selectedAuthMode: null,
				source: "hub",
				denial: { reason: "modern-auth-required" },
			},
		);
	});

	it("fails closed when the peer and local modes do not intersect", () => {
		assert.deepEqual(
			select({ peer: peer(["oauth2"]), local: { supportedAuthModes: ["legacy-api-key"] } }),
			{
				selectedAuthMode: null,
				source: "hub",
				denial: { reason: "no-mutual-auth-mode" },
			},
		);
	});

	it("does not select legacy auth based on Agent Card metadata", () => {
		assert.deepEqual(
			select({
				peer: { ...peer(["legacy-api-key"]), source: "agent-card" },
				local: { supportedAuthModes: ["legacy-api-key"] },
			}),
			{
				selectedAuthMode: null,
				source: "agent-card",
				denial: { reason: "no-mutual-auth-mode" },
			},
		);
	});
});
