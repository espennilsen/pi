/**
 * pi-gmail — Gmail extension for pi.
 *
 * Gives the agent read, search, compose, and send capabilities for Gmail.
 *
 * Config in settings.json under "pi-gmail":
 * {
 *   "pi-gmail": {
 *     "readOnly": true,
 *     "confirmBeforeSend": true
 *   }
 * }
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createGmailAuthFromEnv, type GmailAuth } from "./auth.ts";

// ── Shared state ────────────────────────────────────────────────

let auth: GmailAuth | null = null;

export function getAuth(): GmailAuth | null {
	return auth;
}

// ── Extension entry ─────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		// Initialize auth from env vars
		auth = createGmailAuthFromEnv();

		if (!auth.isConfigured()) {
			ctx.ui.notify(
				"pi-gmail: Not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN env vars.",
				"warning",
			);
			// Keep auth for /gmail-auth flow (only needs client credentials)
			if (!auth.hasClientCredentials()) {
				auth = null;
			}
			return;
		}

		// Validate credentials on startup
		const validation = await auth.validate();
		if (!validation.ok) {
			ctx.ui.notify(`pi-gmail: Auth validation failed: ${validation.error}`, "warning");
			auth = null;
		}
	});

	// ── Setup command ─────────────────────────────────────────

	pi.registerCommand("gmail-setup", {
		description: "Show Gmail OAuth setup instructions",
		handler: async (_args, ctx) => {
			if (!auth) {
				auth = createGmailAuthFromEnv();
			}

			const lines = [
				"📧 Gmail OAuth Setup",
				"",
				"1. Create a Google Cloud project at https://console.cloud.google.com",
				"2. Enable the Gmail API",
				'3. Create OAuth 2.0 credentials (Desktop app type)',
				"4. Set environment variables:",
				"   GOOGLE_CLIENT_ID=your-client-id",
				"   GOOGLE_CLIENT_SECRET=your-client-secret",
				"",
				"5. Get a refresh token:",
				"   - Visit the consent URL (run /gmail-auth)",
				"   - Grant access → get authorization code",
				"   - Run /gmail-auth <code> to exchange for refresh token",
				"   - Set GOOGLE_REFRESH_TOKEN=the-refresh-token",
				"",
				`Status: ${auth.isConfigured() ? "✅ Configured" : "❌ Missing credentials"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("gmail-auth", {
		description: "Start OAuth flow or exchange auth code: /gmail-auth [code]",
		handler: async (args, ctx) => {
			if (!auth) {
				auth = createGmailAuthFromEnv();
			}

			if (!auth.hasClientCredentials()) {
				ctx.ui.notify(
					"Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first. Run /gmail-setup for instructions.",
					"warning",
				);
				return;
			}

			const code = args?.trim();
			if (!code) {
				// Start local server and generate consent URL
				const consentUrl = auth.getConsentUrl();
				ctx.ui.notify(
					`Starting OAuth flow...\n\nVisit this URL to authorize:\n${consentUrl}\n\nA local server is listening for the callback.`,
					"info",
				);
				try {
					const tokens = await auth.authorizeWithLocalServer();
					const masked = tokens.refreshToken.slice(0, 10) + "…" + tokens.refreshToken.slice(-4);
					ctx.ui.notify(
						`✅ Authentication successful!\n\nRefresh token (masked): ${masked}\n\nSet GOOGLE_REFRESH_TOKEN in your environment. The full token has been printed to stdout.`,
						"info",
					);
					// Print full token to stdout (not to ui.notify which may be logged)
					process.stdout.write(`\nGOOGLE_REFRESH_TOKEN=${tokens.refreshToken}\n\n`);
				} catch (err: any) {
					ctx.ui.notify(`❌ OAuth flow failed: ${err.message}`, "warning");
				}
				return;
			}

			// Manual code exchange (fallback)
			try {
				const tokens = await auth.exchangeAuthCode(code);
				const masked = tokens.refreshToken.slice(0, 10) + "…" + tokens.refreshToken.slice(-4);
				ctx.ui.notify(
					`✅ Authentication successful!\n\nRefresh token (masked): ${masked}\n\nSet GOOGLE_REFRESH_TOKEN in your environment. The full token has been printed to stdout.`,
					"info",
				);
				process.stdout.write(`\nGOOGLE_REFRESH_TOKEN=${tokens.refreshToken}\n\n`);
			} catch (err: any) {
				ctx.ui.notify(`❌ Code exchange failed: ${err.message}`, "warning");
			}
		},
	});
}
