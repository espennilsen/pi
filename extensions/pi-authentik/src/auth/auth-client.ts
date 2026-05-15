import { verifyIdToken as defaultVerifyIdToken } from "./jwt.ts";
import type { AuthentikSessionRecord, AuthentikUserSession, VerifyIdTokenFn } from "../shared/types.ts";

/** Inputs used to compose the browser authorization URL. */
export interface BuildAuthorizationUrlOptions {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  nonce: string;
  codeChallenge: string;
  codeChallengeMethod?: "S256";
}

/** Minimal loopback server contract used by the browser login flow. */
export interface BrowserLoopbackServer {
  redirectUri: string;
  waitForCallback(): Promise<{ code: string; state: string | null }>;
  close(): Promise<void>;
}

/** Dependencies and inputs required for browser-based login orchestration. */
export interface RunBrowserLoginOptions {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  issuer: string;
  jwksUri: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod?: "S256";
  createLoopbackServer: () => Promise<BrowserLoopbackServer>;
  openBrowser: (url: string) => Promise<void> | void;
  exchangeCode: (request: ExchangeAuthorizationCodeRequest) => Promise<AuthentikSessionRecord>;
}

/** Inputs required to exchange an authorization code for tokens. */
export interface ExchangeAuthorizationCodeRequest {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  issuer: string;
  jwksUri: string;
  nonce: string;
  fetchImpl?: typeof fetch;
  verifyIdToken?: VerifyIdTokenFn;
  now?: () => number;
}

/** Inputs required to exchange an existing access token for a new one via JWT bearer grant. */
export interface ExchangeJwtBearerRequest {
  tokenEndpoint: string;
  exchangeClientId: string;
  inputToken: string;
  scopes?: string[];
  fetchImpl?: typeof fetch;
}

/** Inputs required to refresh an existing authenticated session. */
export interface RefreshSessionOptions {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  session: AuthentikSessionRecord;
  issuer?: string;
  jwksUri?: string;
  fetchImpl?: typeof fetch;
  verifyIdToken?: VerifyIdTokenFn;
  now?: () => number;
}

interface AccessTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken?: string;
  scope?: string;
}

interface TokenResponse extends AccessTokenResponse {
  idToken: string;
}

/**
 * Builds the OIDC authorization URL for the authentik login flow.
 * @param options - Authorization endpoint, PKCE, redirect, and OIDC parameters.
 * @returns Absolute browser authorization URL.
 */
