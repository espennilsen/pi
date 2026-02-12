/**
 * pi-webserver — Shared web server extension for pi.
 *
 * Provides a single HTTP server that other extensions can mount routes on.
 * Start with /web, stop with /web stop.
 *
 * Extensions register routes via:
 *   1. Direct import:  import { mount } from "pi-webserver/src/server.ts"
 *   2. Event bus:      pi.events.emit("web:mount", config)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import { start, stop, mount, unmount, mountApi, unmountApi, isRunning, getUrl, getPort, getMounts, getApiMounts, setAuth, getAuth, setApiToken, setApiReadToken, getApiTokenStatus, setLogger } from "./server.ts";
import { createLogger } from "./logger.ts";
import type { MountConfig } from "./server.ts";

interface WebServerSettings {
	autostart: boolean;
	port: number;
	auth: string | null;
	apiToken: string | null;
	apiReadToken: string | null;
}

function resolveSettings(cwd: string): WebServerSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = {
			...(global?.["pi-webserver"] ?? {}),
			...(project?.["pi-webserver"] ?? {}),
		};
		return {
			autostart: cfg.autostart ?? false,
			port: cfg.port ?? 4100,
			auth: cfg.auth ?? null,
			apiToken: cfg.apiToken ?? null,
			apiReadToken: cfg.apiReadToken ?? null,
		};
	} catch {
		return { autostart: false, port: 4100, auth: null, apiToken: null, apiReadToken: null };
	}
}

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	setLogger(log);

	// ── Event bus integration ────────────────────────────────────
	// Other extensions can emit these without importing anything.

	pi.events.on("web:mount", (config: unknown) => {
		mount(config as MountConfig);
	});

	pi.events.on("web:unmount", (data: unknown) => {
		unmount((data as { name: string }).name);
	});

	pi.events.on("web:mount-api", (config: unknown) => {
		mountApi(config as MountConfig);
	});

	pi.events.on("web:unmount-api", (data: unknown) => {
		unmountApi((data as { name: string }).name);
	});

	// ── /web command ─────────────────────────────────────────────

	pi.registerCommand("web", {
		description: "Start/stop the shared web server: /web [port|stop|status|auth]",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "stop", label: "stop — Stop the web server" },
				{ value: "status", label: "status — Show server status and mounts" },
				{ value: "port", label: "port [number] — Show or change the server port" },
				{ value: "auth", label: "auth <password|user:pass|off> — Configure Basic auth" },
				{ value: "api", label: "api [token|read <token>|off|status] — Configure API token auth" },
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const arg = args?.trim() ?? "";

			// /web stop
			if (arg === "stop") {
				const was = stop();
				ctx.ui.notify(
					was ? "Web server stopped" : "Web server is not running",
					"info",
				);
				return;
			}

			// /web auth [password|user:pass|off]
			if (arg === "auth" || arg.startsWith("auth ")) {
				const authArg = arg.slice(5).trim();
				if (!authArg || authArg === "status") {
					const auth = getAuth();
					ctx.ui.notify(
						auth.enabled
							? `Auth enabled (user: ${auth.username})`
							: "Auth disabled",
						"info",
					);
					return;
				}
				if (authArg === "off") {
					setAuth(null);
					ctx.ui.notify("Auth disabled", "info");
					return;
				}
				const colon = authArg.indexOf(":");
				if (colon !== -1) {
					setAuth({ username: authArg.slice(0, colon), password: authArg.slice(colon + 1) });
					ctx.ui.notify(`Auth enabled (user: ${authArg.slice(0, colon)})`, "info");
				} else {
					setAuth({ password: authArg });
					ctx.ui.notify("Auth enabled (user: pi)", "info");
				}
				return;
			}

			// /web api [token|read <token>|off|status]
			if (arg === "api" || arg.startsWith("api ")) {
				const apiArg = arg.slice(4).trim();
				if (!apiArg || apiArg === "status") {
					const tokenStatus = getApiTokenStatus();
					const apiMounts = getApiMounts();
					let msg = `API token: ${tokenStatus.enabled ? "enabled" : "disabled"}`;
					msg += `\nAPI read token: ${tokenStatus.readEnabled ? "enabled" : "disabled"}`;
					if (apiMounts.length > 0) {
						msg += `\nAPI mounts (${apiMounts.length}):`;
						for (const m of apiMounts) {
							msg += `\n  ${m.prefix} — ${m.label}`;
							if (m.skipAuth) msg += " (custom auth)";
							if (m.description) msg += ` (${m.description})`;
						}
					} else {
						msg += "\nNo API extensions mounted";
					}
					ctx.ui.notify(msg, "info");
					return;
				}
				if (apiArg === "off") {
					setApiToken(null);
					setApiReadToken(null);
					ctx.ui.notify("API token auth disabled — /api/* routes are open", "info");
					return;
				}
				// /web api read <token|off>
				if (apiArg === "read" || apiArg.startsWith("read ")) {
					const readArg = apiArg.slice(5).trim();
					if (!readArg) {
						const tokenStatus = getApiTokenStatus();
						ctx.ui.notify(`API read token: ${tokenStatus.readEnabled ? "enabled" : "disabled"}`, "info");
						return;
					}
					if (readArg === "off") {
						setApiReadToken(null);
						ctx.ui.notify("API read token disabled", "info");
						return;
					}
					setApiReadToken(readArg);
					ctx.ui.notify("API read token enabled — GET/HEAD on /api/* allowed with this token", "info");
					return;
				}
				setApiToken(apiArg);
				ctx.ui.notify("API token auth enabled — /api/* requires Bearer token", "info");
				return;
			}

			// /web port [number]
			if (arg === "port" || arg.startsWith("port ")) {
				const portArg = arg.slice(5).trim();
				if (!portArg) {
					const current = getPort();
					ctx.ui.notify(
						current ? `Current port: ${current}` : "Web server is not running",
						"info",
					);
					return;
				}
				const newPort = parseInt(portArg);
				if (isNaN(newPort) || newPort < 1 || newPort > 65535) {
					ctx.ui.notify("Invalid port number (must be 1–65535)", "error");
					return;
				}
				const url = start(newPort);
				ctx.ui.notify(`Web server restarted on port ${newPort}: ${url}`, "info");
				return;
			}

			// /web status
			if (arg === "status") {
				if (!isRunning()) {
					ctx.ui.notify("Web server is not running", "info");
					return;
				}
				const mountList = getMounts();
				const auth = getAuth();
				const tokenStatus = getApiTokenStatus();
				let msg = `Web server running at ${getUrl()}`;
				msg += `\nAuth: ${auth.enabled ? `enabled (user: ${auth.username})` : "disabled"}`;
				msg += `\nAPI token: ${tokenStatus.enabled ? "enabled" : "disabled"}`;
				msg += `\nAPI read token: ${tokenStatus.readEnabled ? "enabled" : "disabled"}`;
				if (mountList.length > 0) {
					msg += "\nMounts:";
					for (const m of mountList) {
						msg += `\n  ${m.prefix} — ${m.label}`;
						if (m.description) msg += ` (${m.description})`;
					}
				} else {
					msg += "\nNo extensions mounted";
				}
				ctx.ui.notify(msg, "info");
				return;
			}

			// /web [port] — toggle or start on specific port
			const port = parseInt(arg || "4100") || 4100;
			const wasRunning = stop();
			if (wasRunning && !arg) {
				ctx.ui.notify("Web server stopped", "info");
				return;
			}

			const url = start(port);
			const mountList = getMounts();
			let msg = `Web server: ${url}`;
			if (mountList.length > 0) {
				msg += `\n${mountList.length} mount${mountList.length > 1 ? "s" : ""}: ${mountList.map((m) => m.prefix).join(", ")}`;
			}
			ctx.ui.notify(msg, "info");
		},
	});

	// ── Lifecycle ────────────────────────────────────────────────

	// Pick up auth from settings and notify other extensions
	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);

		if (settings.auth) {
			const colon = settings.auth.indexOf(":");
			if (colon !== -1) {
				setAuth({ username: settings.auth.slice(0, colon), password: settings.auth.slice(colon + 1) });
			} else {
				setAuth({ password: settings.auth });
			}
			ctx.ui.notify("Web server auth configured from settings", "info");
		}

		if (settings.apiToken) {
			setApiToken(settings.apiToken);
			ctx.ui.notify("API token auth configured from settings", "info");
		}

		if (settings.apiReadToken) {
			setApiReadToken(settings.apiReadToken);
			ctx.ui.notify("API read token configured from settings", "info");
		}

		// Autostart if configured
		if (settings.autostart && !isRunning()) {
			const url = start(settings.port);
			ctx.ui.notify(`Web server auto-started: ${url}`, "info");
			log("start", { port: settings.port, url });
		}

		pi.events.emit("web:ready", {});
	});

	// Clean up on exit
	pi.on("session_shutdown", async () => {
		if (isRunning()) log("stop", {});
		stop();
	});
}
