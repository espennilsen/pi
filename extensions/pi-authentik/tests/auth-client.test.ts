import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshSession,
  runBrowserLogin,
} from "../auth/auth-client.ts";
import { buildLogoutUrl } from "../auth/logout.ts";
import type { AuthentikSessionRecord, AuthentikUserSession } from "../shared/types.ts";

test("buildAuthorizationUrl composes authorization request with PKCE state nonce and loopback redirect", () => {
  const authorizationUrl = buildAuthorizationUrl({
    authorizationEndpoint: "https://auth.example/application/o/authorize/",
    clientId: "pi-client",
    redirectUri: "http://127.0.0.1:43123/callback",
    scopes: ["openid", "profile", "email", "offline_access"],
    state: "state-123",
    nonce: "nonce-456",
    codeChallenge: "challenge-789",
  });

  const url = new URL(authorizationUrl);
  assert.equal(url.origin, "https://auth.example");
  assert.equal(url.pathname, "/application/o/authorize/");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "pi-client");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:43123/callback");
  assert.equal(url.searchParams.get("scope"), "openid profile email offline_access");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.equal(url.searchParams.get("nonce"), "nonce-456");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-789");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("runBrowserLogin orchestrates callback server wait and browser hook separately from code exchange", async () => {
  const calls: string[] = [];

  const session = await runBrowserLogin({
    authorizationEndpoint: "https://auth.example/application/o/authorize/",
    tokenEndpoint: "https://auth.example/application/o/token/",
    issuer: "https://auth.example/application/o/provider/",
    jwksUri: "https://auth.example/application/o/provider/jwks/",
    clientId: "pi-client",
    scopes: ["openid"],
    state: "state-123",
    nonce: "nonce-456",
    codeVerifier: "verifier-789",
    codeChallenge: "challenge-abc",
    createLoopbackServer: async () => ({
      redirectUri: "http://127.0.0.1:43123/callback",
      waitForCallback: async () => {
        calls.push("waitForCallback");
        return { code: "auth-code-123", state: "state-123" };
      },
      close: async () => {
        calls.push("close");
      },
    }),
    openBrowser: async (url) => {
      calls.push(`openBrowser:${url}`);
    },
    exchangeCode: async (request) => {
      calls.push(`exchangeCode:${request.code}:${request.redirectUri}`);
      return exampleSession();
    },
  });

  assert.equal(session.tokens.accessToken, "access-token");

  assert.equal(calls.length, 4);

  const openBrowserCall = calls[0];
  if (!openBrowserCall) throw new Error("expected openBrowser call");
  assert.ok(openBrowserCall.startsWith("openBrowser:"));
  const authUrl = new URL(openBrowserCall.replace("openBrowser:", ""));
  assert.equal(authUrl.origin, "https://auth.example");
  assert.equal(authUrl.pathname, "/application/o/authorize/");
  assert.equal(authUrl.searchParams.get("response_type"), "code");
  assert.equal(authUrl.searchParams.get("client_id"), "pi-client");
  assert.equal(decodeURIComponent(authUrl.searchParams.get("redirect_uri") ?? ""), "http://127.0.0.1:43123/callback");
  assert.equal(authUrl.searchParams.get("scope"), "openid");
  assert.equal(authUrl.searchParams.get("state"), "state-123");
  assert.equal(authUrl.searchParams.get("nonce"), "nonce-456");
  assert.equal(authUrl.searchParams.get("code_challenge"), "challenge-abc");
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");

  assert.equal(calls[1], "waitForCallback");

  const exchangeCall = calls[2];
  if (!exchangeCall) throw new Error("expected exchangeCode call");
  const prefix = "exchangeCode:";
  assert.ok(exchangeCall.startsWith(prefix));
  const remainder = exchangeCall.slice(prefix.length);
  const sep = remainder.indexOf(":");
  assert.equal(sep >= 0, true);
  assert.equal(remainder.slice(0, sep), "auth-code-123");
  assert.equal(remainder.slice(sep + 1), "http://127.0.0.1:43123/callback");

  assert.equal(calls[3], "close");
});

