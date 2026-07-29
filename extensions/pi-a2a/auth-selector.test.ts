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
	it("chooses the strongest mutually supported mode", () => {
		assert.deepEqual(select(), {
			selectedAuthMode: "oauth2+mtls",
			source: "hub",
			denial: null,
		});
	});

	it("requires both local mTLS capabilities and peer mTLS before selecting oauth2+mtls", () => {
		for (const transport of [
			{ mtls: false, clientCertificate: true },
			{ mtls: true, clientCertificate: false },
		]) {
			assert.deepEqual(
				select({ local: { supportedAuthModes: ["oauth2", "oauth2+mtls"], transport } }),
				{ selectedAuthMode: "oauth2", source: "hub", denial: null },
			);
		}
		assert.deepEqual(
			select({
				peer: { ...peer(["oauth2", "oauth2+mtls"]), transport: { mtls: false } },
				local: { supportedAuthModes: ["oauth2", "oauth2+mtls"], transport: { mtls: true, clientCertificate: true } },
			}),
			{ selectedAuthMode: "oauth2", source: "hub", denial: null },
		);
	});

	it("honors a peer-selected mode instead of choosing a stronger alternative", () => {
		assert.deepEqual(
			select({ peer: { ...peer(["oauth2", "oauth2+mtls"]), selectedAuthMode: "oauth2", transport: { mtls: true } } }),
			{ selectedAuthMode: "oauth2", source: "hub", denial: null },
		);
	});

	it("fails closed when a peer-selected mode is unusable or violates modern-only policy", () => {
		assert.deepEqual(
			select({
				peer: { ...peer(["oauth2", "oauth2+mtls"]), selectedAuthMode: "oauth2+mtls", transport: { mtls: false } },
			}),
			{ selectedAuthMode: null, source: "hub", denial: { reason: "no-mutual-auth-mode" } },
		);
		assert.deepEqual(
			select({ peer: { ...peer(["legacy-api-key", "oauth2"]), selectedAuthMode: "legacy-api-key" }, modernOnly: true }),
			{ selectedAuthMode: null, source: "hub", denial: { reason: "modern-auth-required" } },
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
});
