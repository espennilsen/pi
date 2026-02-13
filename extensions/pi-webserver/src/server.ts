/**
 * Shared HTTP server with prefix-based routing.
 *
 * Extensions mount handlers at a prefix (e.g. "/crm"). The server strips
 * the prefix before calling the handler, so handlers see paths relative
 * to their mount point.
 */

import * as http from "node:http";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ───────────────────────────────────────────────────────

export type RouteHandler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
	path: string,
) => void | Promise<void>;

export interface MountConfig {
	/** Unique identifier for this mount (e.g. "crm", "notes") */
	name: string;
	/** Display name for the dashboard (defaults to name) */
	label?: string;
	/** Short description shown on the dashboard */
	description?: string;
	/** URL prefix — requests matching this prefix are routed here */
	prefix: string;
	/** Request handler — receives (req, res, subPath) with prefix stripped */
	handler: RouteHandler;
	/** Skip built-in API token auth — extension handles its own authentication */
	skipAuth?: boolean;
}

export interface MountInfo {
	name: string;
	label: string;
	description?: string;
	prefix: string;
	skipAuth?: boolean;
}

// ── Logger ──────────────────────────────────────────────────────

type LogFn = (event: string, data: unknown, level?: string) => void;
let log: LogFn = () => {};

export function setLogger(fn: LogFn): void {
	log = fn;
}

// ── State ───────────────────────────────────────────────────────

let server: http.Server | null = null;
let serverPort: number | null = null;
const mounts = new Map<string, MountConfig>();
let authCredentials: { username: string; password: string } | null = null;
let apiToken: string | null = null;

// ── Cookie session secret (random per server start) ─────────────
let sessionSecret = crypto.randomBytes(32).toString("hex");
let apiReadToken: string | null = null;

// ── Mount Management ────────────────────────────────────────────

/**
 * Mount a handler at a prefix. If a mount with the same name exists,
 * it is replaced silently.
 */
export function mount(config: MountConfig): void {
	let prefix = config.prefix.replace(/\/+$/, "");
	if (!prefix.startsWith("/")) prefix = "/" + prefix;
	mounts.set(config.name, {
		...config,
		prefix,
		label: config.label ?? config.name,
	});
}

/** Remove a mount by name. Returns true if it existed. */
export function unmount(name: string): boolean {
	return mounts.delete(name);
}

/** List all current mounts (without handlers). */
export function getMounts(): MountInfo[] {
	return Array.from(mounts.values()).map((m) => ({
		name: m.name,
		label: m.label ?? m.name,
		description: m.description,
		prefix: m.prefix,
		skipAuth: m.skipAuth || undefined,
	}));
}

// ── API Mount Management ────────────────────────────────────────

/**
 * Mount an API handler under /api. The prefix is relative to /api.
 * e.g. mountApi({ prefix: "/chat", ... }) mounts at /api/chat
 */
export function mountApi(config: MountConfig): void {
	let prefix = config.prefix.replace(/\/+$/, "");
	if (!prefix.startsWith("/")) prefix = "/" + prefix;
	mount({ ...config, prefix: "/api" + prefix });
}

/** Remove an API mount by name. Returns true if it existed. */
export function unmountApi(name: string): boolean {
	return unmount(name);
}

/** List only API mounts (prefixed with /api). */
export function getApiMounts(): MountInfo[] {
	return getMounts().filter((m) => m.prefix.startsWith("/api"));
}

function getDashboardMounts(): MountInfo[] {
	return getMounts().filter((m) => !m.prefix.startsWith("/api"));
}

// ── Auth ────────────────────────────────────────────────────────

/**
 * Enable Basic auth. Pass null to disable.
 * Password only: username defaults to "pi".
 * Or pass { username, password }.
 */
export function setAuth(config: { username?: string; password: string } | null): void {
	authCredentials = config
		? { username: config.username ?? "pi", password: config.password }
		: null;
}

/** Returns auth status (never exposes the password). */
export function getAuth(): { username: string; enabled: true } | { enabled: false } {
	if (!authCredentials) return { enabled: false };
	return { username: authCredentials.username, enabled: true };
}

// ── API Token Auth ──────────────────────────────────────────────

/** Set the API bearer token (full access). Pass null to disable. */
export function setApiToken(token: string | null): void {
	apiToken = token;
}

/** Set the API read-only bearer token (GET/HEAD only). Pass null to disable. */
export function setApiReadToken(token: string | null): void {
	apiReadToken = token;
}

/** Returns status of API token auth. Never exposes tokens. */
export function getApiTokenStatus(): { enabled: boolean; readEnabled: boolean } {
	return { enabled: apiToken !== null, readEnabled: apiReadToken !== null };
}

