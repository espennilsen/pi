/**
 * pi-channels — Built-in webhook adapter.
 *
 * POSTs message as JSON. The recipient field is the webhook URL.
 *
 * Config:
 * {
 *   "type": "webhook",
 *   "method": "POST",
 *   "headers": { "Authorization": "Bearer ..." }
 * }
 */

import type { ChannelAdapter, ChannelMessage, AdapterConfig } from "../types.ts";

export function createWebhookAdapter(config: AdapterConfig): ChannelAdapter {
	const method = (config.method as string) ?? "POST";
	const extraHeaders = (config.headers as Record<string, string>) ?? {};

	return {
		direction: "outgoing" as const,

		async send(message: ChannelMessage): Promise<void> {
			const res = await fetch(message.recipient, {
				method,
				headers: { "Content-Type": "application/json", ...extraHeaders },
				body: JSON.stringify({
					text: message.text,
					source: message.source,
					metadata: message.metadata,
					timestamp: new Date().toISOString(),
				}),
			});

			if (!res.ok) {
				const err = await res.text().catch(() => "unknown error");
				throw new Error(`Webhook error ${res.status}: ${err}`);
			}
		},
	};
}
