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
} from "./auth.ts";

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

// ── Detect server port from webserver ───────────────────────────

let serverPort = 3100; // default

function getRedirectUri(): string {
	return `http://localhost:${serverPort}/gmail/callback`;
}

// ── HTML pages ──────────────────────────────────────────────────

function authStatusPage(authenticated: boolean, email: string | null): string {
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
			<p>✅ <strong>Connected</strong> as <code>${email}</code></p>
		</div>
		<p><a href="/gmail/auth" class="btn btn-primary">Re-authenticate</a>
		<a href="/gmail/logout" class="btn btn-danger">Disconnect</a></p>`
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
<li>Set <code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> environment variables, or add to <code>settings.json</code>:
<pre style="background:#161b22;padding:12px;border-radius:6px;overflow-x:auto">
{
  "pi-gmail": {
    "clientId": "env:GMAIL_CLIENT_ID",
    "clientSecret": "env:GMAIL_CLIENT_SECRET"
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
  <p>Authenticated as <code>${email}</code></p>
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
  <p>${error}</p>
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
			if (info?.port) serverPort = info.port;
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
				html(res, authStatusPage(authed, email));
				return;
			}

			// Start OAuth flow
			if (req.method === "GET" && p === "/auth") {
				try {
					const url = getConsentUrl(settings, getRedirectUri());
					res.writeHead(302, { Location: url });
					res.end();
				} catch (err: any) {
					html(res, errorPage(err.message), 500);
				}
				return;
			}

			// OAuth callback
			if (req.method === "GET" && p === "/callback") {
				const url = new URL(req.url ?? "/", `http://localhost:${serverPort}`);
				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");

				if (error) {
					html(res, errorPage(`Google returned error: ${error}`));
					return;
				}

				if (!code) {
					html(res, errorPage("No authorization code received."));
					return;
				}

				try {
					const tokens = await exchangeCode(settings, code, getRedirectUri(), agentDir);
					html(res, successPage(tokens.email));
				} catch (err: any) {
					html(res, errorPage(err.message));
				}
				return;
			}

			// Logout
			if (req.method === "GET" && p === "/logout") {
				clearTokens(agentDir);
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
