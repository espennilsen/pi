import type { AuthentikSessionRecord, PiSecretApiLike } from "../shared/types.ts";

/** Extension identifier used when persisting secrets through `pi-secret`. */
export const TOKEN_STORE_EXTENSION_ID = "pi-authentik";
/** Secret name used for the serialized authentik session payload. */
export const SESSION_SECRET_NAME = "session";
/** Secret name used for the OAuth client secret. */
export const CLIENT_SECRET_NAME = "clientSecret";

/**
 * Persists an authenticated session through `pi-secret`.
 * @param session - Verified session record to serialize and store securely.
 */
export async function saveStoredSession(session: AuthentikSessionRecord): Promise<void> {
  const secretApi = requireSecretApi();
  validateSessionRecord(session);
  await secretApi.setSecret(TOKEN_STORE_EXTENSION_ID, SESSION_SECRET_NAME, JSON.stringify(session));
}

/**
 * Loads the previously stored authentik session from `pi-secret`.
 * @returns The validated stored session, or null when no session is present.
 */
export async function loadStoredSession(): Promise<AuthentikSessionRecord | null> {
  const secretApi = globalThis.__piSecret;
  if (!secretApi) return null;

  const serialized = await secretApi.getSecret(TOKEN_STORE_EXTENSION_ID, SESSION_SECRET_NAME, TOKEN_STORE_EXTENSION_ID);
  if (serialized === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Stored authentik session is invalid JSON");
  }

  return validateSessionRecord(parsed);
}

/**
 * Deletes the stored authentik session from `pi-secret`.
 */
export async function clearStoredSession(): Promise<void> {
  const secretApi = globalThis.__piSecret;
  if (!secretApi) return;
  await secretApi.deleteSecret(TOKEN_STORE_EXTENSION_ID, SESSION_SECRET_NAME);
}

/**
 * Persists an OAuth client secret through `pi-secret`.
 * @param value - Raw client secret to store securely.
 */
export async function saveClientSecret(value: string): Promise<void> {
  const secretApi = globalThis.__piSecret;
  if (!secretApi) return;
  await secretApi.setSecret(TOKEN_STORE_EXTENSION_ID, CLIENT_SECRET_NAME, value);
}

/**
 * Loads the previously stored OAuth client secret from `pi-secret`.
 * @returns The stored client secret, or null when not present.
 */
export async function loadClientSecret(): Promise<string | null> {
  const secretApi = globalThis.__piSecret;
  if (!secretApi) return null;
  return secretApi.getSecret(TOKEN_STORE_EXTENSION_ID, CLIENT_SECRET_NAME, TOKEN_STORE_EXTENSION_ID);
}

/**
 * Deletes the stored OAuth client secret from `pi-secret`.
 */
export async function clearClientSecret(): Promise<void> {
  const secretApi = globalThis.__piSecret;
  if (!secretApi) return;
  await secretApi.deleteSecret(TOKEN_STORE_EXTENSION_ID, CLIENT_SECRET_NAME);
}

function requireSecretApi(): PiSecretApiLike {
  if (!globalThis.__piSecret) {
    throw new Error("pi-secret is required for authentik token storage");
  }
  return globalThis.__piSecret;
}

function validateSessionRecord(value: unknown): AuthentikSessionRecord {
  if (!isRecord(value)) throw new Error("Stored authentik session must be an object");
  const tokens = isRecord(value.tokens) ? value.tokens : null;
  const user = isRecord(value.user) ? value.user : null;

  if (!tokens || !user) throw new Error("Stored authentik session is missing tokens or user data");

  const session: AuthentikSessionRecord = {
    tokens: {
      accessToken: requiredString(tokens.accessToken, "tokens.accessToken"),
      idToken: requiredString(tokens.idToken, "tokens.idToken"),
      tokenType: requiredString(tokens.tokenType, "tokens.tokenType"),
      expiresAt: requiredNumber(tokens.expiresAt, "tokens.expiresAt"),
      refreshToken: optionalString(tokens.refreshToken),
      scope: optionalString(tokens.scope),
    },
    user: {
      issuer: requiredString(user.issuer, "user.issuer"),
      audience: requiredStringArray(user.audience, "user.audience"),
      subject: requiredString(user.subject, "user.subject"),
      expiresAt: requiredNumber(user.expiresAt, "user.expiresAt"),
      nonce: optionalString(user.nonce),
      issuedAt: optionalNumber(user.issuedAt),
      email: optionalString(user.email),
      name: optionalString(user.name),
      preferredUsername: optionalString(user.preferredUsername),
    },
  };

  return session;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Stored authentik session is missing ${label}`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Stored authentik session is missing ${label}`);
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`Stored authentik session is missing ${label}`);
  }
  return [...value];
}
