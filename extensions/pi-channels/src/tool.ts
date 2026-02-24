/**
 * pi-channels — LLM tool registration.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ChannelRegistry } from "./registry.ts";

interface ChannelToolParams {
	action: "send" | "list" | "test";
	adapter?: string;
	recipient?: string;
	text?: string;
	source?: string;
	json?: string;
	payloadMode?: "envelope" | "raw";
	method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
	contentType?: string;
}

export function registerChannelTool(pi: ExtensionAPI, registry: ChannelRegistry): void {
	pi.registerTool({
		name: "notify",
		label: "Channel",
		description:
			"Send notifications via configured adapters (Telegram, webhooks, custom). " +
			"Actions: send (deliver a message), list (show adapters + routes), test (send a ping).",
		parameters: Type.Object({
			action: StringEnum(
				["send", "list", "test"] as const,
				{ description: "Action to perform" },
			) as any,
			adapter: Type.Optional(
				Type.String({ description: "Adapter name or route alias (required for send, test)" }),
			),
			recipient: Type.Optional(
				Type.String({ description: "Recipient — chat ID, webhook URL, etc. (required for send unless using a route)" }),
			),
			text: Type.Optional(
				Type.String({ description: "Message text (required for send unless using json payload)" }),
			),
			source: Type.Optional(
				Type.String({ description: "Source label (optional)" }),
			),
			json: Type.Optional(
				Type.String({ description: "Custom JSON payload string (optional, sends raw JSON body when provided)" }),
			),
			payloadMode: Type.Optional(
				StringEnum(
					["envelope", "raw"] as const,
					{ description: "Webhook payload mode (default: envelope, auto-switches to raw when json is provided)" },
				) as any,
			),
			method: Type.Optional(
				StringEnum(
					["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const,
					{ description: "HTTP method override for webhook raw mode" },
				) as any,
			),
			contentType: Type.Optional(
				Type.String({ description: "Content-Type header override for webhook raw mode" }),
			),
		}) as any,

		async execute(_toolCallId, _params) {
			const params = _params as ChannelToolParams;
			let result: string;

			switch (params.action) {
				case "list": {
					const items = registry.list();
					if (items.length === 0) {
						result = 'No adapters configured. Add "pi-channels" to your settings.json.';
					} else {
						const lines = items.map(i =>
							i.type === "route"
								? `- **${i.name}** (route → ${i.target})`
								: `- **${i.name}** (${i.direction ?? "adapter"})`
						);
						result = `**Channel (${items.length}):**\n${lines.join("\n")}`;
					}
					break;
				}
				case "send": {
					if (!params.adapter) {
						result = "Missing required field: adapter.";
						break;
					}

					const payloadMode = params.payloadMode ?? (params.json ? "raw" : "envelope");
					const normalizedMethod = params.method?.toUpperCase();
					const methodDisallowsBody = normalizedMethod === "GET" || normalizedMethod === "HEAD";

					if (payloadMode === "envelope" && !params.text) {
						result = "Envelope payload mode requires text.";
						break;
					}
					if (payloadMode === "envelope" && params.json) {
						result = "json is only supported in raw payload mode.";
						break;
					}
					if (payloadMode !== "raw" && (params.method || params.contentType)) {
						result = "method/contentType overrides are only supported in raw payload mode.";
						break;
					}
					if (payloadMode === "raw" && !methodDisallowsBody && !params.json) {
						result = `Raw payload mode requires json${normalizedMethod ? ` for ${normalizedMethod} requests` : ""}.`;
						break;
					}
					if (payloadMode === "raw" && methodDisallowsBody && params.json) {
						result = `${normalizedMethod} requests cannot include json body in raw mode.`;
						break;
					}

					let parsedJson: unknown;
					if (payloadMode === "raw" && params.json) {
						try {
							parsedJson = JSON.parse(params.json);
						} catch (err: any) {
							result = `Invalid JSON: ${err.message ?? "Malformed JSON payload."}`;
							break;
						}
					}

					const r = await registry.send({
						adapter: params.adapter,
						recipient: params.recipient ?? "",
						text: params.text,
						source: params.source,
						payloadMode,
						rawBody: parsedJson,
						webhook: payloadMode === "raw"
							? { method: params.method, contentType: params.contentType }
							: undefined,
					});
					result = r.ok
						? `✓ Sent via "${params.adapter}"${params.recipient ? ` to ${params.recipient}` : ""}`
						: `Failed: ${r.error}`;
					break;
				}
				case "test": {
					if (!params.adapter) {
						result = "Missing required field: adapter.";
						break;
					}
					const r = await registry.send({
						adapter: params.adapter,
						recipient: params.recipient ?? "",
						text: `🏓 pi-channels test — ${new Date().toISOString()}`,
						source: "channel:test",
					});
					result = r.ok
						? `✓ Test sent via "${params.adapter}"${params.recipient ? ` to ${params.recipient}` : ""}`
						: `Failed: ${r.error}`;
					break;
				}
				default:
					result = `Unknown action: ${(params as any).action}`;
			}

			return {
				content: [{ type: "text" as const, text: result }],
				details: {},
			};
		},
	});
}