export function buildAuthorizationUrl(options: BuildAuthorizationUrlOptions): string {
  const url = new URL(options.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", options.scopes.join(" "));
  url.searchParams.set("state", options.state);
  url.searchParams.set("nonce", options.nonce);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", options.codeChallengeMethod ?? "S256");
  return url.toString();
}

/**
 * Coordinates loopback login by opening the browser, waiting for the callback,
 * and delegating the code exchange to the injected exchange handler.
 * @param options - Browser, callback server, and code-exchange dependencies.
 * @returns Authenticated session assembled from the token response.
 */
export async function runBrowserLogin(options: RunBrowserLoginOptions): Promise<AuthentikSessionRecord> {
  const server = await options.createLoopbackServer();
  try {
    const authorizationUrl = buildAuthorizationUrl({
      authorizationEndpoint: options.authorizationEndpoint,
      clientId: options.clientId,
      redirectUri: server.redirectUri,
      scopes: options.scopes,
      state: options.state,
      nonce: options.nonce,
      codeChallenge: options.codeChallenge,
      codeChallengeMethod: options.codeChallengeMethod,
    });

    await options.openBrowser(authorizationUrl);
    const callback = await server.waitForCallback();

    return await options.exchangeCode({
      code: callback.code,
      redirectUri: server.redirectUri,
      codeVerifier: options.codeVerifier,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      nonce: options.nonce,
      tokenEndpoint: options.tokenEndpoint,
      issuer: options.issuer,
      jwksUri: options.jwksUri,
    });
  } finally {
    await server.close();
  }
}

/**
 * Exchanges an authorization code for tokens and verifies the returned ID token.
 * @param options - Token endpoint, PKCE verifier, callback details, and verification inputs.
 * @returns Verified authenticated session record.
 */
export async function exchangeAuthorizationCode(options: ExchangeAuthorizationCodeRequest): Promise<AuthentikSessionRecord> {
  const tokenResponse = await requestToken({
    tokenEndpoint: options.tokenEndpoint,
    fetchImpl: options.fetchImpl,
    params: {
      grant_type: "authorization_code",
      client_id: options.clientId,
      ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier,
    },
  });

  const user = await (options.verifyIdToken ?? defaultVerifyIdToken)({
    idToken: tokenResponse.idToken,
    jwksUri: options.jwksUri,
    issuer: options.issuer,
    audience: options.clientId,
    nonce: options.nonce,
  });

  return createSessionRecord(tokenResponse, user, options.now);
}

/**
 * Exchanges an existing access token for a new token from a different provider using JWT bearer grant.
 * This is used to obtain a token issued by a target provider (e.g. an outpost provider) using a
 * token from the login provider (e.g. a browser OAuth client).
 * @param options - Token endpoint, target client ID, input JWT, and optional scopes.
 * @returns Raw token response from the target provider.
 */
export async function exchangeJwtBearer(options: ExchangeJwtBearerRequest): Promise<AccessTokenResponse> {
  const payload = await requestTokenPayload({
    tokenEndpoint: options.tokenEndpoint,
    fetchImpl: options.fetchImpl,
    params: {
      grant_type: "client_credentials",
      client_id: options.exchangeClientId,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: options.inputToken,
      ...(options.scopes ? { scope: options.scopes.join(" ") } : {}),
    },
  });

  return normalizeAccessTokenResponse(payload);
}

/**
 * Refreshes a stored session when a refresh token is available.
 * @param options - Existing session and token endpoint details.
 * @returns A refreshed session record, or null when refresh is not possible.
 */
export async function refreshSession(options: RefreshSessionOptions): Promise<AuthentikSessionRecord | null> {
  const refreshToken = options.session.tokens.refreshToken;
  if (!refreshToken) return null;

  const tokenResponse = await requestToken({
    tokenEndpoint: options.tokenEndpoint,
    fetchImpl: options.fetchImpl,
    params: {
      grant_type: "refresh_token",
      client_id: options.clientId,
      ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
      refresh_token: refreshToken,
    },
  });

  const user = await verifyRefreshUser(options, tokenResponse.idToken);
  return createSessionRecord(tokenResponse, user, options.now);
}

async function verifyRefreshUser(options: RefreshSessionOptions, idToken: string): Promise<AuthentikUserSession> {
  if (options.verifyIdToken && options.issuer && options.jwksUri) {
    return options.verifyIdToken({
      idToken,
      jwksUri: options.jwksUri,
      issuer: options.issuer,
      audience: options.clientId,
      nonce: options.session.user.nonce ?? "",
    });
  }

  return options.session.user;
}

async function requestToken(options: {
  tokenEndpoint: string;
  params: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  return normalizeTokenResponse(await requestTokenPayload(options));
}

async function requestTokenPayload(options: {
  tokenEndpoint: string;
  params: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body = new URLSearchParams(options.params);
  const response = await fetchImpl(options.tokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errorPayload = await response.json() as Record<string, unknown>;
      if (errorPayload.error) {
        errorDetail = `: ${errorPayload.error}${errorPayload.error_description ? ` (${errorPayload.error_description})` : ""}`;
      }
    } catch {
      // Ignore parse failure for error body
    }
    throw new Error(`Token request failed: ${response.status} ${response.statusText}${errorDetail}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Token endpoint did not return valid JSON");
  }
}

function normalizeAccessTokenResponse(payload: unknown): AccessTokenResponse {
  const record = asRecord(payload);
  const accessToken = requireString(record.access_token, "access_token");
  const tokenType = requireString(record.token_type, "token_type");
  const expiresIn = requireNumber(record.expires_in, "expires_in");

  return {
    accessToken,
    tokenType,
    expiresIn,
    refreshToken: optionalString(record.refresh_token),
    scope: optionalString(record.scope),
  };
}

function normalizeTokenResponse(payload: unknown): TokenResponse {
  const record = asRecord(payload);
  const accessTokenResponse = normalizeAccessTokenResponse(record);
  const idToken = requireString(record.id_token, "id_token");

  return {
    ...accessTokenResponse,
    idToken,
  };
}

function createSessionRecord(tokenResponse: TokenResponse, user: AuthentikUserSession, now?: () => number): AuthentikSessionRecord {
  const issuedAt = normalizeEpochSeconds((now ?? defaultNow)());
  return {
    tokens: {
      accessToken: tokenResponse.accessToken,
      idToken: tokenResponse.idToken,
      tokenType: tokenResponse.tokenType,
      expiresAt: issuedAt + tokenResponse.expiresIn,
      refreshToken: tokenResponse.refreshToken,
      scope: tokenResponse.scope,
    },
    user,
  };
}

function defaultNow(): number {
  return Date.now();
}

function normalizeEpochSeconds(value: number): number {
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Token response is missing ${fieldName}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Token response is missing ${fieldName}`);
  }
  return value;
}
