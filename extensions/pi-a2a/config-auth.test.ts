import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfig } from "./config.ts";

describe("normalizeConfig auth settings", () => {
	it("migrates flat legacy settings while preserving existing local behavior without auth", () => {
		const result = normalizeConfig(
			{ port: 3200, apiKey: "global-key", local: { bind: "0.0.0.0" } },
			{ apiKey: "project-key", local: { requireApiKey: true } },
		);

		assert.equal(result.config.local?.auth, undefined);
		assert.deepEqual(result.config.local, {
			port: 3200,
			apiKey: "project-key",
			bind: "0.0.0.0",
			requireApiKey: true,
		});
		assert.match(result.warnings.join("\n"), /Deprecation warning/);
	});

	it("deep merges local.auth and hub while retaining unknown auth settings", () => {
		const result = normalizeConfig(
			{
				local: { auth: { supportedAuthModes: ["legacy-api-key", "oauth2"], transport: { tls: true }, oauth2: { clientId: "client" }, futureOption: "keep" } },
				hub: { url: "https://hub.example", apiKey: "hub-key", tags: ["global"] },
			},
			{
				local: { auth: { supportedAuthModes: ["oauth2+mtls"], transport: { mtls: true, clientCertificate: true }, oauth2: { clientSecret: "secret" }, mtls: { certPath: "cert.pem", keyPath: "key.pem" } } },
				hub: { tags: ["project"] },
			},
		);

		assert.deepEqual(result.config.hub, { url: "https://hub.example", apiKey: "hub-key", tags: ["project"] });
		assert.deepEqual(result.config.local?.auth, {
			supportedAuthModes: ["oauth2+mtls"],
			transport: { tls: true, mtls: true, clientCertificate: true },
			oauth2: { clientId: "client", clientSecret: "secret" },
			futureOption: "keep",
			mtls: { certPath: "cert.pem", keyPath: "key.pem" },
		});
	});

	it("removes only invalid auth additions and does not advertise mTLS without certificate material", () => {
		const result = normalizeConfig(
			{
				local: {
					auth: {
						supportedAuthModes: ["legacy-api-key", "invalid", "oauth2", "oauth2", "oauth2+mtls"],
						mtls: { certPath: 42, keyPath: "key.pem" },
						futureOption: "keep",
					},
				},
			},
			{},
		);

		assert.deepEqual(result.config.local?.auth, {
			supportedAuthModes: ["legacy-api-key", "oauth2"],
			futureOption: "keep",
		});
		assert.match(result.warnings.join("\n"), /Invalid local.auth supportedAuthModes/);
		assert.match(result.warnings.join("\n"), /mTLS/);
	});

	it("removes malformed auth fields without retaining invalid shapes", () => {
		const result = normalizeConfig(
			{ local: { auth: { supportedAuthModes: "oauth2", selectedAuthMode: "invalid", futureOption: "keep" } } },
			{},
		);

		assert.deepEqual(result.config.local?.auth, { futureOption: "keep" });
		assert.match(result.warnings.join("\n"), /supportedAuthModes/);
		assert.match(result.warnings.join("\n"), /selectedAuthMode/);
	});

	it("preserves malformed static directory entries instead of converting them", () => {
		const malformed = "not-an-agent";
		const result = normalizeConfig({ staticAgents: [malformed] }, {});
		assert.deepEqual(result.config.staticAgents, [malformed]);
		assert.match(result.warnings.join("\n"), /static agent/);
	});

	it("preserves static peer identity and valid auth options", () => {
		const result = normalizeConfig(
			{
				staticAgents: [{
					name: "peer",
					url: "https://peer.example",
					apiKey: "peer-secret",
					auth: { supportedAuthModes: ["oauth2", "oauth2"], transport: { tls: true } },
				}],
			},
			{},
		);

		assert.deepEqual(result.config.staticAgents, [{
			name: "peer",
			url: "https://peer.example",
			apiKey: "peer-secret",
			auth: { supportedAuthModes: ["oauth2"], transport: { tls: true } },
		}]);
	});
});
