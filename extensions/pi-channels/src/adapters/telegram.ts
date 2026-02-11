/**
 * pi-channels — Built-in Telegram adapter (bidirectional).
 *
 * Outgoing: Telegram Bot API sendMessage.
 * Incoming: Long-polling via getUpdates.
 *
 * Config:
 * {
 *   "type": "telegram",
 *   "botToken": "env:TELEGRAM_BOT_TOKEN",
 *   "parseMode": "Markdown",
 *   "polling": true,
 *   "pollingTimeout": 30,
 *   "allowedChatIds": ["123456789", "-100987654321"]
 * }
 *
 * The recipient field on outgoing messages is the Telegram chat ID.
 * If polling is false/omitted, only outgoing is active.
 * allowedChatIds restricts which chats can send messages in (security).
 */

import type { ChannelAdapter, ChannelMessage, AdapterConfig, OnIncomingMessage } from "../types.ts";

const MAX_LENGTH = 4096;

export function createTelegramAdapter(config: AdapterConfig): ChannelAdapter {
	const botToken = config.botToken as string;
	const parseMode = config.parseMode as string | undefined;
	const pollingEnabled = config.polling === true;
	const pollingTimeout = (config.pollingTimeout as number) ?? 30;
	const allowedChatIds = config.allowedChatIds as string[] | undefined;

	if (!botToken) {
		throw new Error("Telegram adapter requires botToken");
	}

	const apiBase = `https://api.telegram.org/bot${botToken}`;
	let offset = 0;
	let running = false;
	let abortController: AbortController | null = null;

	// ── Outgoing ────────────────────────────────────────────

	async function sendTelegram(chatId: string, text: string): Promise<void> {
		const body: Record<string, unknown> = { chat_id: chatId, text };
		if (parseMode) body.parse_mode = parseMode;

		const res = await fetch(`${apiBase}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const err = await res.text().catch(() => "unknown error");
			throw new Error(`Telegram API error ${res.status}: ${err}`);
		}
	}

	// ── Incoming (long polling) ─────────────────────────────

	async function poll(onMessage: OnIncomingMessage): Promise<void> {
		while (running) {
			try {
				abortController = new AbortController();
				const url = `${apiBase}/getUpdates?offset=${offset}&timeout=${pollingTimeout}`;
				const res = await fetch(url, {
					signal: abortController.signal,
				});

				if (!res.ok) {
					// Back off on errors
					await sleep(5000);
					continue;
				}

				const data = await res.json() as {
					ok: boolean;
					result: Array<{
						update_id: number;
						message?: {
							message_id: number;
							from?: { id: number; username?: string; first_name?: string };
							chat: { id: number; type: string; title?: string };
							date: number;
							text?: string;
						};
					}>;
				};

				if (!data.ok || !data.result?.length) continue;

				for (const update of data.result) {
					offset = update.update_id + 1;

					const msg = update.message;
					if (!msg?.text) continue;

					const chatId = String(msg.chat.id);

					// Security: skip messages from non-allowed chats
					if (allowedChatIds && !allowedChatIds.includes(chatId)) continue;

					onMessage({
						adapter: "telegram",
						sender: chatId,
						text: msg.text,
						metadata: {
							messageId: msg.message_id,
							chatType: msg.chat.type,
							chatTitle: msg.chat.title,
							userId: msg.from?.id,
							username: msg.from?.username,
							firstName: msg.from?.first_name,
							date: msg.date,
						},
					});
				}
			} catch (err: any) {
				if (err.name === "AbortError") break;
				// Back off on network errors
				if (running) await sleep(5000);
			}
		}
	}

	// ── Typing indicator ────────────────────────────────────

	async function sendChatAction(chatId: string, action = "typing"): Promise<void> {
		try {
			await fetch(`${apiBase}/sendChatAction`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: chatId, action }),
			});
		} catch {
			// Best-effort — silently ignore
		}
	}

	// ── Adapter ─────────────────────────────────────────────

	return {
		direction: "bidirectional" as const,

		async sendTyping(recipient: string): Promise<void> {
			await sendChatAction(recipient, "typing");
		},

		async send(message: ChannelMessage): Promise<void> {
			const prefix = message.source ? `[${message.source}]\n` : "";
			const full = prefix + message.text;

			if (full.length <= MAX_LENGTH) {
				await sendTelegram(message.recipient, full);
				return;
			}

			// Split long messages at newlines
			let remaining = full;
			while (remaining.length > 0) {
				if (remaining.length <= MAX_LENGTH) {
					await sendTelegram(message.recipient, remaining);
					break;
				}
				let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
				if (splitAt < MAX_LENGTH / 2) splitAt = MAX_LENGTH;
				await sendTelegram(message.recipient, remaining.slice(0, splitAt));
				remaining = remaining.slice(splitAt).replace(/^\n/, "");
			}
		},

		async start(onMessage: OnIncomingMessage): Promise<void> {
			if (!pollingEnabled) return;
			if (running) return;
			running = true;
			poll(onMessage);
		},

		async stop(): Promise<void> {
			running = false;
			abortController?.abort();
			abortController = null;
		},
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
