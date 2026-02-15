/**
 * pi-gmail — Google OAuth 2.0 authentication.
 *
 * Uses the refresh token flow (no browser needed at runtime):
 *   1. User obtains a refresh token once via Google OAuth consent
 *   2. Extension uses client_id + client_secret + refresh_token to get access tokens
 *   3. Access tokens are cached and auto-refreshed when expired
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID     — OAuth 2.0 client ID
 *   GOOGLE_CLIENT_SECRET — OAuth 2.0 client secret
 *   GOOGLE_REFRESH_TOKEN — Refresh token from initial OAuth consent
 *
 * Scopes:
 *   - gmail.readonly (default) — read-only access
 *   - gmail.send (when write enabled) — send emails
 *   - gmail.modify (when label management enabled) — modify labels
 */

// ── Types ───────────────────────────────────────────────────────

export interface GmailAuthConfig {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
	/** Additional scopes beyond gmail.readonly */
	scopes?: string[];
}

interface TokenResponse {
	access_token: string;
	expires_in: number;
	token_type: string;
	scope: string;
}

interface CachedToken {
	accessToken: string;
	expiresAt: number; // epoch ms
}

// ── Constants ───────────────────────────────────────────────────

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Buffer before expiry to refresh proactively (5 minutes) */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const DEFAULT_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

// ── Auth Manager ────────────────────────────────────────────────

export class GmailAuth {
	private config: GmailAuthConfig;
	private cachedToken: CachedToken | null = null;

	constructor(config: GmailAuthConfig) {
		this.config = config;
	}

	/**
	 * Get a valid access token. Returns cached token if still valid,
	 * otherwise refreshes automatically.
	 */
	async getAccessToken(): Promise<string> {
		if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - EXPIRY_BUFFER_MS) {
			return this.cachedToken.accessToken;
		}
		return this.refresh();
	}

	/**
	 * Get authorization headers for Gmail API requests.
	 */
	async getHeaders(): Promise<Record<string, string>> {
		const token = await this.getAccessToken();
		return {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};
	}

	/**
	 * Force refresh the access token.
	 */
	async refresh(): Promise<string> {
		const body = new URLSearchParams({
			client_id: this.config.clientId,
			client_secret: this.config.clientSecret,
			refresh_token: this.config.refreshToken,
			grant_type: "refresh_token",
		});

		const res = await fetch(TOKEN_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		});

		if (!res.ok) {
			const errBody = await res.text();
			throw new Error(`OAuth token refresh failed (${res.status}): ${errBody}`);
		}

		const data = (await res.json()) as TokenResponse;
		this.cachedToken = {
			accessToken: data.access_token,
			expiresAt: Date.now() + data.expires_in * 1000,
		};

		return this.cachedToken.accessToken;
	}

	/**
	 * Check if credentials are configured (does not validate them).
	 */
	isConfigured(): boolean {
		return !!(this.config.clientId && this.config.clientSecret && this.config.refreshToken);
	}

	/**
	 * Validate credentials by attempting a token refresh.
	 * Returns { ok, error? }.
	 */
	async validate(): Promise<{ ok: boolean; error?: string }> {
		try {
			await this.refresh();
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err.message };
		}
	}

	/**
	 * Generate the OAuth consent URL for initial setup.
	 * User visits this URL, grants access, gets an auth code,
	 * then exchanges it for a refresh token via exchangeAuthCode().
	 */
	getConsentUrl(redirectUri: string = "urn:ietf:wg:oauth:2.0:oob"): string {
		const scopes = [...DEFAULT_SCOPES, ...(this.config.scopes ?? [])];
		const params = new URLSearchParams({
			client_id: this.config.clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: scopes.join(" "),
			access_type: "offline",
			prompt: "consent",
		});
		return `${AUTH_ENDPOINT}?${params.toString()}`;
	}

	/**
	 * Exchange an authorization code for tokens (including refresh token).
	 * Used during initial setup only.
	 */
	async exchangeAuthCode(
		code: string,
		redirectUri: string = "urn:ietf:wg:oauth:2.0:oob",
	): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
		const body = new URLSearchParams({
			client_id: this.config.clientId,
			client_secret: this.config.clientSecret,
			code,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
		});

		const res = await fetch(TOKEN_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		});

		if (!res.ok) {
			const errBody = await res.text();
			throw new Error(`OAuth code exchange failed (${res.status}): ${errBody}`);
		}

		const data = (await res.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};

		if (!data.refresh_token) {
			throw new Error("No refresh_token in response. Ensure 'access_type=offline' and 'prompt=consent' were used.");
		}

		// Cache the new access token
		this.cachedToken = {
			accessToken: data.access_token,
			expiresAt: Date.now() + data.expires_in * 1000,
		};

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresIn: data.expires_in,
		};
	}
}

// ── Factory ─────────────────────────────────────────────────────

/**
 * Create a GmailAuth instance from environment variables.
 * Supports "env:VAR_NAME" pattern for settings-based config.
 */
export function createGmailAuthFromEnv(overrides?: Partial<GmailAuthConfig>): GmailAuth {
	const config: GmailAuthConfig = {
		clientId: overrides?.clientId ?? resolveEnv("GOOGLE_CLIENT_ID") ?? "",
		clientSecret: overrides?.clientSecret ?? resolveEnv("GOOGLE_CLIENT_SECRET") ?? "",
		refreshToken: overrides?.refreshToken ?? resolveEnv("GOOGLE_REFRESH_TOKEN") ?? "",
		scopes: overrides?.scopes,
	};
	return new GmailAuth(config);
}

/**
 * Resolve env var value: if value starts with "env:", read from process.env.
 */
function resolveEnv(name: string): string | undefined {
	return process.env[name];
}
