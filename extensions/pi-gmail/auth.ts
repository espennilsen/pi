/**
 * OAuth 2.0 authentication for Gmail API.
 *
 * Handles:
 *   - Token storage in JSON files (~/.pi/agent/db/gmail-tokens.json or gmail-tokens-[account].json)
 *   - Multi-account configuration & dynamic account switching
 *   - OAuth consent URL generation with concurrent state isolation
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
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const TOKENS_FILENAME = "gmail-tokens.json";
const SAFE_ACCOUNT_NAME_RE = /^[a-zA-Z0-9_-]+$/;

// ── Account name validation ─────────────────────────────────────

/** Reject names that cannot safely identify an account or token file.
 * @param name - Optional account name; `default` denotes the legacy token file.
 */
export function validateAccountName(name?: string): void {
	if (!name || name === "default") return;
	if (!SAFE_ACCOUNT_NAME_RE.test(name)) {
		throw new Error(
			`Invalid account name "${name}". Account names may only contain letters, numbers, underscores, and hyphens.`,
		);
	}
}

// ── OAuth state for CSRF protection & concurrency ───────────────

interface OAuthStateEntry {
	account?: string;
	createdAt: number;
}

const pendingOAuthStates = new Map<string, OAuthStateEntry>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PENDING_OAUTH_STATES = 100;

/** Create a single-use, ten-minute OAuth state while bounding pending flows to 100.
 * @param accountName - Logical account to preserve through the callback.
 * @returns An opaque random state value.
 */
export function generateOAuthState(accountName?: string): string {
	validateAccountName(accountName);

	// Prune expired states
	const now = Date.now();
	for (const [key, val] of pendingOAuthStates) {
		if (now - val.createdAt > OAUTH_STATE_TTL_MS) {
			pendingOAuthStates.delete(key);
		}
	}

	// Enforce maximum capacity by evicting oldest entry if limit reached
	if (pendingOAuthStates.size >= MAX_PENDING_OAUTH_STATES) {
		const oldestKey = pendingOAuthStates.keys().next().value;
		if (oldestKey) pendingOAuthStates.delete(oldestKey);
	}

	const state = crypto.randomBytes(32).toString("hex");
	pendingOAuthStates.set(state, {
		account: accountName,
		createdAt: now,
	});
	return state;
}

/** Consume an OAuth state and recover its account if it has not expired.
 * @param state - State supplied by the OAuth callback.
 * @returns Validation result and the original logical account.
 */
export function verifyOAuthState(state: string | null): { valid: boolean; account?: string } {
	if (!state) return { valid: false };
	const entry = pendingOAuthStates.get(state);
	if (!entry) return { valid: false };

	pendingOAuthStates.delete(state); // single use
	if (Date.now() - entry.createdAt > OAUTH_STATE_TTL_MS) {
		return { valid: false };
	}
	return { valid: true, account: entry.account };
}

// ── Token refresh mutex per account ─────────────────────────────

const refreshPromises = new Map<string, Promise<string>>();

// ── Account config resolution ───────────────────────────────────

/** Resolve per-account credentials and read-only policy over global defaults.
 * @param settings - Gmail configuration containing active and default selections.
 * @param accountName - Explicit selection; `default` bypasses named accounts.
 * @returns Merged configuration; throws for an unknown configured-account selection.
 */
export function getAccountConfig(
	settings: GmailSettings,
	accountName?: string,
): GmailAccountConfig {
	const target = accountName || settings.account || settings.defaultAccount;
	if (target && target !== "default") {
		validateAccountName(target);
		if (settings.accounts && Object.keys(settings.accounts).length > 0) {
			const acc = settings.accounts[target];
			if (!acc) {
				throw new Error(`Account "${target}" is not configured in settings.json`);
			}
			return {
				clientId: acc.clientId ?? settings.clientId,
				clientSecret: acc.clientSecret ?? settings.clientSecret,
				readOnly: acc.readOnly ?? settings.readOnly,
			};
		}
	}
	return {
		clientId: settings.clientId,
		clientSecret: settings.clientSecret,
		readOnly: settings.readOnly,
	};
}

// ── Token file path ─────────────────────────────────────────────

/** Resolve an isolated token path, normalizing `default` only at storage boundaries.
 * @param agentDir - Agent data directory.
 * @param accountName - Named account, or omitted/`default` for legacy storage.
 * @returns Absolute token filename under the agent's db directory.
 */
export function getTokensPath(agentDir: string, accountName?: string): string {
	const name = accountName?.trim();
	if (name && name !== "default") {
		validateAccountName(name);
		return path.join(agentDir, "db", `gmail-tokens-${name}.json`);
	}
	return path.join(agentDir, "db", TOKENS_FILENAME);
}

// ── Token storage ───────────────────────────────────────────────

/** Read tokens without falling back to another account's token file.
 * @param agentDir - Agent data directory.
 * @param accountName - Account whose stored tokens should be read.
 * @returns Stored tokens, or null when missing or unreadable.
 */
export function loadTokens(agentDir: string, accountName?: string): OAuthTokens | null {
	const tokensPath = getTokensPath(agentDir, accountName);
	try {
		const data = fs.readFileSync(tokensPath, "utf-8");
		return JSON.parse(data) as OAuthTokens;
	} catch {
		return null;
	}
}

/** Persist tokens in the selected account's file, creating it with owner-only access.
 * @param agentDir - Agent data directory.
 * @param tokens - OAuth credentials to persist.
 * @param accountName - Account whose token file should be written.
 */
export function saveTokens(agentDir: string, tokens: OAuthTokens, accountName?: string): void {
	const tokensPath = getTokensPath(agentDir, accountName);
	fs.mkdirSync(path.dirname(tokensPath), { recursive: true });
	fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), { encoding: "utf-8", mode: 0o600 });
}

