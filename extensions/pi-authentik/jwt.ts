import { createRemoteJWKSet, errors, jwtVerify } from "jose";

import type { AuthentikUserSession, VerifyIdTokenOptions } from "./types.ts";

/**
 * Verifies an authentik ID token against the provider JWKS and required claims.
 * @param options - Token, JWKS, issuer, audience, and nonce validation inputs.
 * @returns Verified user session claims extracted from the ID token.
 */
export async function verifyIdToken(options: VerifyIdTokenOptions): Promise<AuthentikUserSession> {
  const jwks = createRemoteJWKSet(new URL(options.jwksUri));

  let payload;
  try {
    ({ payload } = await jwtVerify(options.idToken, jwks, {
      issuer: options.issuer,
      audience: options.audience,
      clockTolerance: options.clockToleranceSeconds ?? 0,
    }));
  } catch (error) {
    throw normalizeJoseError(error);
  }

  if (payload.nonce !== options.nonce) {
    throw new Error("ID token nonce mismatch");
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("ID token is missing subject claim");
  }

  if (typeof payload.iss !== "string" || payload.iss.length === 0) {
    throw new Error("ID token is missing issuer claim");
  }

  if (typeof payload.exp !== "number") {
    throw new Error("ID token is missing expiry claim");
  }

  const audience = Array.isArray(payload.aud) ? payload.aud : typeof payload.aud === "string" ? [payload.aud] : [];
  if (audience.length === 0) {
    throw new Error("ID token is missing audience claim");
  }

  return {
    issuer: payload.iss,
    audience,
    subject: payload.sub,
    expiresAt: payload.exp,
    nonce: typeof payload.nonce === "string" ? payload.nonce : undefined,
    issuedAt: typeof payload.iat === "number" ? payload.iat : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
    preferredUsername: typeof payload.preferred_username === "string" ? payload.preferred_username : undefined,
  };
}

function normalizeJoseError(error: unknown): Error {
  if (error instanceof errors.JWTExpired) return new Error("ID token expired");
  if (error instanceof errors.JWTClaimValidationFailed) {
    return new Error(`ID token claim validation failed: ${normalizeClaimName(error.claim)}`);
  }
  if (error instanceof errors.JOSEError) return new Error(`ID token verification failed: ${error.message}`);
  return error instanceof Error ? error : new Error("ID token verification failed");
}

function normalizeClaimName(claim: string): string {
  if (claim === "aud") return "audience";
  if (claim === "iss") return "issuer";
  if (claim === "exp") return "expiry";
  return claim;
}