/** Constant-time token comparison. Hashes both inputs so digest length is always equal. */
function tokensEqual(a: string | null, b: string | null): boolean {
	if (!a || !b) return false;
	const hashA = crypto.createHash("sha256").update(a).digest();
	const hashB = crypto.createHash("sha256").update(b).digest();
	return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Check Bearer token for /api/* paths. Returns true if OK.
 *
 * - No tokens configured → open (allow all)
 * - Full API token matches → allow all methods
 * - Read-only API token matches → allow GET/HEAD only
 * - Valid session cookie → access per cookie level (full or read)
 * - Otherwise → 401/403
 */
function checkApiAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
	if (!apiToken && !apiReadToken) return true;

	const header = req.headers.authorization;
	const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
	const isRead = req.method === "GET" || req.method === "HEAD";

	// Full token grants everything
	if (tokensEqual(bearer, apiToken)) return true;

	// Read token grants GET/HEAD only
	if (tokensEqual(bearer, apiReadToken)) {
		if (isRead) return true;

		res.writeHead(403, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Read-only token cannot be used for write requests" }));
		return false;
	}

	// Session cookie — check access level
	const session = checkSessionCookie(req);
	if (session === "full") return true;
	if (session === "read") {
		if (isRead) return true;
		res.writeHead(403, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Read-only session cannot be used for write requests" }));
		return false;
	}

	res.writeHead(401, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: "Invalid or missing API token" }));
	return false;
}

/** Check Basic auth. Returns true if OK (or auth is disabled). */
function checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
	if (!authCredentials) return true;

	const header = req.headers.authorization;
	if (header?.startsWith("Basic ")) {
		const decoded = Buffer.from(header.slice(6), "base64").toString();
		const colon = decoded.indexOf(":");
		if (colon !== -1) {
			const user = decoded.slice(0, colon);
			const pass = decoded.slice(colon + 1);
			if (user === authCredentials.username && pass === authCredentials.password) {
				return true;
			}
		}
	}

	res.writeHead(401, {
		"WWW-Authenticate": 'Basic realm="pi web server"',
		"Content-Type": "application/json",
	});
	res.end(JSON.stringify({ error: "Unauthorized" }));
	return false;
}

// ── Cookie Session Auth ─────────────────────────────────────────

/** Sign a value with HMAC-SHA256 using the session secret. */
function signCookie(value: string): string {
	const sig = crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
	return value + "." + sig;
}

/** Verify and extract the value from a signed cookie. Returns null if invalid. */
function verifyCookie(signed: string): string | null {
	const dot = signed.lastIndexOf(".");
	if (dot === -1) return null;
	const value = signed.slice(0, dot);
	if (signCookie(value) === signed) return value;
	return null;
}

/** Parse cookies from request header. */
function parseCookies(req: http.IncomingMessage): Record<string, string> {
	const header = req.headers.cookie ?? "";
	const cookies: Record<string, string> = {};
	for (const pair of header.split(";")) {
		const eq = pair.indexOf("=");
		if (eq === -1) continue;
		cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
	}
	return cookies;
}

/** Check if request has a valid session cookie. Returns access level or null. */
function checkSessionCookie(req: http.IncomingMessage): "full" | "read" | null {
	const cookies = parseCookies(req);
	const token = cookies["pi-session"];
	if (!token) return null;
	const value = verifyCookie(token);
	if (!value) return null;
	if (value === "full") return "full";
	if (value === "read") return "read";
	return null;
}

/** Returns true if any auth is configured (Basic auth, API token, or read token). */
function isAnyAuthConfigured(): boolean {
	return !!(authCredentials || apiToken || apiReadToken);
}

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>pi — Login</title>
<style>
  :root { --bg:#0a0a0f; --bg2:#12121a; --fg:#e0e0e8; --fg2:#888898; --fg3:#555568; --accent:#7c6ff0; --border:#2a2a3a; --red:#f87171; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .login{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:32px;width:360px;max-width:90vw}
  .login h1{font-size:20px;font-weight:700;color:var(--accent);margin-bottom:4px}
  .login p{font-size:13px;color:var(--fg2);margin-bottom:20px}
  .login input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-size:14px;font-family:inherit;box-sizing:border-box}
  .login input:focus{outline:none;border-color:var(--accent)}
  .login button{width:100%;padding:10px;border:none;border-radius:6px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer;margin-top:12px}
  .login button:hover{opacity:0.9}
  .login .error{color:var(--red);font-size:12px;margin-top:8px;display:none}
</style>
</head><body>
<form class="login" method="POST" action="/_auth/login">
  <h1>pi</h1>
  <p>Enter your API token to continue.</p>
  <input type="password" name="token" placeholder="API token" autofocus required>
  <input type="hidden" name="redirect" value="/">
  <button type="submit">Sign in</button>
  <div class="error" id="err"></div>
</form>
<script>
  var u=new URLSearchParams(location.search);
  if(u.get('error')){var e=document.getElementById('err');e.textContent='Invalid token';e.style.display='block'}
  var r=u.get('redirect');
  if(r)document.querySelector('input[name=redirect]').value=r;