/** Attempt bounded remote revocation, then remove only the selected account's tokens.
 * @param agentDir - Agent data directory.
 * @param accountName - Account to disconnect.
 */
export async function clearTokens(agentDir: string, accountName?: string): Promise<void> {
	// Revoke refresh token at Google before deleting locally
	const tokens = loadTokens(agentDir, accountName);
	if (tokens?.refresh_token) {
		try {
			await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refresh_token)}`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
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

/** Build Google consent parameters and bind the selected account to OAuth state.
 * @param settings - Gmail credentials and account selections.
 * @param redirectUri - Registered callback URL.
 * @param accountName - Explicit account, otherwise the active/default selection.
 * @returns Google authorization URL.
 */
export function getConsentUrl(
	settings: GmailSettings,
	redirectUri: string,
	accountName?: string,
): string {
	const config = getAccountConfig(settings, accountName);
	const clientId = config.clientId ?? "";
	if (!clientId) throw new Error(`Gmail clientId not configured${accountName ? ` for account "${accountName}"` : ""}`);

	// Bind omitted selections now, not against possibly changed settings at callback time.
	const state = generateOAuthState(accountName || settings.account || settings.defaultAccount || "default");

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

/** Exchange an authorization code and persist the resulting account tokens.
 * @param settings - Gmail credentials and account selections.
 * @param code - Authorization code from Google.
 * @param redirectUri - Callback URL used for consent.
 * @param agentDir - Agent data directory.
 * @param accountName - Logical account recovered from OAuth state.
 * @returns Persisted OAuth tokens, including the discovered email address.
 */
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
		signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
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

/** Obtain a usable token, sharing concurrent refresh requests for the same account.
 * @param settings - Gmail credentials and account selections.
 * @param agentDir - Agent data directory.
 * @param accountName - Explicit account, otherwise the active/default selection.
 * @returns A valid access token, or rejects if authentication/refresh fails.
 */
export async function getAccessToken(
	settings: GmailSettings,
	agentDir: string,
	accountName?: string,
): Promise<string> {
	const accountKey = accountName || settings.account || settings.defaultAccount || "default";
	const tokens = loadTokens(agentDir, accountKey);
	if (!tokens) {
		throw new Error(
			`Not authenticated for account "${accountKey}". Run /gmail-auth to connect.`,
		);
	}

	// Check if token is still valid (with buffer)
	if (Date.now() < tokens.expires_at - REFRESH_BUFFER_MS) {
		return tokens.access_token;
	}

	// Use mutex per account to prevent concurrent refresh races
	const existing = refreshPromises.get(accountKey);
	if (existing) return existing;

	const promise = refreshAccessToken(settings, agentDir, tokens, accountKey).finally(() => {
		refreshPromises.delete(accountKey);
	});

	refreshPromises.set(accountKey, promise);
	return promise;
}

/** Refresh and persist one account's credentials with a bounded HTTP timeout. */
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
		signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
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

/** Check for readable stored tokens; this does not validate them against Google.
 * @param agentDir - Agent data directory.
 * @param accountName - Account to inspect.
 * @returns Whether a token file was successfully loaded.
 */
export function isAuthenticated(agentDir: string, accountName?: string): boolean {
	const tokens = loadTokens(agentDir, accountName);
	return tokens !== null;
}

/** Read the email recorded with an account's stored tokens.
 * @param agentDir - Agent data directory.
 * @param accountName - Account to inspect.
 * @returns Cached email, or null if unavailable.
 */
export function getAuthenticatedEmail(agentDir: string, accountName?: string): string | null {
	const tokens = loadTokens(agentDir, accountName);
	return tokens?.email ?? null;
}

// ── Multi-account discovery & listing ───────────────────────────

/** Merge configured accounts and discovered token files into an account listing.
 * @param settings - Configured accounts and default selection.
 * @param agentDir - Agent data directory to scan.
 * @param activeAccount - Optional current selection overriding settings.
 * @returns Account status entries, with the default account sorted first.
 */
export function listAccounts(
	settings: GmailSettings,
	agentDir: string,
	activeAccount?: string,
): AccountInfo[] {
	const names = new Set<string>();

	if (settings.accounts) {
		for (const name of Object.keys(settings.accounts)) {
			names.add(name);
		}
	}

	const dbDir = path.join(agentDir, "db");
	if (fs.existsSync(dbDir)) {
		try {
			const files = fs.readdirSync(dbDir);
			for (const file of files) {
				if (file === "gmail-tokens.json") {
					if (!settings.accounts || Object.keys(settings.accounts).length === 0) {
						names.add("default");
					}
				} else if (file.startsWith("gmail-tokens-") && file.endsWith(".json")) {
					const name = file.slice("gmail-tokens-".length, -".json".length);
					if (name) names.add(name);
				}
			}
		} catch {}
	}

	if (names.size === 0 && (settings.clientId || isAuthenticated(agentDir))) {
		names.add("default");
	}

	const defaultName = settings.defaultAccount || (names.has("default") ? "default" : names.values().next().value || "default");
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

/** Discover email via Gmail profile, then UserInfo, using bounded requests.
 * @param accessToken - Google access token authorized for profile lookup.
 * @returns The discovered email, or `unknown` when both lookups fail.
 */
export async function fetchUserEmail(accessToken: string): Promise<string> {
	// 1. Try Gmail user profile API (covered by gmail.readonly scope)
	try {
		const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
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
			signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
		});
		if (resp.ok) {
			const data = (await resp.json()) as any;
			if (data.email) return data.email;
		}
	} catch {}

	return "unknown";
}
