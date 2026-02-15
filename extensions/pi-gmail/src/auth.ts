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
const LOOPBACK_PORT = 8914;
const LOOPBACK_REDIRECT = `http://127.0.0.1:${LOOPBACK_PORT}`;

/** Buffer before expiry to refresh proactively (5 minutes) */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const DEFAULT_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

// ── Auth Manager ────────────────────────────────────────────────

export class GmailAuth {
	private config: GmailAuthConfig;
	private cachedToken: CachedToken | null = null;
	/** Pending refresh promise — deduplicates concurrent refresh calls */
	private refreshPromise: Promise<string> | null = null;

	constructor(config: GmailAuthConfig) {
		this.config = config;
	}

	/**
	 * Get a valid access token. Returns cached token if still valid,
	 * otherwise refreshes automatically. Concurrent calls are deduplicated.
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
	 * Concurrent calls are deduplicated — only one refresh request fires.
	 */
	async refresh(): Promise<string> {
		if (this.refreshPromise) {
			return this.refreshPromise;
		}
		this.refreshPromise = this.doRefresh();
		try {
			return await this.refreshPromise;
		} finally {
			this.refreshPromise = null;
		}
	}

	private async doRefresh(): Promise<string> {
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
	 * Check if all credentials are configured for normal operation.
	 */
	isConfigured(): boolean {
		return !!(this.config.clientId && this.config.clientSecret && this.config.refreshToken);
	}

	/**
	 * Check if client credentials are set (enough to generate consent URL).
	 * Does not require refreshToken — that's obtained via the auth flow.
	 */
	hasClientCredentials(): boolean {
		return !!(this.config.clientId && this.config.clientSecret);
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
	 * Uses loopback redirect (http://127.0.0.1) — the deprecated OOB flow
	 * is blocked for new OAuth clients since Oct 2022.
	 */
	getConsentUrl(redirectUri: string = LOOPBACK_REDIRECT): string {
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
	 * Start a temporary local HTTP server, open the consent URL,
	 * capture the auth code callback, exchange it for tokens, and shut down.
	 * Returns the refresh token.
	 */
	async authorizeWithLocalServer(): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
		const http = await import("node:http");

		return new Promise((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | null = null;

			function cleanup(server: ReturnType<typeof http.createServer>) {
				if (timer) { clearTimeout(timer); timer = null; }
				server.close();
			}

			const server = http.createServer(async (req, res) => {
				const url = new URL(req.url ?? "/", LOOPBACK_REDIRECT);
				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");

				if (error) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(`<h1>Authorization failed</h1><p>${escapeHtml(error)}</p><p>You can close this tab.</p>`);
					cleanup(server);
					reject(new Error(`OAuth denied: ${error}`));
					return;
				}

				if (!code) {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end("<h1>Missing authorization code</h1>");
					return;
				}

				// Exchange code BEFORE sending success response
				try {
					const tokens = await this.exchangeAuthCode(code, LOOPBACK_REDIRECT);
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end("<h1>✅ Authorization successful!</h1><p>You can close this tab and return to the terminal.</p>");
					cleanup(server);
					resolve(tokens);
				} catch (err: any) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(`<h1>❌ Token exchange failed</h1><p>${escapeHtml(err.message ?? "Unknown error")}</p><p>Check the terminal for details.</p>`);
					cleanup(server);
					reject(err);
				}
			});

			server.listen(LOOPBACK_PORT, "127.0.0.1", () => {
				// Server is ready — consent URL uses this port
			});

			server.on("error", (err) => {
				if (timer) { clearTimeout(timer); timer = null; }
				reject(new Error(`Failed to start local auth server: ${err.message}`));
			});

			// Auto-close after 5 minutes
			timer = setTimeout(() => {
				timer = null;
				server.close();
				reject(new Error("OAuth authorization timed out (5 minutes)"));
			}, 5 * 60 * 1000);
		});
	}

	/**
	 * Exchange an authorization code for tokens (including refresh token).
	 * Used during initial setup only.
	 */
	async exchangeAuthCode(
		code: string,
		redirectUri: string = LOOPBACK_REDIRECT,
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
 * Override values support the "env:VAR_NAME" pattern (resolved via process.env).
 */
export function createGmailAuthFromEnv(overrides?: Partial<GmailAuthConfig>): GmailAuth {
	const config: GmailAuthConfig = {
		clientId: resolveEnvValue(overrides?.clientId) ?? process.env.GOOGLE_CLIENT_ID ?? "",
		clientSecret: resolveEnvValue(overrides?.clientSecret) ?? process.env.GOOGLE_CLIENT_SECRET ?? "",
		refreshToken: resolveEnvValue(overrides?.refreshToken) ?? process.env.GOOGLE_REFRESH_TOKEN ?? "",
		scopes: overrides?.scopes,
	};
	return new GmailAuth(config);
}

/**
 * Resolve "env:VAR_NAME" pattern to the actual environment variable value.
 * If the value doesn't start with "env:", returns it as-is.
 */
function resolveEnvValue(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (value.startsWith("env:")) {
		const envVar = value.slice(4);
		return process.env[envVar] ?? undefined;
	}
	return value;
}

/** Escape HTML special characters to prevent XSS. */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