</script>
</body></html>`;

/** Handle login form POST. Validates token, sets cookie, redirects. */
function handleLoginPost(req: http.IncomingMessage, res: http.ServerResponse): void {
	let body = "";
	req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
	req.on("end", () => {
		const params = new URLSearchParams(body);
		const token = params.get("token") ?? "";
		const redirect = params.get("redirect") ?? "/";

		let access: "full" | "read" | null = null;
		if (tokensEqual(token, apiToken)) access = "full";
		else if (tokensEqual(token, apiReadToken)) access = "read";

		if (!access) {
			const redir = encodeURIComponent(redirect);
			res.writeHead(302, { Location: `/_auth/login?error=1&redirect=${redir}` });
			res.end();
			return;
		}

		const cookie = signCookie(access);
		res.writeHead(302, {
			Location: redirect,
			"Set-Cookie": `pi-session=${cookie}; Path=/; HttpOnly; SameSite=Lax`,
		});
		res.end();
	});
}

// ── Server Lifecycle ────────────────────────────────────────────

export function isRunning(): boolean {
	return server !== null;
}

export function getUrl(): string | null {
	return serverPort ? `http://localhost:${serverPort}` : null;
}

export function getPort(): number | null {
	return serverPort;
}

/**
 * Start the web server. Returns the URL.
 * If already running, stops and restarts.
 */
export function start(port: number = 4100): string {
	if (server) stop();
	sessionSecret = crypto.randomBytes(32).toString("hex");

	const dashboardHtml = fs.readFileSync(
		path.resolve(import.meta.dirname, "../dashboard.html"),
		"utf-8",
	);

	server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://localhost:${port}`);
		const pathname = url.pathname;

		// CORS for local development
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		// Auth gate (after CORS preflight so OPTIONS still works)
		// /api/* auth is deferred to after mount matching (supports skipAuth)
		// Everything else uses Basic auth upfront
		const isApiPath = pathname === "/api" || pathname.startsWith("/api/");
		const isAuthPath = pathname.startsWith("/_auth/");

		// ── Login endpoints ──────────────────────────────────
		if (isAuthPath) {
			if (pathname === "/_auth/login" && req.method === "POST") {
				handleLoginPost(req, res);
				return;
			}
			if (pathname === "/_auth/login") {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(LOGIN_PAGE);
				return;
			}
			if (pathname === "/_auth/logout") {
				res.writeHead(302, {
					Location: "/",
					"Set-Cookie": "pi-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
				});
				res.end();
				return;
			}
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
			return;
		}

		if (!isApiPath) {
			if (authCredentials) {
				// Basic auth configured — use it
				if (!checkAuth(req, res)) return;
			} else if (apiToken || apiReadToken) {
				// No Basic auth but API token configured — require session cookie
				const session = checkSessionCookie(req);
				if (!session) {
					const redirect = encodeURIComponent(pathname + url.search);
					res.writeHead(302, { Location: `/_auth/login?redirect=${redirect}` });
					res.end();
					return;
				}
			}
			// No auth configured at all → open
		}

		try {
			// /api base path — no listing, just 404
			if (pathname === "/api" || pathname === "/api/") {
				if (!checkApiAuth(req, res)) return;
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Not found" }));
				return;
			}

			// Meta API: list mounts
			if (pathname === "/_api/mounts") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(getMounts()));
				return;
			}

			// Meta API: list mounts for dashboard (exclude /api)
			if (pathname === "/_api/mounts/dashboard") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(getDashboardMounts()));
				return;
			}

			// Route to best matching mount (longest prefix wins)
			let bestMatch: MountConfig | null = null;

			for (const config of mounts.values()) {
				if (pathname === config.prefix || pathname.startsWith(config.prefix + "/")) {
					if (!bestMatch || config.prefix.length > bestMatch.prefix.length) {
						bestMatch = config;
					}
				}
			}

			if (bestMatch) {
				// API token auth — skip if mount handles its own
				if (isApiPath && !bestMatch.skipAuth) {
					if (!checkApiAuth(req, res)) return;
				}
				const subPath = pathname.slice(bestMatch.prefix.length) || "/";
				await bestMatch.handler(req, res, subPath);
				return;
			}

			// Dashboard fallback — serves built-in dashboard when no mount
			// claims the root. Extensions can override `/` by mounting there.
			if (pathname === "/" || pathname === "") {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(dashboardHtml);
				return;
			}

			// Unmatched API paths still go through token auth before 404
			if (isApiPath) {
				if (!checkApiAuth(req, res)) return;
			}

			// Nothing matched
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found" }));
		} catch (err: any) {
			log("request-error", { method: req.method, url: req.url, error: err.message }, "ERROR");
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: err.message }));
			}
		}
	});

	server.listen(port);
	serverPort = port;
	return `http://localhost:${port}`;
}

/** Stop the server. Returns true if it was running. */
export function stop(): boolean {
	if (!server) return false;
	server.closeAllConnections();
	server.close();
	server = null;
	serverPort = null;
	return true;
}
