/** Standard outbound token providers. No provider logs credential values. */

import type { AuthMode, AuthSelection, PeerAuthMetadata } from "./auth-types.ts";

export interface AccessToken {
	/** Secret token value; consumers must not log it. */
	value: string;
	tokenType: "Bearer";
	mode: AuthMode;
	/** OAuth token expiry, adjusted earlier than the server expiry. */
	expiresAt?: number;
}

export interface TokenProvider {
	getAccessToken(peer: PeerAuthMetadata, selection: AuthSelection): Promise<AccessToken>;
	invalidate?(peer: PeerAuthMetadata, selection: AuthSelection): void;
}

export class TokenProviderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TokenProviderError";
	}
}

/** Preserves the existing static API-key-as-Bearer-token behavior. */
export class LegacyApiKeyProvider implements TokenProvider {
	private readonly apiKey: string | undefined;

	constructor(apiKey: string | undefined) {
		this.apiKey = apiKey;
	}

	async getAccessToken(_peer: PeerAuthMetadata, selection: AuthSelection): Promise<AccessToken> {
		if (selection.selectedAuthMode !== "legacy-api-key") {
			throw new TokenProviderError("Legacy API-key provider cannot satisfy the selected auth mode");
		}
		if (!this.apiKey) throw new TokenProviderError("No legacy API key is configured");
		return { value: this.apiKey, tokenType: "Bearer", mode: "legacy-api-key" };
	}
}

export interface OAuthClientCredentials {
	clientId: string;
	clientSecret: string;
	/** Client credentials are sent in the form body by default, per RFC 6749. */
	clientAuthentication?: "body" | "basic";
	/** Optional injectable fetch for tests. */
	fetch?: typeof fetch;
	/** Optional injectable clock for expiry tests. */
	now?: () => number;
}

type CachedToken = AccessToken & { expiresAt: number };
const EARLY_EXPIRY_MS = 30_000;

/**
 * Fetches OAuth client-credentials tokens from the token endpoint explicitly
 * advertised by the peer. It intentionally has no legacy-provider fallback.
 */
export class OAuthClientCredentialsProvider implements TokenProvider {
	private readonly cache = new Map<string, CachedToken>();
	private readonly fetchFn: typeof fetch;
	private readonly now: () => number;
	private readonly credentials: OAuthClientCredentials;

	constructor(credentials: OAuthClientCredentials, fetchFn?: typeof fetch) {
		this.credentials = credentials;
		this.fetchFn = fetchFn ?? credentials.fetch ?? fetch;
		this.now = credentials.now ?? Date.now;
	}

	async getAccessToken(peer: PeerAuthMetadata, selection: AuthSelection): Promise<AccessToken> {
		const mode = selection.selectedAuthMode;
		if (mode !== "oauth2" && mode !== "oauth2+mtls") {
			throw new TokenProviderError("OAuth provider cannot satisfy the selected auth mode");
		}
		const tokenEndpoint = peer.authorizationServer;
		if (!tokenEndpoint) throw new TokenProviderError("Peer does not advertise an OAuth token endpoint");
		const resource = peer.resource ?? peer.endpoint;
		const key = cacheKey(peer.agentId, resource, mode);
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > this.now()) return cached;
		this.cache.delete(key);

		const body = new URLSearchParams({ grant_type: "client_credentials", resource, audience: resource });
		const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
		if (this.credentials.clientAuthentication === "basic") {
			headers.Authorization = `Basic ${base64(`${this.credentials.clientId}:${this.credentials.clientSecret}`)}`;
		} else {
			body.set("client_id", this.credentials.clientId);
			body.set("client_secret", this.credentials.clientSecret);
		}

		let response: Response;
		try {
			response = await this.fetchFn(tokenEndpoint, { method: "POST", headers, body });
		} catch {
			throw new TokenProviderError("OAuth token request failed");
		}
		if (!response.ok) throw new TokenProviderError("OAuth token request failed");
		let payload: unknown;
		try { payload = await response.json(); } catch { throw new TokenProviderError("OAuth token response was invalid"); }
		if (!isTokenResponse(payload)) throw new TokenProviderError("OAuth token response was invalid");
		const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) ? payload.expires_in * 1000 : 0;
		const expiresAt = this.now() + Math.max(0, expiresIn - EARLY_EXPIRY_MS);
		const token: CachedToken = { value: payload.access_token, tokenType: "Bearer", mode, expiresAt };
		this.cache.set(key, token);
		return token;
	}

	invalidate(peer: PeerAuthMetadata, selection: AuthSelection): void {
		const mode = selection.selectedAuthMode;
		if (mode === "oauth2" || mode === "oauth2+mtls") this.cache.delete(cacheKey(peer.agentId, peer.resource ?? peer.endpoint, mode));
	}
}

function cacheKey(agentId: string, resource: string, mode: AuthMode): string {
	return JSON.stringify([agentId, resource, mode]);
}
function isTokenResponse(value: unknown): value is { access_token: string; expires_in?: number } {
	return value !== null && typeof value === "object" && typeof (value as { access_token?: unknown }).access_token === "string";
}
function base64(value: string): string {
	return globalThis.btoa(value);
}
