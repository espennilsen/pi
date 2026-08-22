/**
 * Gmail web routes — OAuth callback + auth status page.
 *
 * Web page:  /gmail       — Auth status page
 * Auth:      /gmail/auth  — Start OAuth flow (redirects to Google)
 * Callback:  /gmail/callback — OAuth callback from Google
 * API:       /api/gmail/status — Auth status JSON endpoint
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GmailSettings } from "./types.ts";
import {
	getConsentUrl,
	exchangeCode,
	isAuthenticated,
	getAuthenticatedEmail,
	clearTokens,
	verifyOAuthState,
} from "./auth.ts";
import * as crypto from "node:crypto";
import { escapeHtml } from "./utils.ts";

// ── HTTP helpers ────────────────────────────────────────────────

function json(res: ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function html(res: ServerResponse, content: string, status = 200): void {
	res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
	res.end(content);
}

// ── Types for pi-webserver ──────────────────────────────────────

type RouteHandler = (req: IncomingMessage, res: ServerResponse, subPath: string) => void | Promise<void>;

interface MountConfig {
	name: string;
	label?: string;
	description?: string;
	prefix: string;
	handler: RouteHandler;
}

interface EventBus {
	emit(event: string, data: unknown): void;
	on(event: string, handler: (...args: any[]) => void): void;
}

// ── Detect server origin from webserver ─────────────────────────

export interface GmailWebInfo {
	port: number;
	url: string;
}

let serverOrigin = "http://localhost:3100"; // fallback until pi-webserver replies

/** Keep OAuth redirects aligned with the currently listening pi-webserver. */
export function updateGmailWebInfo(info: GmailWebInfo): boolean {
	try {
		const url = new URL(info.url);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		serverOrigin = url.origin;
		return true;
	} catch {
		return false;
	}
}

function getRedirectUri(): string {
	return new URL("/gmail/callback", `${serverOrigin}/`).toString();
}

// ── CSRF token for logout form ──────────────────────────────────

let logoutCsrfToken: string | null = null;

function generateLogoutCsrf(): string {
	logoutCsrfToken = crypto.randomBytes(32).toString("hex");
	return logoutCsrfToken;
}

function verifyLogoutCsrf(token: string | null): boolean {
	if (!token || !logoutCsrfToken) return false;
	const tokenBuf = Buffer.from(token);
	const expectedBuf = Buffer.from(logoutCsrfToken);
	if (tokenBuf.length !== expectedBuf.length) return false;
	return crypto.timingSafeEqual(tokenBuf, expectedBuf);
}

// ── HTML pages ──────────────────────────────────────────────────

