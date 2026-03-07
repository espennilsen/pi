/**
 * pi-channels — Built-in Slack adapter (bidirectional).
 *
 * Outgoing: Slack Web API chat.postMessage.
 * Incoming: Socket Mode (WebSocket) for events + slash commands.
 *
 * Supports:
 *   - Text messages (channels, groups, DMs, multi-party DMs)
 *   - @mentions (app_mention events)
 *   - Slash commands (/aivena by default)
 *   - Typing indicators (chat action)
 *   - Thread replies (when replying in threads)
 *   - Message splitting for long messages (>3000 chars)
 *   - Channel allowlisting (optional)
 *
 * Requires:
 *   - App-level token (xapp-...) for Socket Mode — in settings under pi-channels.slack.appToken
 *   - Bot token (xoxb-...) for Web API — in settings under pi-channels.slack.botToken
 *   - Socket Mode enabled in app settings
 *
 * Config in ~/.pi/agent/settings.json:
 * {
 *   "pi-channels": {
 *     "adapters": {
 *       "slack": {
 *         "type": "slack",
 *         "allowedChannelIds": ["C0123456789"],
 *         "respondToMentionsOnly": true,
 *         "slashCommand": "/aivena"
 *       }
 *     },
 *     "slack": {
 *       "appToken": "xapp-1-...",
 *       "botToken": "xoxb-..."
 *     }
 *   }
 * }
 */

import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type {
	ChannelAdapter,
	ChannelMessage,
	AdapterConfig,
	OnIncomingMessage,
} from "../types.ts";
import type { AdapterFactoryContext } from "../registry.ts";
import { getChannelSetting } from "../config.ts";

const MAX_LENGTH = 3000; // Slack block text limit; actual API limit is 4000 but leave margin

// ── Slack event types (subset) ──────────────────────────────────

interface SlackMessageEvent {
	type: string;
	subtype?: string;
	channel: string;
	user?: string;
	text?: string;
	ts: string;
	thread_ts?: string;
	channel_type?: string;
	bot_id?: string;
}

interface SlackMentionEvent {
	type: string;
	channel: string;
	user: string;
	text: string;
	ts: string;
	thread_ts?: string;
}

interface SlackCommandPayload {
	command: string;
	text: string;
	user_id: string;
	user_name: string;
	channel_id: string;
	channel_name: string;
	trigger_id: string;
}

// ── Factory ─────────────────────────────────────────────────────

export type SlackAdapterLogger = (event: string, data: Record<string, unknown>, level?: string) => void;

