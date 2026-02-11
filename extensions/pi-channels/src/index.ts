/**
 * pi-channels — Two-way channel extension for pi.
 *
 * Routes messages between agents and external services
 * (Telegram, webhooks, custom adapters).
 *
 * Built-in adapters: telegram (bidirectional), webhook (outgoing)
 * Custom adapters: register via pi.events.emit("channel:register", ...)
 *
 * Config in settings.json under "pi-channels":
 * {
 *   "pi-channels": {
 *     "adapters": {
 *       "telegram": { "type": "telegram", "botToken": "env:TELEGRAM_BOT_TOKEN", "polling": true }
 *     },
 *     "routes": {
 *       "ops": { "adapter": "telegram", "recipient": "-100987654321" }
 *     }
 *   }
 * }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { ChannelRegistry } from "./registry.ts";
import { registerChannelEvents } from "./events.ts";
import { registerChannelTool } from "./tool.ts";

export default function (pi: ExtensionAPI) {
	const registry = new ChannelRegistry();

	// ── Event API + cron integration ──────────────────────────
	// Must register before session_start so onIncoming is wired

	registerChannelEvents(pi, registry);

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd);
		registry.loadConfig(config);

		const errors = registry.getErrors();
		for (const err of errors) {
			ctx.ui.notify(`pi-channels: ${err.adapter}: ${err.error}`, "warning");
		}

		// Start incoming/bidirectional adapters
		await registry.startListening();

		const startErrors = registry.getErrors().filter(e => e.error.startsWith("Failed to start"));
		for (const err of startErrors) {
			ctx.ui.notify(`pi-channels: ${err.adapter}: ${err.error}`, "warning");
		}
	});

	// ── LLM tool ──────────────────────────────────────────────

	registerChannelTool(pi, registry);
}
