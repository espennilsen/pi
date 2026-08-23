/**
 * pi-gmail — Gmail integration for pi.
 *
 * Provides:
 *   - `gmail` tool — search, read, compose, reply, send, archive, trash, label, etc.
 *   - /gmail web page — OAuth status and auth flow (with multi-account support)
 *   - /api/gmail — Status endpoint
 *   - /gmail-auth command — Start OAuth flow from CLI
 *   - /gmail-switch command — Switch active Gmail account or list accounts
 *   - /gmail-accounts command — List all configured Gmail accounts
 *   - /gmail-logout command — Disconnect Gmail account
 *   - /gmail-status command — Show current Gmail status
 *   - Email notification forwarding via pi-channels
 *
 * Settings (in settings.json):
 *   "pi-gmail": {
 *     "clientId": "your-client-id",
 *     "clientSecret": "your-client-secret",
 *     "defaultAccount": "personal",
 *     "accounts": {
 *       "personal": { "clientId": "...", "clientSecret": "..." },
 *       "work": { "clientId": "...", "clientSecret": "...", "readOnly": true }
 *     },
 *     "maxResults": 20,
 *     "readOnly": true,
 *     "notifications": {
 *       "enabled": false,
 *       "query": "is:unread",
 *       "intervalMinutes": 5,
 *       "channel": "default"
 *     }
 *   }
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { registerGmailTool } from "./tool.ts";
import { mountGmailRoutes, unmountGmailRoutes, updateGmailWebInfo } from "./web.ts";
import {
	isAuthenticated,
	getAuthenticatedEmail,
	clearTokens,
	listAccounts,
	getAccountConfig,
	validateAccountName,
} from "./auth.ts";
import type { GmailSettings, GmailAccountConfig, AccountInfo } from "./types.ts";
import * as client from "./client.ts";
import { formatSearchResult } from "./formatter.ts";
import { openUrl } from "./utils.ts";

// ── Shared helpers ──────────────────────────────────────────────

export function resolveAccountTarget(name?: string): string | undefined {
	if (!name || name === "default") return undefined;
	return name.trim();
}

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

	// Deep merge per-account configurations
	const globalAccounts: Record<string, GmailAccountConfig> = globalSettings?.accounts ?? {};
	const projectAccounts: Record<string, GmailAccountConfig> = projectSettings?.accounts ?? {};
	const mergedAccounts: Record<string, GmailAccountConfig> = {};
	for (const name of new Set([...Object.keys(globalAccounts), ...Object.keys(projectAccounts)])) {
		mergedAccounts[name] = {
			...globalAccounts[name],
			...projectAccounts[name],
		};
	}

	return {
		...globalSettings,
		...projectSettings,
		accounts: mergedAccounts,
		// Deep merge nested notifications so project keys don't clobber global defaults
		notifications: {
			...globalSettings?.notifications,
			...projectSettings?.notifications,
		},
	};
}

// ── UI Status helpers ───────────────────────────────────────────

function updateStatus(
	ctx: any,
	agentDir: string,
	settings: GmailSettings,
	log?: ReturnType<typeof createLogger>,
): void {
	const activeName = settings.account || settings.defaultAccount;
	const target = resolveAccountTarget(activeName);
	const config = getAccountConfig(settings, target);

	if (!config.clientId) {
		log?.("init", { status: "no clientId configured", account: activeName }, "WARN");
		ctx?.ui?.setStatus("gmail", "Gmail: not configured");
		return;
	}

	if (isAuthenticated(agentDir, target)) {
		const email = getAuthenticatedEmail(agentDir, target);
		const label = target ? `Gmail: ${email} (${target})` : `Gmail: ${email}`;
		ctx?.ui?.setStatus("gmail", label);
		log?.("auth", { status: "authenticated", email, account: target });
	} else {
		const label = target ? `Gmail: not connected (${target})` : "Gmail: not connected";
		ctx?.ui?.setStatus("gmail", label);
		log?.("auth", { status: "not authenticated", account: target });
	}
}

function formatAccountsList(accounts: AccountInfo[]): string {
	if (accounts.length === 0) {
		return "No Gmail accounts configured or connected.";
	}
	const lines = ["**Gmail Accounts:**\n"];
	for (const acc of accounts) {
		const activeMark = acc.isActive ? "👉 **[active]**" : "  ";
		const defaultMark = acc.isDefault ? " *(default)*" : "";
		const status = acc.authenticated ? `✅ ${acc.email || "connected"}` : "❌ not connected";
		lines.push(`${activeMark} \`${acc.name}\`${defaultMark} — ${status}`);
	}
	lines.push("\nSwitch account with `/gmail-switch <name>` or connect with `/gmail-auth [name]`.");
	return lines.join("\n");
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

	log("notifications", { status: "starting", intervalMs, query, channel, account: settings.account });

	// Self-scheduling setTimeout pattern to avoid overlapping polls
	async function poll() {
		// Quiesce if stop was called or a new generation started
		if (notificationTimer === null || generation !== pollGeneration) return;

		try {
			const target = resolveAccountTarget(settings.account);
			if (!isAuthenticated(agentDir, target)) return;

			const pollTimestamp = Date.now();
			const sinceSec = Math.floor(lastCheckTimestamp / 1000);
			const fullQuery = `${query} after:${sinceSec}`;

			const list = await client.listMessages(settings, agentDir, fullQuery, 20);
			const messageIds = list.messages?.map((m) => m.id) ?? [];

			// Filter out already-notified messages
			const newIds = messageIds.filter((id) => !notifiedMessageIds.has(id));

			if (newIds.length > 0) {
				log("notifications", { newMessages: newIds.length });

				// Fetch snippets for notification text
				const messages = await Promise.all(
					newIds.slice(0, 3).map((id) => client.getMessage(settings, agentDir, id, "metadata")),
				);

				for (const id of newIds) trackNotified(id);

				const summary = messages.map((m, i) => formatSearchResult(m, i + 1)).join("\n");
				const countText =
					newIds.length === 1
						? "1 new email"
						: `${newIds.length} new emails`;

				// Forward notification via pi-channels using channel:send event
				pi.events.emit("channel:send", {
					route: channel,
					text: `Gmail (${resolveAccountTarget(settings.account) || "default"}): ${countText}\n\n${summary}`,
					source: "pi-gmail",
				});
			}

			// Advance timestamp only after successful fetch/processing
			lastCheckTimestamp = pollTimestamp;
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

	pi.on("session_start", async (_event: any, ctx: any) => {
		const agentDir = getAgentDir();
		cachedSettings = getSettings(ctx.cwd);

		if (!cachedSettings.account) {
			cachedSettings.account = cachedSettings.defaultAccount;
		}

		updateStatus(ctx, agentDir, cachedSettings, log);

		const target = resolveAccountTarget(cachedSettings.account);
		if (isAuthenticated(agentDir, target)) {
			// Start notification polling if configured
			startNotifications(pi, cachedSettings, agentDir, log);
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
		description: "Connect a Gmail account via OAuth (usage: /gmail-auth [account_name])",
		handler: async (args: string | undefined, ctx: any) => {
			const settings = getSettings(ctx.cwd);
			const requestedAccount = args?.trim() || settings.account || settings.defaultAccount;
			const target = resolveAccountTarget(requestedAccount);

			if (target) {
				try {
					validateAccountName(target);
				} catch (err: any) {
					ctx.ui.notify(err.message, "error");
					return;
				}
			}

			const config = getAccountConfig(settings, target);

			if (!config.clientId) {
				const accInfo = target ? ` for account "${target}"` : "";
				ctx.ui.notify(
					`Gmail not configured${accInfo}. Add clientId and clientSecret to the "pi-gmail" section of settings.json.`,
					"error",
				);
				return;
			}

			// Discovery replies synchronously only while pi-webserver is listening.
			const discovery: { info: { port: number; url: string } | null } = { info: null };
			pi.events.emit("web:info", {
				reply: (info: unknown) => {
					const candidate = info as { port?: unknown; url?: unknown };
					if (typeof candidate?.port === "number" && typeof candidate.url === "string") {
						discovery.info = { port: candidate.port, url: candidate.url };
					}
				},
			});

			if (discovery.info !== null && updateGmailWebInfo(discovery.info)) {
				const authPath = target ? `/gmail/auth?account=${encodeURIComponent(target)}` : "/gmail/auth";
				const url = new URL(authPath, discovery.info.url).toString();
				pi.sendMessage({
					customType: "gmail_auth",
					content: `Opening Gmail authentication in your browser${target ? ` for account "${target}"` : ""}. If it does not appear, open this link:\n${url}`,
					display: true,
					details: { type: "info" },
				});
				openUrl(url);
				return;
			}

			ctx.ui.notify(
				"Gmail OAuth requires pi-webserver to handle the callback. Start it with /web, then run /gmail-auth again.",
				"info",
			);
		},
	});

	pi.registerCommand("gmail-switch", {
		description: "Switch active Gmail account or list accounts (usage: /gmail-switch [account_name])",
		handler: async (args: string | undefined, ctx: any) => {
			const agentDir = getAgentDir();
			const settings = cachedSettings ?? getSettings(ctx.cwd);
			const target = args?.trim();

			if (!target) {
				const accounts = listAccounts(settings, agentDir, settings.account);
				const formatted = formatAccountsList(accounts);
				pi.sendMessage({
					customType: "gmail_accounts",
					content: formatted,
					display: true,
					details: { type: "info" },
				});
				return;
			}

			if (target !== "default") {
				try {
					validateAccountName(target);
				} catch (err: any) {
					ctx.ui.notify(err.message, "error");
					return;
				}

				if (
					settings.accounts &&
					Object.keys(settings.accounts).length > 0 &&
					!settings.accounts[target] &&
					!isAuthenticated(agentDir, target)
				) {
					ctx.ui.notify(`Account "${target}" is not configured in settings.json.`, "error");
					return;
				}
			}

			// Update active account in cachedSettings (preserving the target name)
			settings.account = target;
			cachedSettings = settings;

			updateStatus(ctx, agentDir, settings, log);

			const resolvedTarget = resolveAccountTarget(target);
			stopNotifications();
			if (isAuthenticated(agentDir, resolvedTarget)) {
				startNotifications(pi, settings, agentDir, log);
				const email = getAuthenticatedEmail(agentDir, resolvedTarget);
				ctx.ui.notify(`✅ Switched to Gmail account "${target}" (${email}).`, "info");
			} else {
				ctx.ui.notify(`Switched to Gmail account "${target}" (not connected). Run \`/gmail-auth ${target}\` to connect.`, "info");
			}
		},
	});

	pi.registerCommand("gmail-accounts", {
		description: "List all configured and connected Gmail accounts",
		handler: async (_args: string | undefined, _ctx: any) => {
			const agentDir = getAgentDir();
			const settings = cachedSettings ?? getSettings(process.cwd());
			const accounts = listAccounts(settings, agentDir, settings.account);
			const formatted = formatAccountsList(accounts);
			pi.sendMessage({
				customType: "gmail_accounts",
				content: formatted,
				display: true,
				details: { type: "info" },
			});
		},
	});

	pi.registerCommand("gmail-logout", {
		description: "Disconnect Gmail account (usage: /gmail-logout [account_name])",
		handler: async (args: string | undefined, ctx: any) => {
			const agentDir = getAgentDir();
			const settings = cachedSettings ?? getSettings(ctx.cwd);
			const requestedAccount = args?.trim() || settings.account || settings.defaultAccount;
			const target = resolveAccountTarget(requestedAccount);
			const email = getAuthenticatedEmail(agentDir, target);

			if (!email && !isAuthenticated(agentDir, target)) {
				ctx.ui.notify(`Gmail account "${requestedAccount || "default"}" is not connected.`, "info");
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"Disconnect Gmail?",
				`This will remove the stored tokens for ${email || requestedAccount || "default"}.`,
			);

			if (!confirmed) return;

			await clearTokens(agentDir, target);

			// Stop notifications only if the logged out account is the currently active/polled account
			if (resolveAccountTarget(settings.account) === target) {
				stopNotifications();
			}

			updateStatus(ctx, agentDir, settings, log);
			ctx.ui.notify(`Gmail disconnected (${email || requestedAccount || "default"}).`, "info");
		},
	});

	pi.registerCommand("gmail-status", {
		description: "Show Gmail connection status",
		handler: async (_args: string | undefined, ctx: any) => {
			const agentDir = getAgentDir();
			const settings = cachedSettings ?? getSettings(ctx.cwd);
			const target = resolveAccountTarget(settings.account);

			if (isAuthenticated(agentDir, target)) {
				const email = getAuthenticatedEmail(agentDir, target);
				const accLabel = target ? ` [account: ${target}]` : "";
				ctx.ui.notify(`✅ Gmail connected as ${email}${accLabel}`, "info");
			} else {
				const accLabel = target ? ` for account "${target}"` : "";
				ctx.ui.notify(`⚠️ Gmail not connected${accLabel}. Run /gmail-auth to connect.`, "info");
			}
		},
	});

	// Event bus listeners for web/mobile slash command support
	pi.events.on("command:gmail-status", async (data: unknown) => {
		const { source } = data as { args: string; source?: string };
		const agentDir = getAgentDir();
		const settings = cachedSettings ?? getSettings(process.cwd());
		const target = resolveAccountTarget(settings.account);
		if (isAuthenticated(agentDir, target)) {
			const email = getAuthenticatedEmail(agentDir, target);
			const msg = `✅ Gmail connected as ${email}${target ? ` [account: ${target}]` : ""}`;
			pi.sendMessage({ customType: "command_result", content: msg, display: true, details: { type: "info" } });
			pi.events.emit("command_result", { command: "gmail-status", message: msg, type: "info", source: source ?? "" });
		} else {
			const msg = `⚠️ Gmail not connected${target ? ` for account "${target}"` : ""}. Run /gmail-auth to connect.`;
			pi.sendMessage({ customType: "command_result", content: msg, display: true, details: { type: "info" } });
			pi.events.emit("command_result", { command: "gmail-status", message: msg, type: "info", source: source ?? "" });
		}
	});

	pi.events.on("command:gmail-accounts", async (data: unknown) => {
		const { source } = data as { args: string; source?: string };
		const agentDir = getAgentDir();
		const settings = cachedSettings ?? getSettings(process.cwd());
		const accounts = listAccounts(settings, agentDir, settings.account);
		const formatted = formatAccountsList(accounts);
		pi.sendMessage({ customType: "command_result", content: formatted, display: true, details: { type: "info" } });
		pi.events.emit("command_result", { command: "gmail-accounts", message: formatted, type: "info", source: source ?? "" });
	});
}