function authStatusPage(authenticated: boolean, email: string | null, csrfToken: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gmail — pi</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 0 20px; background: #0d1117; color: #c9d1d9; }
  h1 { color: #f0f6fc; }
  .status { padding: 20px; border-radius: 8px; margin: 20px 0; }
  .connected { background: #0d2818; border: 1px solid #238636; }
  .disconnected { background: #2d1b0e; border: 1px solid #d29922; }
  a.btn { display: inline-block; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; }
  .btn-primary { background: #238636; color: #fff; }
  .btn-danger { background: #da3633; color: #fff; margin-left: 10px; }
  .btn:hover { opacity: 0.9; }
  code { background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
</style>
</head>
<body>
<h1>📧 Gmail</h1>
${
	authenticated
		? `<div class="status connected">
			<p>✅ <strong>Connected</strong> as <code>${escapeHtml(email ?? "")}</code></p>
		</div>
		<p><a href="/gmail/auth" class="btn btn-primary">Re-authenticate</a></p>
		<form method="POST" action="/gmail/logout" style="display:inline">
			<input type="hidden" name="_csrf" value="${csrfToken}" />
			<button type="submit" class="btn btn-danger" style="border:none;cursor:pointer;font-size:inherit">Disconnect</button>
		</form>`
		: `<div class="status disconnected">
			<p>⚠️ <strong>Not connected</strong></p>
			<p>Click below to authorize pi to access your Gmail account.</p>
		</div>
		<p><a href="/gmail/auth" class="btn btn-primary">Connect Gmail</a></p>`
}
<h3>Setup</h3>
<ol>
<li>Create a Google Cloud project at <a href="https://console.cloud.google.com" style="color:#58a6ff">console.cloud.google.com</a></li>
<li>Enable the <strong>Gmail API</strong></li>
<li>Create OAuth 2.0 credentials (Desktop app or Web app)</li>
<li>Add <code>${getRedirectUri()}</code> as an authorized redirect URI</li>
<li>Add credentials to <code>settings.json</code>:
<pre style="background:#161b22;padding:12px;border-radius:6px;overflow-x:auto">
{
  "pi-gmail": {
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret"
  }
}</pre>
</li>
</ol>
</body>
</html>`;
}

function successPage(email: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gmail Connected — pi</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 0 20px; background: #0d1117; color: #c9d1d9; text-align: center; }
  .success { background: #0d2818; border: 1px solid #238636; padding: 30px; border-radius: 8px; margin: 30px 0; }
  code { background: #161b22; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
<div class="success">
  <h1>✅ Gmail Connected!</h1>
  <p>Authenticated as <code>${escapeHtml(email)}</code></p>
  <p>You can close this tab and return to pi.</p>
</div>
</body>
</html>`;
}

function errorPage(error: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Gmail Error — pi</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 0 20px; background: #0d1117; color: #c9d1d9; text-align: center; }
  .error { background: #2d1216; border: 1px solid #da3633; padding: 30px; border-radius: 8px; margin: 30px 0; }
  a { color: #58a6ff; }
</style>
</head>
<body>
<div class="error">
  <h1>❌ Authentication Failed</h1>
  <p>${escapeHtml(error)}</p>
  <p><a href="/gmail">Try again</a></p>
</div>
</body>
</html>`;
}

// ── Mount / unmount ─────────────────────────────────────────────

export function mountGmailRoutes(
	bus: EventBus,
	settings: GmailSettings,
	agentDir: string,
): void {
	// Try to detect the webserver port
	bus.emit("web:info", {
		reply: (info: any) => {
			if (typeof info?.port === "number" && typeof info.url === "string") {
				updateGmailWebInfo(info);
			}
		},
	});

	const webMount: MountConfig = {
		name: "gmail",
		label: "Gmail",
		description: "Gmail integration — auth and email management",
		prefix: "/gmail",
		handler: async (req, res, subPath) => {
			const p = subPath.replace(/\/+$/, "") || "/";

			// Status page
			if (req.method === "GET" && p === "/") {
				const authed = isAuthenticated(agentDir);
				const email = getAuthenticatedEmail(agentDir);
				const csrf = generateLogoutCsrf();
				html(res, authStatusPage(authed, email, csrf));
				return;
			}

			// Start OAuth flow
			if (req.method === "GET" && p === "/auth") {
				try {
					const urlObj = new URL(req.url ?? "/", `${serverOrigin}/`);
					const account = urlObj.searchParams.get("account") || undefined;
					const url = getConsentUrl(settings, getRedirectUri(), account);
					res.writeHead(302, { Location: url });
					res.end();
				} catch (err: any) {
					html(res, errorPage(err.message), 500);
				}
				return;
			}

			// OAuth callback
			if (req.method === "GET" && p === "/callback") {
				const url = new URL(req.url ?? "/", `${serverOrigin}/`);
				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");
				const state = url.searchParams.get("state");

				if (error) {
					html(res, errorPage(`Google returned error: ${error}`));
					return;
				}

				const stateResult = verifyOAuthState(state);
				if (!stateResult.valid) {
					html(res, errorPage("Invalid or missing OAuth state parameter. Please try again."), 403);
					return;
				}

				if (!code) {
					html(res, errorPage("No authorization code received."));
					return;
				}

				try {
					const tokens = await exchangeCode(settings, code, getRedirectUri(), agentDir, stateResult.account);
					html(res, successPage(tokens.email));
				} catch (err: any) {
					html(res, errorPage(err.message));
				}
				return;
			}

			// Logout (POST with CSRF token validation)
			if (req.method === "POST" && p === "/logout") {
				// Parse URL-encoded form body to extract CSRF token (capped at 4KB)
				let tooLarge = false;
				const body = await new Promise<string>((resolve, reject) => {
					let data = "";
					req.on("data", (chunk: Buffer) => {
						if (tooLarge) return;
						data += chunk.toString();
						if (data.length > 4096) { tooLarge = true; resolve(""); }
					});
					req.on("end", () => resolve(data));
					req.on("error", reject);
				}).catch(() => "");

				if (tooLarge) {
					html(res, errorPage("Request body too large."), 413);
					return;
				}

				const params = new URLSearchParams(body);
				const csrfToken = params.get("_csrf");

				if (!verifyLogoutCsrf(csrfToken)) {
					html(res, errorPage("Invalid CSRF token. Please go back and try again."), 403);
					return;
				}

				await clearTokens(agentDir);
				bus.emit("gmail:disconnected", {});
				res.writeHead(302, { Location: "/gmail" });
				res.end();
				return;
			}

			json(res, 404, { error: "Not found" });
		},
	};

	const apiMount: MountConfig = {
		name: "gmail-api",
		label: "Gmail API",
		description: "Gmail status endpoint",
		prefix: "/gmail",
		handler: async (req, res, subPath) => {
			const p = subPath.replace(/\/+$/, "") || "/";

			if (req.method === "GET" && p === "/status") {
				json(res, 200, {
					authenticated: isAuthenticated(agentDir),
					email: getAuthenticatedEmail(agentDir),
				});
				return;
			}

			json(res, 404, { error: "Not found" });
		},
	};

	bus.emit("web:mount", webMount);
	bus.emit("web:mount-api", apiMount);
}

export function unmountGmailRoutes(bus: EventBus): void {
	bus.emit("web:unmount", { name: "gmail" });
	bus.emit("web:unmount-api", { name: "gmail-api" });
}
