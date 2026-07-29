/**
 * Shared types for selecting authentication when contacting a peer agent.
 * These types deliberately describe capabilities and policy only; they do not
 * create or exchange credentials.
 */

/** Authentication mechanisms understood by pi-a2a peers. */
export type AuthMode = "legacy-api-key" | "oauth2" | "oauth2+mtls";

/** Where peer authentication metadata was obtained. */
export type PeerMetadataSource = "hub" | "static-directory" | "agent-card";

/** Transport features advertised by a peer or available locally. */
export interface TransportCapabilities {
	/** Mutual TLS can be negotiated for this connection. */
	mtls?: boolean;
	/** The endpoint supports TLS. */
	tls?: boolean;
	/** A client certificate is configured for mutual TLS. */
	clientCertificate?: boolean;
}

/** Auth capability and OAuth discovery information for a remote peer. */
export interface PeerAuthMetadata {
	agentId: string;
	endpoint: string;
	supportedAuthModes: AuthMode[];
	selectedAuthMode?: AuthMode;
	source: PeerMetadataSource;
	/** OAuth 2.0 authorization-server metadata URL or issuer. */
	authorizationServer?: string;
	/** OAuth protected-resource identifier or metadata URL. */
	resource?: string;
	/** Optional transport features advertised alongside auth metadata. */
	transport?: TransportCapabilities;
}

/** Local policy/capability overrides, intended for `local.auth` settings. */
export interface MtlsConfig {
	certPath?: string;
	keyPath?: string;
	caPath?: string;
}

/** OAuth client-credentials settings kept in the existing local.auth namespace. */
export interface OAuthClientCredentialsConfig {
	clientId?: string;
	clientSecret?: string;
	/** Expected issuer for inbound access-token validation. */
	issuer?: string;
	/** Expected protected-resource audience for inbound access-token validation. */
	audience?: string;
	/** Required access-token scope for inbound requests, when configured. */
	requiredScope?: string;
}

export interface LocalAuthOverride {
	/** Modes this agent is configured to use. Omit to retain legacy API-key-only behavior. */
	supportedAuthModes?: AuthMode[];
	/** Prefer the strongest mutually supported modern mode. Defaults to true. */
	preferModern?: boolean;
	/** Skills that must never fall back to the legacy API-key mode. */
	modernOnlySkills?: string[];
	/** Locally available transport capabilities. */
	transport?: TransportCapabilities;
	/** OAuth client credentials for the standard client-credentials grant. */
	oauth2?: OAuthClientCredentialsConfig;
	/** Certificate paths for mTLS transport; actual TLS setup occurs at the client/server boundary. */
	mtls?: MtlsConfig;
}

/** Per-peer overrides, intended for a static directory entry's `auth` settings. */
export interface StaticAuthOverride {
	supportedAuthModes?: AuthMode[];
	selectedAuthMode?: AuthMode;
	authorizationServer?: string;
	resource?: string;
	transport?: TransportCapabilities;
}

/** A typed reason why a peer-auth selection was denied. */
export type AuthSelectionDenial =
	| { reason: "no-mutual-auth-mode" }
	| { reason: "modern-auth-required" };

/** Result of choosing an authentication mechanism for a peer. */
export interface AuthSelection {
	selectedAuthMode: AuthMode | null;
	source: PeerMetadataSource;
	denial: AuthSelectionDenial | null;
}

/** Inputs for the pure peer-auth selection policy. */
export interface AuthSelectionInput {
	peer: PeerAuthMetadata;
	local?: LocalAuthOverride;
	/** The requested skill ID, used with `local.modernOnlySkills`. */
	skillId?: string;
	/** Explicit skill policy, for callers that have already resolved it. */
	modernOnly?: boolean;
}
