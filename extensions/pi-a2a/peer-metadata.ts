/** Resolve a remote peer's authentication capabilities without handling credentials. */

import type { AuthMode, PeerAuthMetadata } from "./auth-types.ts";
import type { StaticAgentConfig } from "./types.ts";

export interface HubPeerDetail {
	id: string;
	auth?: Omit<PeerAuthMetadata, "source">;
}

export interface ResolvePeerMetadataInput {
	agentId: string;
	endpoint: string;
	/** Set only when the peer was selected from Hub discovery. */
	hubAgentId?: string;
	staticAgent?: StaticAgentConfig;
	/** A previously fetched static Agent Card. */
	cachedCard?: Record<string, unknown> | null;
}

export interface PeerMetadataDependencies {
	getHubAgent?: (agentId: string) => Promise<HubPeerDetail | null>;
	fetchAgentCard?: (endpoint: string, init?: RequestInit) => Promise<Record<string, unknown> | null>;
}

/**
 * Resolve capabilities in source precedence order. Credentials are deliberately
 * never passed to Agent Card discovery: a static apiKey is for later task auth.
 */
export async function resolvePeerMetadata(
	input: ResolvePeerMetadataInput,
	dependencies: PeerMetadataDependencies = {},
): Promise<PeerAuthMetadata> {
	if (input.hubAgentId && dependencies.getHubAgent) {
		const detail = await dependencies.getHubAgent(input.hubAgentId);
		if (detail?.auth) {
			return { ...detail.auth, agentId: detail.auth.agentId || detail.id, endpoint: detail.auth.endpoint || input.endpoint, supportedAuthModes: validModes(detail.auth.supportedAuthModes), source: "hub" };
		}
	}

	const override = input.staticAgent?.auth;
	if (override?.supportedAuthModes !== undefined) {
		return {
			agentId: input.agentId,
			endpoint: input.endpoint,
			supportedAuthModes: validModes(override.supportedAuthModes),
			source: "static-directory",
			...(override.authorizationServer ? { authorizationServer: override.authorizationServer } : {}),
			...(override.resource ? { resource: override.resource } : {}),
			...(override.transport ? { transport: override.transport } : {}),
		};
	}

	const card = input.cachedCard ?? await dependencies.fetchAgentCard?.(input.endpoint, { headers: { Accept: "application/json" } }) ?? null;
	return parseAgentCardAuthMetadata(card, input.agentId, input.endpoint);
}

/** Parse precisely the security requirement forms pi-a2a publishes. */
export function parseAgentCardAuthMetadata(
	card: Record<string, unknown> | null,
	agentId: string,
	endpoint: string,
): PeerAuthMetadata {
	const empty = (): PeerAuthMetadata => ({ agentId, endpoint, supportedAuthModes: [], source: "agent-card" });
	if (!card || !isRecord(card.securitySchemes) || !Array.isArray(card.security)) return empty();

	const schemes = card.securitySchemes;
	const modes = new Set<AuthMode>();
	let authorizationServer: string | undefined;
	for (const requirement of card.security) {
		if (!isRecord(requirement) || Object.keys(requirement).length === 0) return empty();
		let oauth = false;
		let mtls = false;
		let legacy = false;
		for (const name of Object.keys(requirement)) {
			const scheme = schemes[name];
			if (!isRecord(scheme)) return empty();
			if (name === "bearerAuth" && scheme.type === "http" && scheme.scheme === "bearer") {
				legacy = true;
				continue;
			}
			if (scheme.type === "oauth2") {
				oauth = true;
				authorizationServer ??= oauthServer(scheme);
				continue;
			}
			if (scheme.type === "mutualTLS") {
				mtls = true;
				continue;
			}
			return empty();
		}
		// A requirement is an AND set. Mixed legacy/modern or bare mTLS is
		// not a form we publish and therefore must not be guessed at.
		if (legacy && !oauth && !mtls) modes.add("legacy-api-key");
		else if (oauth && !legacy) modes.add(mtls ? "oauth2+mtls" : "oauth2");
		else return empty();
	}
	return {
		agentId,
		endpoint,
		supportedAuthModes: (['legacy-api-key', 'oauth2', 'oauth2+mtls'] as AuthMode[]).filter((mode) => modes.has(mode)),
		source: "agent-card",
		...(authorizationServer ? { authorizationServer } : {}),
		...(typeof card.resource === "string" ? { resource: card.resource } : {}),
	};
}

function oauthServer(scheme: Record<string, unknown>): string | undefined {
	if (typeof scheme.authorizationServer === "string") return scheme.authorizationServer;
	if (typeof scheme.openIdConnectUrl === "string") return scheme.openIdConnectUrl;
	return undefined;
}

function validModes(modes: readonly unknown[] | undefined): AuthMode[] {
	return (modes ?? []).filter(isAuthMode);
}
function isAuthMode(mode: unknown): mode is AuthMode {
	return mode === "legacy-api-key" || mode === "oauth2" || mode === "oauth2+mtls";
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
