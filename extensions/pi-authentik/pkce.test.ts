import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { createPkcePair, generateNonce, generateState } from "./pkce.ts";

test("createPkcePair generates S256 verifier and challenge", () => {
  const pkce = createPkcePair();

  assert.equal(pkce.codeChallengeMethod, "S256");
  assert.match(pkce.codeVerifier, /^[A-Za-z0-9_-]+$/);
  assert.match(pkce.codeChallenge, /^[A-Za-z0-9_-]+$/);
  assert.ok(pkce.codeVerifier.length >= 43);
  assert.ok(pkce.codeVerifier.length <= 128);

  const expectedChallenge = createHash("sha256").update(pkce.codeVerifier).digest("base64url");
  assert.equal(pkce.codeChallenge, expectedChallenge);
});

test("generateState and generateNonce return distinct random URL-safe values", () => {
  const state = generateState();
  const nonce = generateNonce();

  assert.match(state, /^[A-Za-z0-9_-]+$/);
  assert.match(nonce, /^[A-Za-z0-9_-]+$/);
  assert.ok(state.length >= 32);
  assert.ok(nonce.length >= 32);
  assert.notEqual(state, nonce);
});
