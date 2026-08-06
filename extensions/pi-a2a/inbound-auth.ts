/** Pure, fail-closed inbound authentication and policy checks. */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthMode, LocalAuthOverride } from "./auth-types.ts";
import type { LocalConfig } from "./types.ts";

export interface OAuthPrincipal {
	subject: string;
	issuer: string;
	audience: string | string[];
	expiresAt: number;
	scopes?: string[];
	/** Hub task and authorization claims retained for request-level binding. */
	taskId?: string;
	skill?: string;
	tokenId?: string;
	/** RFC 8705 JWT confirmation thumbprint (`x5t#S256`). */
	cnfThumbprint?: string;
}
export type OAuthVerifier = (token: string) => Promise<OAuthPrincipal | null>;
export interface MtlsEvidence { verified: boolean; thumbprint?: string; }
export interface AuthenticatedPrincipal { mode: AuthMode; identity: string; }
export interface InboundAuthInput {
	authorization?: string;
	local?: Pick<LocalConfig, "apiKey" | "auth">;
	/** Actual server capabilities. This is deliberately separate from configured intent. */
	supportedModes?: AuthMode[];
	verifyOAuth?: OAuthVerifier;
	mtlsEvidence?: MtlsEvidence;
	operation?: string;
	taskId?: string;
	requireTaskBinding?: boolean;
	requiredOAuthScope?: string;
	requestedSkill?: string;
	modernOnlySkills?: string[];
}
export interface InboundAuthResult { principal?: AuthenticatedPrincipal; status?: 401 | 403; reason?: string; }

/** HTTP server currently has no TLS listener, so mTLS is not a runtime capability by default. */
export function getInboundSupportedModes(local?: Pick<LocalConfig, "apiKey" | "auth">): AuthMode[] {
	const configured = local?.auth?.supportedAuthModes;
	if (!configured) return local?.apiKey ? ["legacy-api-key"] : [];
	return configured.filter((mode): mode is AuthMode => mode === "legacy-api-key" || mode === "oauth2");
}

export async function authenticateInboundRequest(input: InboundAuthInput): Promise<InboundAuthResult> {
	const modes = input.supportedModes ?? getInboundSupportedModes(input.local);
	const token = bearerToken(input.authorization);
	if (!token) return { status: 401, reason: "missing-bearer-token" };
	const modernOnly = !!input.operation && (input.modernOnlySkills ?? input.local?.auth?.modernOnlySkills ?? []).includes(input.operation);

	const oauthMode = modes.includes("oauth2+mtls") ? "oauth2+mtls" : modes.includes("oauth2") ? "oauth2" : undefined;
	// When both modes are enabled, a valid OAuth credential takes precedence
	// over a coincidentally equal legacy API key.
	if (oauthMode && input.verifyOAuth) {
		let principal: OAuthPrincipal | null;
		try { principal = await input.verifyOAuth(token); } catch { principal = null; }
		if (principal && principal.subject && principal.issuer && principal.audience && Number.isFinite(principal.expiresAt) && principal.expiresAt > Date.now()) {
			const expected = input.local?.auth?.oauth2;
			const audiences = Array.isArray(principal.audience) ? principal.audience : [principal.audience];
			if ((expected?.issuer && principal.issuer !== expected.issuer) ||
				(expected?.audience && !audiences.includes(expected.audience)) ||
				(expected?.requiredScope && !principal.scopes?.includes(expected.requiredScope))) {
				return { status: 401, reason: "oauth-claims-rejected" };
			}
			if (input.requireTaskBinding && (!input.taskId || principal.taskId !== input.taskId)) {
				return { status: 403, reason: "oauth-task-binding-rejected" };
			}
			if (!input.requireTaskBinding && input.taskId !== undefined && principal.taskId !== input.taskId) {
				return { status: 403, reason: "oauth-task-binding-rejected" };
			}
			if (input.requiredOAuthScope && !principal.scopes?.includes(input.requiredOAuthScope)) {
				return { status: 403, reason: "oauth-scope-rejected" };
			}
			if (input.requestedSkill && principal.skill !== input.requestedSkill) {
				return { status: 403, reason: "oauth-skill-binding-rejected" };
			}
			if (oauthMode === "oauth2+mtls") {
				const evidence = input.mtlsEvidence;
				if (!evidence?.verified || !evidence.thumbprint || !principal.cnfThumbprint || !constantTimeEqual(evidence.thumbprint, principal.cnfThumbprint)) {
					return { status: 403, reason: "mtls-binding-required" };
				}
			}
			return { principal: { mode: oauthMode, identity: `oauth-${redactedIdentity(principal.subject)}` } };
		}
		// Mixed deployments retain their explicitly configured legacy key, but
		// only an exact constant-time match may be reinterpreted after OAuth
		// rejection. Arbitrary malformed or invalid JWTs never downgrade.
		if (modes.includes("legacy-api-key") && input.local?.apiKey && constantTimeEqual(token, input.local.apiKey)) {
			if (modernOnly) return { status: 403, reason: "modern-auth-required" };
			return { principal: { mode: "legacy-api-key", identity: keyIdentity(token) } };
		}
		return { status: 401, reason: "invalid-oauth-token" };
	}
	if (modes.includes("legacy-api-key") && input.local?.apiKey && constantTimeEqual(token, input.local.apiKey)) {
		if (modernOnly) return { status: 403, reason: "modern-auth-required" };
		return { principal: { mode: "legacy-api-key", identity: keyIdentity(token) } };
	}
	return { status: 401, reason: oauthMode && input.verifyOAuth ? "invalid-oauth-token" : "invalid-credentials" };
}

function bearerToken(value: string | undefined): string | undefined {
	return value?.startsWith("Bearer ") ? value.slice(7) || undefined : undefined;
}
/** HMAC normalizes length before timingSafeEqual. */
function constantTimeEqual(a: string, b: string): boolean {
	const key = "pi-a2a-auth";
	return timingSafeEqual(createHmac("sha256", key).update(a).digest(), createHmac("sha256", key).update(b).digest());
}
function keyIdentity(key: string): string { return `key-${createHmac("sha256", "a2a-key-id").update(key).digest("hex").slice(0, 12)}`; }
function redactedIdentity(subject: string): string { return createHmac("sha256", "a2a-oauth-id").update(subject).digest("hex").slice(0, 12); }
