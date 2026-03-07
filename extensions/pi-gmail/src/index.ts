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
 *     "clientId": "your-client-id",
 *     "clientSecret": "your-client-secret",
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
} from "./auth.ts";
import type { GmailSettings } from "./types.ts";
import * as client from "./client.ts";
import { formatSearchResult } from "./formatter.ts";
import { openUrl } from "./utils.ts";

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
	const globalSettings = global?.["pi-gmail"] ?? {};
	const projectSettings = project?.["pi-gmail"] ?? {};
	return {
		...globalSettings,
		...projectSettings,
		// Deep merge nested notifications so project keys don't clobber global defaults
		notifications: {
			...globalSettings?.notifications,
			...projectSettings?.notifications,
		},
	};
}

// ── Notification polling ────────────────────────────────────────

let notificationTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckTimestamp: number = Date.now();
let pollGeneration = 0;

// Track notified message IDs to prevent re-notification (capped at 500)
const MAX_SEEN_IDS = 500;
const notifiedMessageIds = new Set<string>();

function trackNotified(id: string): void {
	notifiedMessageIds.add(id);
	// Evict oldest entries when set grows too large
	if (notifiedMessageIds.size > MAX_SEEN_IDS) {
		const iter = notifiedMessageIds.values();
		const toRemove = notifiedMessageIds.size - MAX_SEEN_IDS;
		for (let i = 0; i < toRemove; i++) {
			notifiedMessageIds.delete(iter.next().value!);
		}
	}
}

function startNotifications(
	pi: ExtensionAPI,
	settings: FullGmailSettings,
	agentDir: string,
	log: ReturnType<typeof createLogger>,
): void {
	if (notificationTimer !== null) return; // already polling
	const notif = settings.notifications;
	if (!notif?.enabled) return;

	const intervalMs = (notif.intervalMinutes ?? 5) * 60 * 1000;
	const query = notif.query ?? "is:unread";
	const channel = notif.channel ?? "default";
	const generation = ++pollGeneration;

	log("notifications", { status: "starting", intervalMs, query, channel });

	// Self-scheduling setTimeout pattern to avoid overlapping polls
	async function poll() {
		// Quiesce if stop was called or a new generation started
		if (notificationTimer === null || generation !== pollGeneration) return;

		try {
			if (!isAuthenticated(agentDir)) return;

			// Search for new messages since last check (epoch seconds for precise filtering)
			const afterEpoch = Math.floor(lastCheckTimestamp / 1000);
			const fullQuery = `${query} after:${afterEpoch}`;

			const list = await client.listMessages(settings, agentDir, fullQuery, 10);
			if (list.messages && list.messages.length > 0) {
				// Filter out already-notified messages
				const newMessages = list.messages.filter((m) => !notifiedMessageIds.has(m.id));
				if (newMessages.length > 0) {
					const messages = await Promise.all(
						newMessages.slice(0, 5).map((m) =>
							client.getMessage(settings, agentDir, m.id, "metadata"),
						),
					);

					const summary = messages.map((m, i) => formatSearchResult(m, i)).join("\n\n");
					const text = `📧 **New Gmail messages (${newMessages.length}):**\n\n${summary}`;

					pi.events.emit("channel:send", {
						channel,
						text,
						source: "pi-gmail",
					});

					// Mark all fetched messages as seen (not just the displayed ones)
					for (const m of newMessages) trackNotified(m.id);
				}
			}

			lastCheckTimestamp = Date.now();
		} catch (err: any) {
			log("notification-error", { error: err.message }, "ERROR");
		}

		// Schedule next poll only if still active and same generation
		if (notificationTimer !== null && generation === pollGeneration) {
			notificationTimer = setTimeout(poll, intervalMs);
		}
	}

	notificationTimer = setTimeout(poll, intervalMs);
}

function stopNotifications(): void {
	if (notificationTimer) {
		clearTimeout(notificationTimer);
		notificationTimer = null;
	}
}

// ── Extension entry point ───────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let cachedSettings: FullGmailSettings | null = null;

	const getSettingsCached = (): GmailSettings => {
		if (!cachedSettings) throw new Error("Gmail not initialized. Waiting for session_start.");
		return cachedSettings;
	};

	// Register the tool (available immediately, checks auth at execution time)
	registerGmailTool(pi, getSettingsCached);

	// ── Lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const agentDir = getAgentDir();
		cachedSettings = getSettings(ctx.cwd);

		const clientId = cachedSettings.clientId ?? "";
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

	pi.events.on("gmail:disconnected", () => {
		stopNotifications();
	});

	pi.on("session_shutdown", async () => {
		stopNotifications();
		unmountGmailRoutes(pi.events);
	});

	// ── Commands ────────────────────────────────────────────────

	pi.registerCommand("gmail-auth", {
		description: "Connect your Gmail account via OAuth",
		handler: async (_args, ctx) => {
			const agentDir = getAgentDir();
			const settings = getSettings(ctx.cwd);
			const clientId = settings.clientId ?? "";

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
				openUrl(url);
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

			await clearTokens(agentDir);
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
