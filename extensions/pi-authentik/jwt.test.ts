import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { verifyIdToken } from "./jwt.ts";

test("verifyIdToken accepts a valid ID token with matching issuer audience and nonce", async () => {
  const issuer = "https://auth.example/application/o/provider/";
  const audience = "pi-client";
  const nonce = "nonce-123";
  const { token, jwksUri, close } = await createSignedToken({
    issuer,
    audience,
    nonce,
    expiresInSeconds: 300,
  });

  try {
    const claims = await verifyIdToken({
      idToken: token,
      issuer,
      audience,
      nonce,
      jwksUri,
    });

    assert.equal(claims.issuer, issuer);
    assert.deepEqual(claims.audience, [audience]);
    assert.equal(claims.nonce, nonce);
    assert.equal(claims.subject, "user-123");
    assert.equal(claims.email, "user@example.com");
  } finally {
    await close();
  }
});

test("verifyIdToken rejects a mismatched nonce or audience", async () => {
  const issuer = "https://auth.example/application/o/provider/";
  const { token, jwksUri, close } = await createSignedToken({
    issuer,
    audience: "expected-audience",
    nonce: "expected-nonce",
    expiresInSeconds: 300,
  });

  try {
    await assert.rejects(
      () =>
        verifyIdToken({
          idToken: token,
          issuer,
          audience: "wrong-audience",
          nonce: "expected-nonce",
          jwksUri,
        }),
      /audience/i,
    );

    await assert.rejects(
      () =>
        verifyIdToken({
          idToken: token,
          issuer,
          audience: "expected-audience",
          nonce: "wrong-nonce",
          jwksUri,
        }),
      /nonce/i,
    );
  } finally {
    await close();
  }
});

test("verifyIdToken rejects expired tokens", async () => {
  const issuer = "https://auth.example/application/o/provider/";
  const { token, jwksUri, close } = await createSignedToken({
    issuer,
    audience: "pi-client",
    nonce: "nonce-123",
    expiresInSeconds: -30,
  });

  try {
    await assert.rejects(
      () =>
        verifyIdToken({
          idToken: token,
          issuer,
          audience: "pi-client",
          nonce: "nonce-123",
          jwksUri,
        }),
      /exp|expired/i,
    );
  } finally {
    await close();
  }
});

async function createSignedToken(options: {
  issuer: string;
  audience: string;
  nonce: string;
  expiresInSeconds: number;
}): Promise<{ token: string; jwksUri: string; close: () => Promise<void> }> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";

  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/jwks.json");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");

  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    nonce: options.nonce,
    email: "user@example.com",
    name: "Example User",
    preferred_username: "example",
  })
    .setProtectedHeader({ alg: "RS256", kid: publicJwk.kid })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setSubject("user-123")
    .setIssuedAt(now)
    .setExpirationTime(now + options.expiresInSeconds)
    .sign(privateKey);

  return {
    token,
    jwksUri: `http://127.0.0.1:${address.port}/jwks.json`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
