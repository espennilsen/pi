import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { deriveDiscoveryUrl } from "../auth/auth-config.ts";
import { fetchOidcDiscoveryMetadata } from "../auth/discovery.ts";

test("deriveDiscoveryUrl builds authentik OIDC discovery URL from host and provider slug", () => {
  assert.equal(
    deriveDiscoveryUrl("https://auth.example/", "my-provider"),
    "https://auth.example/application/o/my-provider/.well-known/openid-configuration",
  );
});

test("fetchOidcDiscoveryMetadata fetches and strictly validates required metadata", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/.well-known/openid-configuration");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        issuer: "https://auth.example/application/o/test-provider/",
        authorization_endpoint: "https://auth.example/application/o/authorize/",
        token_endpoint: "https://auth.example/application/o/token/",
        jwks_uri: "https://auth.example/application/o/jwks/",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");

  try {
    const metadata = await fetchOidcDiscoveryMetadata({
      discoveryUrl: `http://127.0.0.1:${address.port}/.well-known/openid-configuration`,
      expectedIssuer: "https://auth.example/application/o/test-provider/",
    });

    assert.equal(metadata.token_endpoint, "https://auth.example/application/o/token/");
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("fetchOidcDiscoveryMetadata rejects missing token_endpoint", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        issuer: "https://auth.example/application/o/test-provider/",
        authorization_endpoint: "https://auth.example/application/o/authorize/",
        jwks_uri: "https://auth.example/application/o/jwks/",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");

  try {
    await assert.rejects(
      () =>
        fetchOidcDiscoveryMetadata({
          discoveryUrl: `http://127.0.0.1:${address.port}/.well-known/openid-configuration`,
        }),
      /OIDC discovery metadata is missing required string field token_endpoint/,
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("fetchOidcDiscoveryMetadata rejects unsupported capabilities", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        issuer: "https://auth.example/application/o/test-provider/",
        authorization_endpoint: "https://auth.example/application/o/authorize/",
        token_endpoint: "https://auth.example/application/o/token/",
        jwks_uri: "https://auth.example/application/o/jwks/",
        response_types_supported: ["token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["plain"],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");

  try {
    await assert.rejects(
      () =>
        fetchOidcDiscoveryMetadata({
          discoveryUrl: `http://127.0.0.1:${address.port}/.well-known/openid-configuration`,
        }),
      /OIDC discovery metadata must support the authorization code flow/,
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
