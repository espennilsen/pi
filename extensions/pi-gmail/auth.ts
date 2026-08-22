/**
 * OAuth 2.0 authentication for Gmail API.
 *
 * Handles:
 *   - Token storage in JSON files (~/.pi/agent/db/gmail-tokens.json or gmail-tokens-[account].json)
 *   - Multi-account configuration & dynamic account switching
 *   - OAuth consent URL generation
 *   - Authorization code exchange
 *   - Automatic access token refresh
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import type { OAuthTokens, GmailSettings, GmailAccountConfig, AccountInfo } from "./types.ts";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/gmail.compose",
	"https://www.googleapis.com/auth/gmail.modify",
	"https://www.googleapis.com/auth/gmail.labels",
].join(" ");

// Token refresh buffer — refresh 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const TOKENS_FILENAME = "gmail-tokens.json";

// ── OAuth state for CSRF protection ─────────────────────────────

let pendingOAuthState: string | null = null;

export function generateOAuthState(accountName?: string): string {
	const random = crypto.randomBytes(32).toString("hex");
	pendingOAuthState = accountName ? `${accountName}:${random}` : random;
	return pendingOAuthState;
}

export function verifyOAuthState(state: string | null): { valid: boolean; account?: string } {
	if (!state || !pendingOAuthState) return { valid: false };
	const stateBuffer = Buffer.from(state);
	const expectedBuffer = Buffer.from(pendingOAuthState);
	// timingSafeEqual throws RangeError if lengths differ
	if (stateBuffer.length !== expectedBuffer.length) {
		pendingOAuthState = null;
		return { valid: false };
	}
	const valid = crypto.timingSafeEqual(stateBuffer, expectedBuffer);
	const savedState = pendingOAuthState;
	pendingOAuthState = null; // consume — single use
	if (!valid) return { valid: false };

	const colonIdx = savedState.indexOf(":");
	if (colonIdx !== -1) {
		return { valid: true, account: savedState.slice(0, colonIdx) };
	}
	return { valid: true };
}

// ── Token refresh mutex per account ─────────────────────────────

const refreshPromises = new Map<string, Promise<string>>();

// ── Account config resolution ───────────────────────────────────

export function getAccountConfig(
	settings: GmailSettings,
	accountName?: string,
): GmailAccountConfig {
	const target = accountName || settings.account || settings.defaultAccount;
	if (target && settings.accounts?.[target]) {
		const acc = settings.accounts[target];
		return {
			clientId: acc.clientId ?? settings.clientId,
			clientSecret: acc.clientSecret ?? settings.clientSecret,
			readOnly: acc.readOnly ?? settings.readOnly,
		};
	}
	return {
		clientId: settings.clientId,
		clientSecret: settings.clientSecret,
		readOnly: settings.readOnly,
	};
}

// ── Token file path ─────────────────────────────────────────────

export function getTokensPath(agentDir: string, accountName?: string): string {
	const name = accountName?.trim();
	if (name && name !== "default") {
		return path.join(agentDir, "db", `gmail-tokens-${name}.json`);
	}
	return path.join(agentDir, "db", TOKENS_FILENAME);
}

// ── Token storage ───────────────────────────────────────────────

export function loadTokens(agentDir: string, accountName?: string): OAuthTokens | null {
	const tokensPath = getTokensPath(agentDir, accountName);
	try {
		const data = fs.readFileSync(tokensPath, "utf-8");
		return JSON.parse(data) as OAuthTokens;
	} catch {
		// Fallback to default tokens file if account-specific file is missing and no explicit account specified
		if (!accountName || accountName === "default") {
			const fallbackPath = path.join(agentDir, "db", TOKENS_FILENAME);
			try {
				const data = fs.readFileSync(fallbackPath, "utf-8");
				return JSON.parse(data) as OAuthTokens;
			} catch {
				return null;
			}
		}
		return null;
	}
}

export function saveTokens(agentDir: string, tokens: OAuthTokens, accountName?: string): void {
	const tokensPath = getTokensPath(agentDir, accountName);
	fs.mkdirSync(path.dirname(tokensPath), { recursive: true });
	fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export async function clearTokens(agentDir: string, accountName?: string): Promise<void> {
	// Revoke refresh token at Google before deleting locally
	const tokens = loadTokens(agentDir, accountName);
	if (tokens?.refresh_token) {
		try {
			await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refresh_token)}`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			});
		} catch {
			// Best-effort — continue with local cleanup
		}
	}

	const tokensPath = getTokensPath(agentDir, accountName);
	try {
		fs.unlinkSync(tokensPath);
	} catch {
		// file may not exist
	}
}

// ── OAuth flow ──────────────────────────────────────────────────

export function getConsentUrl(
	settings: GmailSettings,
	redirectUri: string,
	accountName?: string,
): string {
	const config = getAccountConfig(settings, accountName);
	const clientId = config.clientId ?? "";
	if (!clientId) throw new Error(`Gmail clientId not configured${accountName ? ` for account "${accountName}"` : ""}`);

	const state = generateOAuthState(accountName);

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: SCOPES,
		access_type: "offline",
		prompt: "select_account consent",
		state,
	});

	return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(
	settings: GmailSettings,
	code: string,
	redirectUri: string,
	agentDir: string,
	accountName?: string,
): Promise<OAuthTokens> {
	const config = getAccountConfig(settings, accountName);
	const clientId = config.clientId ?? "";
	const clientSecret = config.clientSecret ?? "";

	if (!clientId || !clientSecret) {
		throw new Error(`Gmail clientId/clientSecret not configured${accountName ? ` for account "${accountName}"` : ""}`);
	}

	const resp = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		}),
	});

	if (!resp.ok) {
		const err = await resp.text();
		throw new Error(`Token exchange failed: ${resp.status} ${err}`);
	}

	const data = (await resp.json()) as any;

	// Get user email from the access token
	const email = await fetchUserEmail(data.access_token);

	const tokens: OAuthTokens = {
		email,
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
		scope: data.scope ?? SCOPES,
	};

	saveTokens(agentDir, tokens, accountName);
	return tokens;
}

// ── Token refresh ───────────────────────────────────────────────

export async function getAccessToken(
	settings: GmailSettings,
	agentDir: string,
	accountName?: string,
): Promise<string> {
	const accountKey = accountName || settings.account || "default";
	const tokens = loadTokens(agentDir, accountName || settings.account);
	if (!tokens) {
		throw new Error(
			`Not authenticated${accountName || settings.account ? ` for account "${accountName || settings.account}"` : ""}. Run /gmail-auth to connect.`,
		);
	}

	// Check if token is still valid (with buffer)
	if (Date.now() < tokens.expires_at - REFRESH_BUFFER_MS) {
		return tokens.access_token;
	}

	// Use mutex per account to prevent concurrent refresh races
	const existing = refreshPromises.get(accountKey);
	if (existing) return existing;

	const promise = refreshAccessToken(settings, agentDir, tokens, accountName || settings.account).finally(() => {
		refreshPromises.delete(accountKey);
	});

	refreshPromises.set(accountKey, promise);
	return promise;
}

async function refreshAccessToken(
	settings: GmailSettings,
	agentDir: string,
	tokens: OAuthTokens,
	accountName?: string,
): Promise<string> {
	const config = getAccountConfig(settings, accountName);
	const clientId = config.clientId ?? "";
	const clientSecret = config.clientSecret ?? "";

	if (!clientId || !clientSecret) {
		throw new Error(
			`Gmail clientId/clientSecret not configured for token refresh${accountName ? ` (account "${accountName}")` : ""}`,
		);
	}

	const resp = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: tokens.refresh_token,
			grant_type: "refresh_token",
		}),
	});

	if (!resp.ok) {
		const err = await resp.text();
		// On 4xx errors (revoked token, invalid grant), clear stale tokens
		// to break the retry loop and guide the user to re-authenticate
		if (resp.status >= 400 && resp.status < 500) {
			await clearTokens(agentDir, accountName);
			throw new Error(
				`Gmail refresh token revoked or invalid (${resp.status})${accountName ? ` for account "${accountName}"` : ""}. Run /gmail-auth to reconnect.`,
			);
		}
		throw new Error(`Token refresh failed: ${resp.status} ${err}`);
	}

	const data = (await resp.json()) as any;

	const updated: OAuthTokens = {
		...tokens,
		access_token: data.access_token,
		expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
	};

	// Google sometimes returns a new refresh token
	if (data.refresh_token) {
		updated.refresh_token = data.refresh_token;
	}

	saveTokens(agentDir, updated, accountName);
	return updated.access_token;
}

export function isAuthenticated(agentDir: string, accountName?: string): boolean {
	const tokens = loadTokens(agentDir, accountName);
	return tokens !== null;
}

export function getAuthenticatedEmail(agentDir: string, accountName?: string): string | null {
	const tokens = loadTokens(agentDir, accountName);
	return tokens?.email ?? null;
}

// ── Multi-account discovery & listing ───────────────────────────

export function listAccounts(
	settings: GmailSettings,
	agentDir: string,
	activeAccount?: string,
): AccountInfo[] {
	const names = new Set<string>();

	if (settings.accounts && Object.keys(settings.accounts).length > 0) {
		for (const name of Object.keys(settings.accounts)) {
			names.add(name);
		}
	} else {
		const dbDir = path.join(agentDir, "db");
		if (fs.existsSync(dbDir)) {
			try {
				const files = fs.readdirSync(dbDir);
				for (const file of files) {
					if (file === "gmail-tokens.json") {
						names.add("default");
					} else if (file.startsWith("gmail-tokens-") && file.endsWith(".json")) {
						const name = file.slice("gmail-tokens-".length, -".json".length);
						if (name) names.add(name);
					}
				}
			} catch {}
		}
	}

	if (names.size === 0 && (settings.clientId || isAuthenticated(agentDir))) {
		names.add("default");
	}

	const defaultName = settings.defaultAccount || "default";
	const currentActive = activeAccount || settings.account || defaultName;

	const list: AccountInfo[] = [];
	for (const name of names) {
		const targetName = name === "default" ? undefined : name;
		const email = getAuthenticatedEmail(agentDir, targetName);
		const authed = isAuthenticated(agentDir, targetName);
		list.push({
			name,
			email,
			authenticated: authed,
			isDefault: name === defaultName,
			isActive: name === currentActive,
		});
	}

	return list.sort((a, b) => (a.name === defaultName ? -1 : b.name === defaultName ? 1 : a.name.localeCompare(b.name)));
}

// ── Helpers ─────────────────────────────────────────────────────

export async function fetchUserEmail(accessToken: string): Promise<string> {
	// 1. Try Gmail user profile API (covered by gmail.readonly scope)
	try {
		const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (resp.ok) {
			const data = (await resp.json()) as any;
			if (data.emailAddress) return data.emailAddress;
		}
	} catch {}

	// 2. Try UserInfo endpoint
	try {
		const resp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (resp.ok) {
			const data = (await resp.json()) as any;
			if (data.email) return data.email;
		}
	} catch {}

	return "unknown";
}
