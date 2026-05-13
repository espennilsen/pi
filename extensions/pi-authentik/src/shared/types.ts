/** Persisted non-secret configuration stored under the `pi-authentik` settings key. */
export interface AuthentikStoredSettings {
  authentikHost?: string;
  providerSlug?: string;
  clientId?: string;
  scopes?: string[];
  enableOfflineAccess?: boolean;
  discoveryUrl?: string;
  logoutUrl?: string;
  llmBaseUrl?: string;
  authStorageBackend?: string;
  modelFilters?: string[];
  /** Client ID of the target OAuth2 provider used for JWT bearer token exchange. Stored via pi-secret. */
  exchangeClientId?: string;
}

/** Runtime settings after Pi global and project settings have been merged and normalized. */
export interface AuthentikResolvedSettings {
  authentikHost: string | null;
  providerSlug: string | null;
  clientId: string | null;
  clientSecret: string | null;
  scopes: string[];
  enableOfflineAccess: boolean;
  discoveryUrl: string | null;
  logoutUrl: string | null;
  llmBaseUrl: string | null;
  authStorageBackend: string | null;
  modelFilters: string[];
  /** Client ID of the target OAuth2 provider for JWT bearer token exchange. */
  exchangeClientId: string | null;
}

/** Optional settings source overrides used by tests. */
export interface ResolveSettingsOptions {
  globalSettings?: unknown;
  projectSettings?: unknown;
}

/** OAuth token data stored for an authenticated authentik session. */
export interface AuthentikTokenSet {
  accessToken: string;
  idToken: string;
  tokenType: string;
  expiresAt: number;
  refreshToken?: string;
  scope?: string;
}

/** Verified user claims extracted from the ID token. */
export interface AuthentikUserSession {
  issuer: string;
  audience: string[];
  subject: string;
  expiresAt: number;
  nonce?: string;
  issuedAt?: number;
  email?: string;
  name?: string;
  preferredUsername?: string;
}

/** Combined token and user state persisted for session restoration. */
export interface AuthentikSessionRecord {
  tokens: AuthentikTokenSet;
  user: AuthentikUserSession;
}

/** Inputs required to validate an authentik ID token against JWKS. */
export interface VerifyIdTokenOptions {
  idToken: string;
  jwksUri: string;
  issuer: string;
  audience: string;
  nonce: string;
  clockToleranceSeconds?: number;
}

/** Function signature for ID token verifiers used by auth helpers and tests. */
export type VerifyIdTokenFn = (options: VerifyIdTokenOptions) => Promise<AuthentikUserSession>;

/** Minimal `pi-secret` host API surface required by the token store. */
export interface PiSecretApiLike {
  service: string;
  setSecret(extensionId: string, secretName: string, value: string): Promise<void>;
  getSecret(extensionId: string, secretName: string, requesterExtensionId: string): Promise<string | null>;
  deleteSecret(extensionId: string, secretName: string): Promise<void>;
}

declare global {
  var __piSecret: PiSecretApiLike | undefined;
}
