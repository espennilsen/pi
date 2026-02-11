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
				Type.String({ description: "Message text (required for send)" }),
			),
			source: Type.Optional(
				Type.String({ description: "Source label (optional)" }),
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
					if (!params.adapter || !params.text) {
						result = "Missing required fields: adapter and text.";
						break;
					}
					const r = await registry.send({
						adapter: params.adapter,
						recipient: params.recipient ?? "",
						text: params.text,
						source: params.source,
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
