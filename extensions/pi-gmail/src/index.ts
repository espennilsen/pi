/**
 * pi-gmail — Gmail integration for pi.
 *
 * Provides:
 *   - `gmail` tool — search, read, compose, reply, send, archive, trash, label, etc.
 *   - /gmail web page — OAuth status and auth flow
 *   - /api/gmail — Status endpoint
 *   - /gmail-auth command — Start OAuth flow from CLI
 *   - /gmail-logout command — Disconnect Gmail
 *   - Email notification forwarding via pi-channels
 *
 * Settings (in settings.json):
 *   "pi-gmail": {
 *     "clientId": "env:GMAIL_CLIENT_ID",
 *     "clientSecret": "env:GMAIL_CLIENT_SECRET",
 *     "maxResults": 20,
 *     "notifications": {
 *       "enabled": false,
 *       "query": "is:unread",
 *       "intervalMinutes": 5,
 *       "channel": "default"
 *     }
 *   }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { registerGmailTool } from "./tool.ts";
import { mountGmailRoutes, unmountGmailRoutes } from "./web.ts";
import {
	isAuthenticated,
	getAuthenticatedEmail,
	getConsentUrl,
	clearTokens,
	closeDb,
} from "./auth.ts";
import type { GmailSettings } from "./types.ts";
import * as client from "./client.ts";
import { formatSearchResult } from "./formatter.ts";

// ── Settings ────────────────────────────────────────────────────

interface NotificationSettings {
	enabled?: boolean;
	query?: string;
	intervalMinutes?: number;
	channel?: string;
}

interface FullGmailSettings extends GmailSettings {
	notifications?: NotificationSettings;
}

function getSettings(cwd: string): FullGmailSettings {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, any>;
	const project = sm.getProjectSettings() as Record<string, any>;
	return {
		...global?.["pi-gmail"],
		...project?.["pi-gmail"],
	};
}

function resolveEnv(value: string | undefined): string {
	if (!value) return "";
	if (value.startsWith("env:")) return process.env[value.slice(4)] ?? "";
	return value;
}

// ── Notification polling ────────────────────────────────────────

let notificationTimer: ReturnType<typeof setInterval> | null = null;
let lastCheckTimestamp: number = Date.now();

function startNotifications(
	pi: ExtensionAPI,
	settings: FullGmailSettings,
	agentDir: string,
	log: ReturnType<typeof createLogger>,
): void {
	const notif = settings.notifications;
	if (!notif?.enabled) return;

	const intervalMs = (notif.intervalMinutes ?? 5) * 60 * 1000;
	const query = notif.query ?? "is:unread";
	const channel = notif.channel ?? "default";

	log("notifications", { status: "starting", intervalMs, query, channel });

	notificationTimer = setInterval(async () => {
		try {
			if (!isAuthenticated(agentDir)) return;

			// Search for new messages since last check
			const afterDate = new Date(lastCheckTimestamp);
			const afterStr = `${afterDate.getFullYear()}/${afterDate.getMonth() + 1}/${afterDate.getDate()}`;
			const fullQuery = `${query} after:${afterStr}`;

			const list = await client.listMessages(settings, agentDir, fullQuery, 5);
			if (list.messages && list.messages.length > 0) {
				const messages = await Promise.all(
					list.messages.slice(0, 5).map((m) =>
						client.getMessage(settings, agentDir, m.id, "metadata"),
					),
				);

				const summary = messages.map((m, i) => formatSearchResult(m, i)).join("\n\n");
				const text = `📧 **New Gmail messages (${list.messages.length}):**\n\n${summary}`;

				pi.events.emit("channel:send", {
					channel,
					text,
					source: "pi-gmail",
				});
			}

			lastCheckTimestamp = Date.now();
		} catch (err: any) {
			log("notification-error", { error: err.message }, "ERROR");
		}
	}, intervalMs);
}

function stopNotifications(): void {
	if (notificationTimer) {
		clearInterval(notificationTimer);
		notificationTimer = null;
	}
}

// ── Extension entry point ───────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let cachedSettings: FullGmailSettings | null = null;

	const getSettingsCached = (): GmailSettings => {
		if (!cachedSettings) cachedSettings = getSettings(".");
		return cachedSettings;
	};

	// Register the tool (available immediately, checks auth at execution time)
	registerGmailTool(pi, getSettingsCached);

	// ── Lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const agentDir = getAgentDir();
		cachedSettings = getSettings(ctx.cwd);

		const clientId = resolveEnv(cachedSettings.clientId);
		if (!clientId) {
			log("init", { status: "no clientId configured" }, "WARN");
			ctx.ui.setStatus("gmail", "Gmail: not configured");
			return;
		}

		log("init", { status: "ready" });

		if (isAuthenticated(agentDir)) {
			const email = getAuthenticatedEmail(agentDir);
			ctx.ui.setStatus("gmail", `Gmail: ${email}`);
			log("auth", { status: "authenticated", email });

			// Start notification polling if configured
			startNotifications(pi, cachedSettings, agentDir, log);
		} else {
			ctx.ui.setStatus("gmail", "Gmail: not connected");
			log("auth", { status: "not authenticated" });
		}

		// Mount web routes
		mountGmailRoutes(pi.events, cachedSettings, agentDir);
	});

	// Re-mount when pi-webserver starts after us
	pi.events.on("web:ready", () => {
		if (cachedSettings) {
			mountGmailRoutes(pi.events, cachedSettings, getAgentDir());
		}
	});

	pi.on("session_shutdown", async () => {
		stopNotifications();
		unmountGmailRoutes(pi.events);
		closeDb();
	});

	// ── Commands ────────────────────────────────────────────────

	pi.registerCommand("gmail-auth", {
		description: "Connect your Gmail account via OAuth",
		handler: async (_args, ctx) => {
			const agentDir = getAgentDir();
			const settings = getSettings(ctx.cwd);
			const clientId = resolveEnv(settings.clientId);

			if (!clientId) {
				ctx.ui.notify(
					"Gmail not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars, " +
					'or add "pi-gmail" section to settings.json.',
					"error",
				);
				return;
			}

			// Check if webserver is running
			let webPort: number | null = null;
			pi.events.emit("web:info", {
				reply: (info: any) => {
					if (info?.port) webPort = info.port;
				},
			});

			if (webPort) {
				// Open browser to auth page
				const url = `http://localhost:${webPort}/gmail/auth`;
				ctx.ui.notify(`Opening browser: ${url}`, "info");
				const { exec: execCmd } = await import("node:child_process");
				execCmd(`open "${url}"`, () => {});
			} else {
				// No webserver — show the URL for manual copy
				try {
					const redirectUri = "http://localhost:3100/gmail/callback";
					const url = getConsentUrl(settings, redirectUri);
					ctx.ui.notify(
						`Open this URL in your browser:\n${url}\n\nNote: pi-webserver must be running to handle the callback.`,
						"info",
					);
				} catch (err: any) {
					ctx.ui.notify(`Auth error: ${err.message}`, "error");
				}
			}
		},
	});

	pi.registerCommand("gmail-logout", {
		description: "Disconnect Gmail account",
		handler: async (_args, ctx) => {
			const agentDir = getAgentDir();
			const email = getAuthenticatedEmail(agentDir);

			if (!email) {
				ctx.ui.notify("Gmail is not connected.", "info");
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"Disconnect Gmail?",
				`This will remove the stored tokens for ${email}.`,
			);

			if (!confirmed) return;

			clearTokens(agentDir);
			stopNotifications();
			ctx.ui.setStatus("gmail", "Gmail: not connected");
			ctx.ui.notify(`Gmail disconnected (${email}).`, "info");
		},
	});

	pi.registerCommand("gmail-status", {
		description: "Show Gmail connection status",
		handler: async (_args, ctx) => {
			const agentDir = getAgentDir();
			if (isAuthenticated(agentDir)) {
				const email = getAuthenticatedEmail(agentDir);
				ctx.ui.notify(`✅ Gmail connected as ${email}`, "info");
			} else {
				ctx.ui.notify("⚠️ Gmail not connected. Run /gmail-auth to connect.", "info");
			}
		},
	});
}