test("exchangeAuthorizationCode posts expected token request shape and assembles a typed session", async () => {
  const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];

  const session = await exchangeAuthorizationCode({
    tokenEndpoint: "https://auth.example/application/o/token/",
    clientId: "pi-client",
    code: "auth-code-123",
    redirectUri: "http://127.0.0.1:43123/callback",
    codeVerifier: "verifier-789",
    issuer: "https://auth.example/application/o/provider/",
    jwksUri: "https://auth.example/application/o/provider/jwks/",
    nonce: "nonce-456",
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ""),
      });
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          id_token: "id-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-token",
          scope: "openid profile",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    verifyIdToken: async (options) => {
      assert.equal(options.idToken, "id-token");
      assert.equal(options.issuer, "https://auth.example/application/o/provider/");
      assert.equal(options.jwksUri, "https://auth.example/application/o/provider/jwks/");
      assert.equal(options.audience, "pi-client");
      assert.equal(options.nonce, "nonce-456");
      return exampleUser();
    },
    now: () => 1_700_000_000,
  });

  const tokenRequest = requests[0];
  if (!tokenRequest) throw new Error("expected token request");
  assert.equal(tokenRequest.url, "https://auth.example/application/o/token/");
  assert.equal(tokenRequest.method, "POST");
  assert.match(tokenRequest.headers.get("content-type") ?? "", /application\/x-www-form-urlencoded/i);

  const params = new URLSearchParams(tokenRequest.body);
  assert.equal(params.get("grant_type"), "authorization_code");
  assert.equal(params.get("client_id"), "pi-client");
  assert.equal(params.get("code"), "auth-code-123");
  assert.equal(params.get("redirect_uri"), "http://127.0.0.1:43123/callback");
  assert.equal(params.get("code_verifier"), "verifier-789");

  assert.deepEqual(session, {
    tokens: {
      accessToken: "access-token",
      idToken: "id-token",
      tokenType: "Bearer",
      expiresAt: 1_700_003_600,
      refreshToken: "refresh-token",
      scope: "openid profile",
    },
    user: exampleUser(),
  });
});

test("refreshSession skips token endpoint when no refresh token exists", async () => {
  let called = false;

  const result = await refreshSession({
    tokenEndpoint: "https://auth.example/application/o/token/",
    clientId: "pi-client",
    session: {
      ...exampleSession(),
      tokens: {
        ...exampleSession().tokens,
        refreshToken: undefined,
      },
    },
    fetchImpl: async () => {
      called = true;
      throw new Error("should not be called");
    },
  });

  assert.equal(result, null);
  assert.equal(called, false);
});

test("refreshSession posts refresh_token grant only when refresh token exists", async () => {
  let requestBody = "";

  const result = await refreshSession({
    tokenEndpoint: "https://auth.example/application/o/token/",
    clientId: "pi-client",
    session: exampleSession(),
    fetchImpl: async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          access_token: "new-access-token",
          id_token: "new-id-token",
          token_type: "Bearer",
          expires_in: 1800,
          refresh_token: "new-refresh-token",
          scope: "openid profile",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    verifyIdToken: async (options) => {
      assert.equal(options.idToken, "new-id-token");
      assert.equal(options.nonce, "nonce-456");
      return exampleUser();
    },
    issuer: "https://auth.example/application/o/provider/",
    jwksUri: "https://auth.example/application/o/provider/jwks/",
    now: () => 1_700_010_000,
  });

  const params = new URLSearchParams(requestBody);
  assert.equal(params.get("grant_type"), "refresh_token");
  assert.equal(params.get("client_id"), "pi-client");
  assert.equal(params.get("refresh_token"), "refresh-token");
  assert.equal(params.get("scope"), null);

  assert.equal(result?.tokens.accessToken, "new-access-token");
  assert.equal(result?.tokens.refreshToken, "new-refresh-token");
  assert.equal(result?.tokens.expiresAt, 1_700_011_800);
});

test("buildLogoutUrl uses configured logout or end-session endpoint when available", () => {
  const fromEndSession = buildLogoutUrl({
    endSessionEndpoint: "https://auth.example/application/o/end-session/",
    idTokenHint: "id-token",
    postLogoutRedirectUri: "http://127.0.0.1:43123/logout",
    state: "logout-state",
  });

  assert.equal(
    fromEndSession,
    "https://auth.example/application/o/end-session/?id_token_hint=id-token&post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Flogout&state=logout-state",
  );

  const fromLogoutUrl = buildLogoutUrl({
    logoutUrl: "https://auth.example/custom-logout",
    postLogoutRedirectUri: "http://127.0.0.1:43123/logout",
  });
  assert.equal(
    fromLogoutUrl,
    "https://auth.example/custom-logout?post_logout_redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Flogout",
  );

  assert.equal(buildLogoutUrl({}), null);
});

function exampleUser(): AuthentikUserSession {
  return {
    issuer: "https://auth.example/application/o/provider/",
    audience: ["pi-client"],
    subject: "user-123",
    expiresAt: 1_700_003_600,
    nonce: "nonce-456",
    issuedAt: 1_700_000_000,
    email: "user@example.com",
    name: "Example User",
    preferredUsername: "example",
  };
}

function exampleSession(): AuthentikSessionRecord {
  return {
    tokens: {
      accessToken: "access-token",
      idToken: "id-token",
      tokenType: "Bearer",
      expiresAt: 1_700_003_600,
      refreshToken: "refresh-token",
      scope: "openid profile",
    },
    user: exampleUser(),
  };
}
