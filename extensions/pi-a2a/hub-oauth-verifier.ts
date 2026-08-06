/** Verification of Hub-issued, instance-bound A2A task JWTs. */

import { createHash, createPublicKey, createVerify } from "node:crypto";
import type { OAuthPrincipal, OAuthVerifier } from "./inbound-auth.ts";

const MAX_CONCURRENT_INTROSPECTIONS = 16;

export interface HubRuntimeAuthMetadata {
	mode: "oauth2";
	issuer: string;
	jwks: { keys: Array<Record<string, unknown>> };
}

export interface HubOAuthBinding {
	agentId: string;
	instanceId: string;
}

/** Build a fail-closed RS256 verifier bound to one logical agent instance. */
export function createHubOAuthVerifier(
	metadata: HubRuntimeAuthMetadata,
	binding: HubOAuthBinding,
	introspect: (token: string) => Promise<boolean>,
	introspectionContext: () => string = () => "",
): OAuthVerifier {
	const inFlightIntrospections = new Map<string, Promise<boolean>>();

	async function introspectValidatedToken(identity: string, token: string): Promise<boolean> {
		let pending = inFlightIntrospections.get(identity);
		if (!pending) {
			if (inFlightIntrospections.size >= MAX_CONCURRENT_INTROSPECTIONS) return false;
			try {
				// Invoke immediately so session-scoped callbacks capture their current
				// generation before the caller can synchronously rotate registration.
				pending = Promise.resolve(introspect(token));
			} catch (error) {
				pending = Promise.reject(error);
			}
			inFlightIntrospections.set(identity, pending);
		}
		try {
			return await pending;
		} finally {
			if (inFlightIntrospections.get(identity) === pending) inFlightIntrospections.delete(identity);
		}
	}

	return async (token: string): Promise<OAuthPrincipal | null> => {
		try {
			const [headerPart, payloadPart, signaturePart, ...extra] = token.split(".");
			if (!headerPart || !payloadPart || !signaturePart || extra.length > 0) return null;
			const header = decodeRecord(headerPart);
			const claims = decodeRecord(payloadPart);
			if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return null;
			const jwk = metadata.jwks.keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
			if (!jwk) return null;

			const verifier = createVerify("RSA-SHA256");
			verifier.update(`${headerPart}.${payloadPart}`);
			verifier.end();
			if (!verifier.verify(createPublicKey({ key: jwk as never, format: "jwk" }), Buffer.from(signaturePart, "base64url"))) return null;

			const now = Math.floor(Date.now() / 1000);
			const audiences = typeof claims.aud === "string"
				? [claims.aud]
				: Array.isArray(claims.aud) && claims.aud.every((value) => typeof value === "string") ? claims.aud as string[] : [];
			if (claims.iss !== metadata.issuer || !audiences.includes(binding.agentId) ||
				claims.target_instance_id !== binding.instanceId || typeof claims.sub !== "string" || !claims.sub ||
				typeof claims.exp !== "number" || !Number.isInteger(claims.exp) || claims.exp <= now ||
				typeof claims.iat !== "number" || !Number.isInteger(claims.iat) || claims.iat > now + 60 ||
				claims.exp <= claims.iat || claims.exp - claims.iat > 5 * 60 ||
				(claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isInteger(claims.nbf) || claims.nbf > now)) ||
				typeof claims.task_id !== "string" || !claims.task_id || typeof claims.skill !== "string" || !claims.skill ||
				typeof claims.jti !== "string" || !claims.jti) return null;
			const scopes = Array.isArray(claims.scope)
				? claims.scope.every((scope) => typeof scope === "string" && scope.length > 0) ? claims.scope as string[] : undefined
				: typeof claims.scope === "string" ? claims.scope.split(/\s+/).filter(Boolean) : undefined;
			if (!scopes?.length) return null;

			// Revocation and live instance/task capabilities are authoritative at the
			// Hub. Check them only after all local, non-network validation succeeds.
			const introspectionIdentity = `${claims.jti}:${createHash("sha256").update(token).digest("base64url")}:${introspectionContext()}`;
			if (!await introspectValidatedToken(introspectionIdentity, token)) throw new Error("Hub token is inactive");
			return {
				subject: claims.sub,
				issuer: claims.iss,
				audience: audiences,
				expiresAt: claims.exp * 1000,
				scopes,
				taskId: claims.task_id,
				skill: claims.skill,
				tokenId: claims.jti,
			};
		} catch {
			return null;
		}
	};
}

function decodeRecord(segment: string): Record<string, unknown> {
	const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed JWT");
	return value as Record<string, unknown>;
}
