import { createHash, randomBytes } from "node:crypto";

/** PKCE verifier and challenge values for an authorization request. */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

function randomBase64Url(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

/**
 * Generates a URL-safe PKCE verifier within the required length bounds.
 * @param byteLength - Number of random bytes to encode.
 * @returns PKCE code verifier.
 */
export function generateCodeVerifier(byteLength = 64): string {
  const verifier = randomBase64Url(byteLength);
  if (verifier.length < 43 || verifier.length > 128) {
    throw new Error("PKCE code verifier must be between 43 and 128 characters");
  }
  return verifier;
}

/**
 * Derives the S256 PKCE code challenge for a verifier.
 * @param codeVerifier - PKCE verifier to hash.
 * @returns Base64url-encoded SHA-256 challenge.
 */
export function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/**
 * Generates a PKCE verifier/challenge pair for browser login.
 * @returns PKCE verifier and S256 challenge.
 */
export function createPkcePair(): PkcePair {
  const codeVerifier = generateCodeVerifier();
  return {
    codeVerifier,
    codeChallenge: createCodeChallenge(codeVerifier),
    codeChallengeMethod: "S256",
  };
}

/**
 * Generates a random OIDC state value.
 * @param byteLength - Number of random bytes to encode.
 * @returns URL-safe state token.
 */
export function generateState(byteLength = 32): string {
  return randomBase64Url(byteLength);
}

/**
 * Generates a random OIDC nonce value.
 * @param byteLength - Number of random bytes to encode.
 * @returns URL-safe nonce token.
 */
export function generateNonce(byteLength = 32): string {
  return randomBase64Url(byteLength);
}
