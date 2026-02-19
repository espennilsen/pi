/**
 * pi-channels — Built-in webhook adapter.
 *
 * Sends HTTP requests where recipient is the webhook URL.
 * Supports two payload modes:
 *   - envelope (default): { text, source, metadata, timestamp }
 *   - raw: send rawBody as-is (string) or JSON-serialized (non-string)
 *
 * Config:
 * {
 *   "type": "webhook",
 *   "method": "POST",
 *   "contentType": "application/json",
 *   "payloadMode": "envelope",
 *   "headers": { "Authorization": "Bearer ..." }
 * }
 */

import type { ChannelAdapter, ChannelMessage, AdapterConfig, ChannelPayloadMode } from "../types.ts";

export function createWebhookAdapter(config: AdapterConfig): ChannelAdapter {
	const defaultMethod = (config.method as string) ?? "POST";
	const defaultContentType = (config.contentType as string) ?? "application/json";
	const extraHeaders = (config.headers as Record<string, string>) ?? {};
	const defaultPayloadMode: ChannelPayloadMode = config.payloadMode === "raw" ? "raw" : "envelope";

	return {
		direction: "outgoing" as const,

		async send(message: ChannelMessage): Promise<void> {
			const payloadMode = message.payloadMode ?? defaultPayloadMode;
			const method = payloadMode === "raw"
				? (message.webhook?.method ?? defaultMethod)
				: defaultMethod;
			const contentType = payloadMode === "raw"
				? (message.webhook?.contentType ?? defaultContentType)
				: defaultContentType;

			let body: string;
			if (payloadMode === "raw") {
				if (message.rawBody === undefined) {
					throw new Error("Webhook raw payload mode requires rawBody");
				}
				body = typeof message.rawBody === "string"
					? message.rawBody
					: JSON.stringify(message.rawBody);
			} else {
				body = JSON.stringify({
					text: message.text ?? "",
					source: message.source,
					metadata: message.metadata,
					timestamp: new Date().toISOString(),
				});
			}

			const res = await fetch(message.recipient, {
				method,
				headers: { ...extraHeaders, "Content-Type": contentType },
				body,
			});

			if (!res.ok) {
				const err = await res.text().catch(() => "unknown error");
				throw new Error(`Webhook error ${res.status}: ${err}`);
			}
		},
	};
}