export async function createSlackAdapter(config: AdapterConfig, context: AdapterFactoryContext): Promise<ChannelAdapter> {
	const { cwd, log } = context;
	// Tokens live in settings under pi-channels.slack (not in the adapter config block)
	const appToken = (cwd ? getChannelSetting(cwd, "slack.appToken") as string : null)
		?? config.appToken as string;
	const botToken = (cwd ? getChannelSetting(cwd, "slack.botToken") as string : null)
		?? config.botToken as string;

	const allowedChannelIds = config.allowedChannelIds as string[] | undefined;
	const respondToMentionsOnly = config.respondToMentionsOnly === true;
	const slashCommand = (config.slashCommand as string) ?? "/aivena";

	if (!appToken) throw new Error("Slack adapter requires appToken (xapp-...) in settings under pi-channels.slack.appToken");
	if (!botToken) throw new Error("Slack adapter requires botToken (xoxb-...) in settings under pi-channels.slack.botToken");

	let socketClient: SocketModeClient | null = null;
	const webClient = new WebClient(botToken);
	let botUserId: string | null = null;

	// ── Helpers ─────────────────────────────────────────────

	function isAllowed(channelId: string): boolean {
		if (!allowedChannelIds || allowedChannelIds.length === 0) return true;
		return allowedChannelIds.includes(channelId);
	}

	/** Strip the bot's own @mention from message text */
	function stripBotMention(text: string): string {
		if (!botUserId) return text;
		// Slack formats mentions as <@U12345>
		return text.replace(new RegExp(`<@${botUserId}>\\s*`, "g"), "").trim();
	}

	/** Build metadata common to all incoming messages */
	function buildMetadata(event: { channel?: string; user?: string; ts?: string; thread_ts?: string; channel_type?: string }, extra?: Record<string, unknown>): Record<string, unknown> {
		return {
			channelId: event.channel,
			userId: event.user,
			timestamp: event.ts,
			threadTs: event.thread_ts,
			channelType: event.channel_type,
			...extra,
		};
	}

	// ── Sending ─────────────────────────────────────────────

	async function sendSlack(channelId: string, text: string, threadTs?: string): Promise<void> {
		await webClient.chat.postMessage({
			channel: channelId,
			text,
			thread_ts: threadTs,
			// Unfurl links/media is off by default to keep responses clean
			unfurl_links: false,
			unfurl_media: false,
		});
	}

	// ── Adapter ─────────────────────────────────────────────

	return {
		direction: "bidirectional" as const,

		async sendTyping(recipient: string): Promise<void> {
			// Slack doesn't have a direct "typing" API for bots in channels.
			// We can use a reaction or simply no-op. For DMs, there's no API either.
			// Best we can do is nothing — Slack bots don't show typing indicators.
		},

		async send(message: ChannelMessage): Promise<void> {
			if (!message.text) {
				throw new Error("Slack adapter requires text");
			}
			const prefix = message.source ? `*[${message.source}]*\n` : "";
			const full = prefix + message.text;
			const threadTs = message.metadata?.threadTs as string | undefined;

			if (full.length <= MAX_LENGTH) {
				await sendSlack(message.recipient, full, threadTs);
				return;
			}

			// Split long messages at newlines
			let remaining = full;
			while (remaining.length > 0) {
				if (remaining.length <= MAX_LENGTH) {
					await sendSlack(message.recipient, remaining, threadTs);
					break;
				}
				let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
				if (splitAt < MAX_LENGTH / 2) splitAt = MAX_LENGTH;
				await sendSlack(message.recipient, remaining.slice(0, splitAt), threadTs);
				remaining = remaining.slice(splitAt).replace(/^\n/, "");
			}
		},

		async start(onMessage: OnIncomingMessage): Promise<void> {
			if (socketClient) return;

			// Resolve bot user ID (for stripping self-mentions)
			try {
				const authResult = await webClient.auth.test();
				botUserId = authResult.user_id as string ?? null;
			} catch {
				// Non-fatal — mention stripping just won't work
			}

			socketClient = new SocketModeClient({
				appToken,
				// Suppress noisy internal logging
				logLevel: "ERROR" as any,
			});

			// ── Message events ──────────────────────────────
			// Socket Mode wraps events in envelopes. The client emits
			// typed events: 'message', 'app_mention', 'slash_commands', etc.
			// Each handler receives { event, body, ack, ... }

			socketClient.on("message", async ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
				try {
					await ack();

					// Ignore bot messages (including our own)
					if (event.bot_id || event.subtype === "bot_message") return;
					// Ignore message_changed, message_deleted, etc.
					if (event.subtype) return;
					if (!event.text) return;
					if (!isAllowed(event.channel)) return;

					// Skip messages that @mention the bot in channels/groups — these are
					// handled by the app_mention listener to avoid duplicate responses.
					// DMs (im) and multi-party DMs (mpim) don't fire app_mention, so we
					// must NOT skip those here.
					if (botUserId && (event.channel_type === "channel" || event.channel_type === "group") && event.text.includes(`<@${botUserId}>`)) return;

					// In channels/groups, optionally only respond to @mentions
					// (app_mention events are handled separately below)
					if (respondToMentionsOnly && (event.channel_type === "channel" || event.channel_type === "group")) return;

					// Use channel:threadTs as sender key for threaded conversations
					const sender = event.thread_ts
						? `${event.channel}:${event.thread_ts}`
						: event.channel;

					onMessage({
						adapter: "slack",
						sender,
						text: stripBotMention(event.text),
						metadata: buildMetadata(event, {
							eventType: "message",
						}),
					});
				} catch (err) { log?.("slack-handler-error", { handler: "message", error: String(err) }, "ERROR"); }
			});

			// ── App mention events ──────────────────────────
			socketClient.on("app_mention", async ({ event, ack }: { event: SlackMentionEvent; ack: () => Promise<void> }) => {
				try {
					await ack();

					if (!isAllowed(event.channel)) return;

					const sender = event.thread_ts
						? `${event.channel}:${event.thread_ts}`
						: event.channel;

					onMessage({
						adapter: "slack",
						sender,
						text: stripBotMention(event.text),
						metadata: buildMetadata(event, {
							eventType: "app_mention",
						}),
					});
				} catch (err) { log?.("slack-handler-error", { handler: "app_mention", error: String(err) }, "ERROR"); }
			});

			// ── Slash commands ───────────────────────────────
			socketClient.on("slash_commands", async ({ body, ack }: { body: SlackCommandPayload; ack: (response?: any) => Promise<void> }) => {
				try {
					if (body.command !== slashCommand) {
						await ack();
						return;
					}

					if (!body.text?.trim()) {
						await ack({ text: `Usage: ${slashCommand} [your message]` });
						return;
					}

					if (!isAllowed(body.channel_id)) {
						await ack({ text: "⛔ This command is not available in this channel." });
						return;
					}

					// Acknowledge immediately (Slack requires <3s response)
					await ack({ text: "🤔 Thinking..." });

					onMessage({
						adapter: "slack",
						sender: body.channel_id,
						text: body.text.trim(),
						metadata: {
							channelId: body.channel_id,
							channelName: body.channel_name,
							userId: body.user_id,
							userName: body.user_name,
							eventType: "slash_command",
							command: body.command,
						},
					});
				} catch (err) { log?.("slack-handler-error", { handler: "slash_commands", error: String(err) }, "ERROR"); }
			});

			// ── Interactive payloads (future: button clicks, modals) ──
			socketClient.on("interactive", async ({ body, ack }: { body: any; ack: () => Promise<void> }) => {
				try {
					await ack();
					// TODO: handle interactive payloads (block actions, modals)
				} catch (err) { log?.("slack-handler-error", { handler: "interactive", error: String(err) }, "ERROR"); }
			});

			await socketClient.start();
		},

		async stop(): Promise<void> {
			if (socketClient) {
				await socketClient.disconnect();
				socketClient = null;
			}
		},
	};
}
