/**
 * pi-channels — Built-in webhook adapter.
 *
 * Sends HTTP requests where recipient is the webhook URL.
 * Supports two payload modes:
 *   - envelope (default): { text, source, metadata, timestamp }
 *   - raw: send rawBody as-is (string) or JSON-serialized (non-string)
 *
 * Authentication:
 *   - Explicit headers config takes priority.
 *   - If no Authorization header is set, the `secret` config field (or
 *     WEBHOOK_SECRET env var) is used as a Bearer token automatically.
 *
 * Config:
 * {
 *   "type": "webhook",
 *   "method": "POST",
 *   "contentType": "application/json",
 *   "payloadMode": "envelope",
 *   "secret": "your-secret-or-use-WEBHOOK_SECRET-env-var",
 *   "headers": { "Authorization": "Bearer ..." }
 * }
 */

import type { ChannelAdapter, ChannelMessage, AdapterConfig, ChannelPayloadMode } from "../types.ts";
import type { AdapterFactoryContext } from "../registry.ts";

export async function createWebhookAdapter(config: AdapterConfig, _context: AdapterFactoryContext): Promise<ChannelAdapter> {
	const defaultMethod = (config.method as string) ?? "POST";
	const defaultContentType = (config.contentType as string) ?? "application/json";
	const configHeaders = (config.headers as Record<string, string>) ?? {};
	const secret = config.secret as string | undefined;
	const defaultPayloadMode: ChannelPayloadMode = config.payloadMode === "raw" ? "raw" : "envelope";

	// Build effective headers: if no Authorization header is explicitly set and a
	// secret is available (from config or WEBHOOK_SECRET env var), add Bearer auth.
	const hasAuthHeader = Object.keys(configHeaders).some(k => k.toLowerCase() === "authorization");
	const extraHeaders: Record<string, string> = { ...configHeaders };
	if (!hasAuthHeader && secret) {
		extraHeaders["Authorization"] = `Bearer ${secret}`;
	}

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
			const normalizedMethod = method.toUpperCase();
			const canHaveBody = normalizedMethod !== "GET" && normalizedMethod !== "HEAD";

			let body: string | undefined;
			if (payloadMode === "raw") {
				if (canHaveBody) {
					if (message.rawBody === undefined) {
						throw new Error(`Webhook raw payload mode requires rawBody for ${normalizedMethod} requests`);
					}
					body = typeof message.rawBody === "string"
						? message.rawBody
						: JSON.stringify(message.rawBody);
				} else if (message.rawBody !== undefined) {
					throw new Error(`Webhook ${normalizedMethod} requests cannot include a body; omit json/rawBody or use POST/PUT/PATCH/DELETE`);
				}
			} else if (canHaveBody) {
				body = JSON.stringify({
					text: message.text ?? "",
					source: message.source,
					metadata: message.metadata,
					timestamp: new Date().toISOString(),
				});
			}

			const headers: Record<string, string> = {};
			for (const [key, value] of Object.entries(extraHeaders)) {
				if (key.toLowerCase() === "content-type") continue;
				headers[key] = value;
			}
			if (body !== undefined) {
				headers["Content-Type"] = contentType;
			}

			const request: RequestInit = { method };
			if (Object.keys(headers).length > 0) {
				request.headers = headers;
			}
			if (body !== undefined) {
				request.body = body;
			}

			const res = await fetch(message.recipient, request);

			if (!res.ok) {
				const err = await res.text().catch(() => "unknown error");
				throw new Error(`Webhook error ${res.status}: ${err}`);
			}
		},
	};
}
