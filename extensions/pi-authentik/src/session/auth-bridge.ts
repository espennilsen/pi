import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

import type { AuthentikSessionRecord } from "../shared/types.ts";

/** Auth file path used by Pi for OAuth credential storage. */
function getAuthPath(): string {
  return path.join(getAgentDir(), "auth.json");
}

/** Provider key used in auth.json. */
export const AUTH_PROVIDER_KEY = "authentik";

/**
 * Writes the exchanged session credentials into Pi's auth.json so the
 * model picker recognises the provider as authenticated.
 * @param session - Authenticated session record with exchanged tokens.
 */
export function writeAuthCredentials(session: AuthentikSessionRecord): void {
  const authPath = getAuthPath();
  const root = readAuthFile(authPath);

  root[AUTH_PROVIDER_KEY] = {
    type: "oauth",
    access: session.tokens.accessToken,
    refresh: session.tokens.refreshToken ?? "",
    expires: session.tokens.expiresAt * 1000,
  };

  writeAuthFile(authPath, root);
}

/**
 * Removes the extension's credentials from auth.json.
 */
export function clearAuthCredentials(): void {
  const authPath = getAuthPath();
  const root = readAuthFile(authPath);

  if (AUTH_PROVIDER_KEY in root) {
    delete root[AUTH_PROVIDER_KEY];
    writeAuthFile(authPath, root);
  }
}

function readAuthFile(authPath: string): Record<string, unknown> {
  try {
    const data = fs.readFileSync(authPath, "utf-8");
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeAuthFile(authPath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(authPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${authPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  fs.renameSync(tmp, authPath);
}
