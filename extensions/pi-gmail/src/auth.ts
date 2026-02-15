/**
 * OAuth 2.0 authentication for Gmail API.
 *
 * Handles:
 *   - Token storage in SQLite (db/gmail.db)
 *   - OAuth consent URL generation
 *   - Authorization code exchange
 *   - Automatic access token refresh
 */

import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import type { OAuthTokens, GmailSettings } from "./types.ts";

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

let db: Database.Database | null = null;
let cachedTokens: OAuthTokens | null = null;

// ── DB setup ────────────────────────────────────────────────────

function getDb(agentDir: string): Database.Database {
	if (db) return db;

	const dbPath = path.join(agentDir, "db", "gmail.db");
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });

	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");

	db.exec(`
		CREATE TABLE IF NOT EXISTS gmail_tokens (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			email TEXT NOT NULL,
			access_token TEXT NOT NULL,
			refresh_token TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			scope TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	return db;
}

// ── Token storage ───────────────────────────────────────────────

export function loadTokens(agentDir: string): OAuthTokens | null {
	if (cachedTokens) return cachedTokens;

	const d = getDb(agentDir);
	const row = d.prepare("SELECT * FROM gmail_tokens WHERE id = 1").get() as any;
	if (!row) return null;

	cachedTokens = {
		email: row.email,
		access_token: row.access_token,
		refresh_token: row.refresh_token,
		expires_at: row.expires_at,
		scope: row.scope,
	};
	return cachedTokens;
}

export function saveTokens(agentDir: string, tokens: OAuthTokens): void {
	const d = getDb(agentDir);
	d.prepare(`
		INSERT INTO gmail_tokens (id, email, access_token, refresh_token, expires_at, scope)
		VALUES (1, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			email = excluded.email,
			access_token = excluded.access_token,
			refresh_token = excluded.refresh_token,
			expires_at = excluded.expires_at,
			scope = excluded.scope,
			updated_at = datetime('now')
	`).run(tokens.email, tokens.access_token, tokens.refresh_token, tokens.expires_at, tokens.scope);
	cachedTokens = tokens;
}

export function clearTokens(agentDir: string): void {
	const d = getDb(agentDir);
	d.prepare("DELETE FROM gmail_tokens WHERE id = 1").run();
	cachedTokens = null;
}

// ── OAuth flow ──────────────────────────────────────────────────

export function getConsentUrl(settings: GmailSettings, redirectUri: string): string {
	const clientId = resolveEnv(settings.clientId ?? "");
	if (!clientId) throw new Error("Gmail clientId not configured");

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: SCOPES,
		access_type: "offline",
		prompt: "consent",
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

	// Refresh the token
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

function resolveEnv(value: string): string {
	if (value.startsWith("env:")) {
		return process.env[value.slice(4)] ?? "";
	}
	return value;
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
	cachedTokens = null;
}
