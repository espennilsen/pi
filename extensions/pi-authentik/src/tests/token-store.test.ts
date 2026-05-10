import assert from "node:assert/strict";
import test from "node:test";

import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
  SESSION_SECRET_NAME,
  TOKEN_STORE_EXTENSION_ID,
} from "../session/token-store.ts";
import type { AuthentikSessionRecord } from "../shared/types.ts";

test("token-store saves loads and clears session state through globalThis.__piSecret", async () => {
  const saved = new Map<string, string>();
  const calls: string[] = [];

  globalThis.__piSecret = {
    service: "com.earendil.pi-secret",
    async setSecret(extensionId, secretName, value) {
      calls.push(`set:${extensionId}:${secretName}`);
      saved.set(`${extensionId}:${secretName}`, value);
    },
    async getSecret(extensionId, secretName, requesterExtensionId) {
      calls.push(`get:${extensionId}:${secretName}:${requesterExtensionId}`);
      return saved.get(`${extensionId}:${secretName}`) ?? null;
    },
    async deleteSecret(extensionId, secretName) {
      calls.push(`delete:${extensionId}:${secretName}`);
      saved.delete(`${extensionId}:${secretName}`);
    },
    async hasSecret() {
      return false;
    },
    async withSecret() {
      return null;
    },
    getServiceClient() {
      throw new Error("not implemented");
    },
    async listSecrets() {
      return [];
    },
    getAuditLog() {
      return [];
    },
  } as typeof globalThis.__piSecret;

  const session: AuthentikSessionRecord = {
    tokens: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      tokenType: "Bearer",
      expiresAt: 1735689600000,
      scope: "openid profile email",
    },
    user: {
      issuer: "https://auth.example/application/o/provider/",
      audience: ["pi-client"],
      subject: "user-123",
      email: "user@example.com",
      name: "Example User",
      preferredUsername: "example",
      nonce: "nonce-123",
      issuedAt: 1735686000,
      expiresAt: 1735689600,
    },
  };

  try {
    await saveStoredSession(session);
    const loaded = await loadStoredSession();

    assert.deepEqual(loaded, session);
    assert.deepEqual(calls, [
      `set:${TOKEN_STORE_EXTENSION_ID}:${SESSION_SECRET_NAME}`,
      `get:${TOKEN_STORE_EXTENSION_ID}:${SESSION_SECRET_NAME}:${TOKEN_STORE_EXTENSION_ID}`,
    ]);

    await clearStoredSession();
    assert.equal(await loadStoredSession(), null);
  } finally {
    globalThis.__piSecret = undefined;
  }
});

test("token-store reports absence cleanly and never falls back to plaintext storage", async () => {
  let setAttempts = 0;
  globalThis.__piSecret = {
    service: "com.earendil.pi-secret",
    async setSecret() {
      setAttempts += 1;
    },
    async getSecret() {
      return null;
    },
    async deleteSecret() {},
    async hasSecret() {
      return false;
    },
    async withSecret() {
      return null;
    },
    getServiceClient() {
      throw new Error("not implemented");
    },
    async listSecrets() {
      return [];
    },
    getAuditLog() {
      return [];
    },
  } as typeof globalThis.__piSecret;

  try {
    assert.equal(await loadStoredSession(), null);
  } finally {
    globalThis.__piSecret = undefined;
  }

  await assert.rejects(() => saveStoredSession({
    tokens: {
      accessToken: "access-token",
      idToken: "id-token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 60_000,
    },
    user: {
      issuer: "https://auth.example/",
      audience: ["pi-client"],
      subject: "user-123",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    },
  }), /pi-secret/i);

  assert.equal(setAttempts, 0);
});
