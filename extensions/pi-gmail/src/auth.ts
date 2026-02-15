/**
 * OAuth 2.0 authentication for Gmail API.
 *
 * Handles:
 *   - Token storage in a JSON file (~/.pi/agent/db/gmail-tokens.json)
 *   - OAuth consent URL generation
 *   - Authorization code exchange
 *   - Automatic access token refresh
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import type { OAuthTokens, GmailSettings } from "./types.ts";
import { resolveEnv } from "./utils.ts";

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

let cachedTokens: OAuthTokens | null = null;

// ── OAuth state for CSRF protection ─────────────────────────────

let pendingOAuthState: string | null = null;

export function generateOAuthState(): string {
	const state = crypto.randomBytes(32).toString("hex");
	pendingOAuthState = state;
	return state;
}

export function verifyOAuthState(state: string | null): boolean {
	if (!state || !pendingOAuthState) return false;
	const stateBuffer = Buffer.from(state);
	const expectedBuffer = Buffer.from(pendingOAuthState);
	// timingSafeEqual throws RangeError if lengths differ
	if (stateBuffer.length !== expectedBuffer.length) {
		pendingOAuthState = null;
		return false;
	}
	const valid = crypto.timingSafeEqual(stateBuffer, expectedBuffer);
	pendingOAuthState = null; // consume — single use
	return valid;
}

// ── Token refresh mutex ─────────────────────────────────────────

let refreshPromise: Promise<string> | null = null;

// ── Token file path ─────────────────────────────────────────────

function getTokensPath(agentDir: string): string {
	return path.join(agentDir, "db", TOKENS_FILENAME);
}

// ── Token storage ───────────────────────────────────────────────

export function loadTokens(agentDir: string): OAuthTokens | null {
	if (cachedTokens) return cachedTokens;

	const tokensPath = getTokensPath(agentDir);
	try {
		const data = fs.readFileSync(tokensPath, "utf-8");
		cachedTokens = JSON.parse(data) as OAuthTokens;
		return cachedTokens;
	} catch {
		return null;
	}
}

export function saveTokens(agentDir: string, tokens: OAuthTokens): void {
	const tokensPath = getTokensPath(agentDir);
	fs.mkdirSync(path.dirname(tokensPath), { recursive: true });
	fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), { encoding: "utf-8", mode: 0o600 });
	cachedTokens = tokens;
}

export function clearTokens(agentDir: string): void {
	const tokensPath = getTokensPath(agentDir);
	try {
		fs.unlinkSync(tokensPath);
	} catch {
		// file may not exist
	}
	cachedTokens = null;
}

// ── OAuth flow ──────────────────────────────────────────────────

export function getConsentUrl(settings: GmailSettings, redirectUri: string): string {
	const clientId = resolveEnv(settings.clientId ?? "");
	if (!clientId) throw new Error("Gmail clientId not configured");

	const state = generateOAuthState();

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: SCOPES,
		access_type: "offline",
		prompt: "consent",
		state,
	});

	return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(
	settings: GmailSettings,
	code: string,
	redirectUri: string,
	agentDir: string,
): Promise<OAuthTokens> {
	const clientId = resolveEnv(settings.clientId ?? "");
	const clientSecret = resolveEnv(settings.clientSecret ?? "");

	if (!clientId || !clientSecret) {
		throw new Error("Gmail clientId/clientSecret not configured");
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

	const data = await resp.json() as any;

	// Get user email from the access token
	const email = await fetchUserEmail(data.access_token);

	const tokens: OAuthTokens = {
		email,
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
		scope: data.scope ?? SCOPES,
	};

	saveTokens(agentDir, tokens);
	return tokens;
}

// ── Token refresh ───────────────────────────────────────────────

export async function getAccessToken(
	settings: GmailSettings,
	agentDir: string,
): Promise<string> {
	const tokens = loadTokens(agentDir);
	if (!tokens) throw new Error("Not authenticated. Run /gmail-auth to connect.");

	// Check if token is still valid (with buffer)
	if (Date.now() < tokens.expires_at - REFRESH_BUFFER_MS) {
		return tokens.access_token;
	}

	// Use mutex to prevent concurrent refresh races
	if (refreshPromise) return refreshPromise;

	refreshPromise = refreshAccessToken(settings, agentDir, tokens).finally(() => {
		refreshPromise = null;
	});

	return refreshPromise;
}

async function refreshAccessToken(
	settings: GmailSettings,
	agentDir: string,
	tokens: OAuthTokens,
): Promise<string> {
	const clientId = resolveEnv(settings.clientId ?? "");
	const clientSecret = resolveEnv(settings.clientSecret ?? "");

	if (!clientId || !clientSecret) {
		throw new Error("Gmail clientId/clientSecret not configured for token refresh");
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
		throw new Error(`Token refresh failed: ${resp.status} ${err}`);
	}

	const data = await resp.json() as any;

	const updated: OAuthTokens = {
		...tokens,
		access_token: data.access_token,
		expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
	};

	// Google sometimes returns a new refresh token
	if (data.refresh_token) {
		updated.refresh_token = data.refresh_token;
	}

	saveTokens(agentDir, updated);
	return updated.access_token;
}

export function isAuthenticated(agentDir: string): boolean {
	const tokens = loadTokens(agentDir);
	return tokens !== null;
}

export function getAuthenticatedEmail(agentDir: string): string | null {
	const tokens = loadTokens(agentDir);
	return tokens?.email ?? null;
}

// ── Helpers ─────────────────────────────────────────────────────

async function fetchUserEmail(accessToken: string): Promise<string> {
	const resp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!resp.ok) return "unknown";
	const data = await resp.json() as any;
	return data.email ?? "unknown";
}
