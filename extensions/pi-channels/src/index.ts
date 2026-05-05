/**
 * pi-channels — Two-way channel extension for pi.
 *
 * Routes messages between agents and external services
 * (Telegram, webhooks, custom adapters).
 *
 * Built-in adapters: telegram (bidirectional), webhook (outgoing)
 * Custom adapters: register via pi.events.emit("channel:register", ...)
 *
 * Chat bridge: when enabled, incoming messages are routed to the agent
 * as isolated subprocess prompts and responses are sent back. Enable via:
 *   - --chat-bridge flag
 *   - /chat-bridge on command
 *   - settings.json: { "pi-channels": { "bridge": { "enabled": true } } }
 *
 * Slash command routing: incoming /commands are checked against pi's
 * registered slash commands. Extension commands are dispatched via the
 * event bus; skill/prompt commands are expanded into the agent prompt.
 */

import type { ExtensionAPI, SlashCommandInfo } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { ChannelRegistry } from "./registry.ts";
import { registerChannelEvents, setBridge, setHistory } from "./events.ts";
import { registerChannelTool } from "./tool.ts";
import { ChatBridge } from "./bridge/bridge.ts";
import { getAllCommands, type SlashCommandInfo as ChannelSlashCommand } from "./bridge/commands.ts";
import { createLogger } from "./logger.ts";
import { MessageHistory, type MessageRow } from "./history.ts";

/** Convert pi's SlashCommandInfo to the bridge's simplified format. */
function toChannelSlashCommands(commands: SlashCommandInfo[]): ChannelSlashCommand[] {
	return commands.map(cmd => ({
		name: cmd.name,
		description: cmd.description,
		source: cmd.source,
		sourceInfo: {
			path: cmd.sourceInfo.path,
			baseDir: cmd.sourceInfo.baseDir,
		},
	}));
}

/** Wait for pi-kysely to be ready (or timeout after 10s). */
async function waitForKysely(pi: ExtensionAPI): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error("Timed out waiting for pi-kysely"));
		}, 10_000);

		let resolved = false;
		const done = () => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timeout);
				resolve();
			}
		};

		// Try probing — if already ready, the reply callback fires synchronously
		pi.events.emit("kysely:info", {
			reply: (_info: unknown) => done(),
		});

		// Also listen for the ready event in case it hasn't fired yet
		pi.events.on("kysely:ready", done);
	});
}

/** Show message history in a TUI overlay popup. */
async function showHistoryPopup(ctx: any, rows: MessageRow[]): Promise<void> {
	const { matchesKey, Key, truncateToWidth } = await import("@mariozechner/pi-tui");

	const arrow = (d: string) => (d === "in" ? "←" : "→");
	const source = (row: MessageRow) =>
		row.direction === "in" ? (row.sender || "?") : (row.recipient || "?");

	const maxVisible = 15;
	let scrollOffset = 0;

	const component = {
		invalidate() {},
		render(width: number): string[] {
			const maxWidth = Math.min(width, 100);
			const lines: string[] = [];
			lines.push(truncateToWidth(`📨 Channel History (${rows.length} messages)`, maxWidth));
			lines.push("");

			const start = scrollOffset;
			const end = Math.min(start + maxVisible, rows.length);

			for (let i = start; i < end; i++) {
				const row = rows[i];
				const ts = row.created_at?.replace("T", " ").slice(5, 16) ?? "?";
				const preview = (row.text ?? "").slice(0, 80).replace(/\n/g, " ");
				let line = `${ts} ${arrow(row.direction)}[${row.adapter}] ${source(row)}: ${preview}`;
				if (row.direction === "in") line = `\x1b[34m${line}\x1b[0m`;
				lines.push(truncateToWidth(line, maxWidth));
			}

			if (rows.length > maxVisible) {
				lines.push("");
				lines.push(truncateToWidth(
					`${start + 1}-${end} of ${rows.length}  ↑↓ scroll  esc close`,
					maxWidth,
				));
			}

			return lines;
		},
		handleInput(data: string): void {
			if (matchesKey(data, Key.up) && scrollOffset > 0) {
				scrollOffset--;
			} else if (matchesKey(data, Key.down) && scrollOffset < rows.length - maxVisible) {
				scrollOffset++;
			}
		},
	};

	await new Promise<void>((resolve) => {
		const origHandleInput = component.handleInput;
		component.handleInput = (data: string) => {
			if (matchesKey(data, Key.escape)) {
				handle.close();
				resolve();
				return;
			}
			origHandleInput.call(component, data);
		};
		const handle = ctx.ui.custom(component, { overlay: true });
	});
}

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	const registry = new ChannelRegistry();
	registry.setLogger(log);
	let bridge: ChatBridge | null = null;
	let history: MessageHistory | null = null;

	// ── Flag: --chat-bridge ───────────────────────────────────

	pi.registerFlag("chat-bridge", {
		description: "Enable the chat bridge on startup (incoming messages → agent → reply)",
		type: "boolean",
		default: false,
	});

	// ── Event API + cron integration ──────────────────────────

	registerChannelEvents(pi, registry);

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event: any, ctx: any) => {
		const config = loadConfig(ctx.cwd);
		registry.setModelRegistry(ctx.modelRegistry);

		// Initialize message history (waits for pi-kysely to be ready)
		const retentionDays = config.messageRetentionDays ?? 30;
		history = new MessageHistory(pi.events, retentionDays);
		history.setErrorLogger(log);
		await waitForKysely(pi).then(() => history!.init());
		registry.setHistory(history);
		setHistory(history);
		log("history-init", { retentionDays });

		// Register channel_history tool (now that history is ready)
		registerChannelTool(pi, registry, history);

		await registry.loadConfig(config, ctx.cwd);

		const errors = registry.getErrors();
		for (const err of errors) {
			ctx.ui.notify(`pi-channels: ${err.adapter}: ${err.error}`, "warning");
			log("adapter-error", { adapter: err.adapter, error: err.error }, "ERROR");
		}
		log("init", { adapters: Object.keys(config.adapters ?? {}), routes: Object.keys(config.routes ?? {}) });

		// Start incoming/bidirectional adapters
		await registry.startListening();

		// Sync bot commands with platforms (e.g. Telegram /command menu)
		// Telegram limits descriptions to 256 chars — truncate if needed
		const truncate = (desc: string) => desc.length > 256 ? desc.slice(0, 253) + "..." : desc;
		const builtInCommands = getAllCommands().map(c => ({ command: c.name, description: truncate(c.description) }));
		const piCommands = pi.getCommands().map(c => ({ command: c.name, description: truncate(c.description || c.name) }));
		const allBotCommands = [...builtInCommands, ...piCommands];
		await registry.syncBotCommands(allBotCommands);

		const startErrors = registry.getErrors().filter(e => e.error.startsWith("Failed to start"));
		for (const err of startErrors) {
			ctx.ui.notify(`pi-channels: ${err.adapter}: ${err.error}`, "warning");
		}

		// Initialize bridge with slash commands
		const slashCommands = toChannelSlashCommands(pi.getCommands());
		bridge = new ChatBridge(config.bridge, ctx.cwd, registry, pi.events, log, { slashCommands });
		setBridge(bridge);

		const flagEnabled = pi.getFlag("--chat-bridge");
		if (flagEnabled || config.bridge?.enabled) {
			bridge.start();
			log("bridge-start", {});
			ctx.ui.notify("pi-channels: Chat bridge started", "info");
		}
	});

	pi.on("session_shutdown", async () => {
		if (bridge?.isActive()) log("bridge-stop", {});
		bridge?.stop();
		setBridge(null);
		await registry.stopAll();
	});

	// ── Command: /chat-bridge ─────────────────────────────────

	pi.registerCommand("chat-bridge", {
		description: "Manage chat bridge: /chat-bridge [on|off|status]",
		getArgumentCompletions: (prefix: string) => {
			return ["on", "off", "status"]
				.filter(c => c.startsWith(prefix))
				.map(c => ({ value: c, label: c }));
		},
		handler: async (args: string | undefined, ctx: any) => {
			const cmd = args?.trim().toLowerCase();

			if (cmd === "on") {
				if (!bridge) {
					ctx.ui.notify("Chat bridge not initialized — no channel config?", "warning");
					return;
				}
				if (bridge.isActive()) {
					ctx.ui.notify("Chat bridge is already running.", "info");
					return;
				}
				bridge.start();
				ctx.ui.notify("✓ Chat bridge started", "info");
				return;
			}

			if (cmd === "off") {
				if (!bridge?.isActive()) {
					ctx.ui.notify("Chat bridge is not running.", "info");
					return;
				}
				bridge.stop();
				ctx.ui.notify("✓ Chat bridge stopped", "info");
				return;
			}

			// Default: status
			if (!bridge) {
				ctx.ui.notify("Chat bridge: not initialized", "info");
				return;
			}

			const stats = bridge.getStats();
			const lines = [
				`Chat bridge: ${stats.active ? "🟢 Active" : "⚪ Inactive"}`,
				`Sessions: ${stats.sessions}`,
				`Active prompts: ${stats.activePrompts}`,
				`Queued: ${stats.totalQueued}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ── LLM tool ──────────────────────────────────────────────

	registerChannelTool(pi, registry);

	// ── Command: /channel-history ─────────────────────────────

	pi.registerCommand("channel-history", {
		description: "View message history across channels: /channel-history [adapter] [limit]",
		getArgumentCompletions: (prefix: string) => {
			const adapters = registry.list().filter(i => i.type === "adapter").map(i => i.name);
			return adapters
				.filter(a => a.startsWith(prefix))
				.map(a => ({ value: a, label: a }));
		},
		handler: async (args: string | undefined, ctx: any) => {
			if (!history) {
				ctx.ui.notify("Message history not ready yet.", "warning");
				return;
			}

			const parts = (args ?? "").trim().split(/\s+/);
			const adapter = parts[0] || undefined;
			const limit = parts[1] ? parseInt(parts[1], 10) : 20;

			const rows = await history.query({ adapter, limit: Math.min(limit, 100) });

			if (rows.length === 0) {
				ctx.ui.notify("No messages found.", "info");
				return;
			}

			// Show in overlay popup
			showHistoryPopup(ctx, rows);
		},
	});

	// ── Shortcut: ctrl+shift+h → channel history ──────────────

	pi.registerShortcut("ctrl+shift+h", {
		description: "Show channel message history",
		handler: async (ctx: any) => {
			if (!history) {
				ctx.ui.notify("Message history not ready yet.", "warning");
				return;
			}
			const rows = await history.query({ limit: 30 });
			if (rows.length === 0) {
				ctx.ui.notify("No messages found.", "info");
				return;
			}
			showHistoryPopup(ctx, rows);
		},
	});

	// ── Event bus listener ────────────────────────────────────
	pi.events.on("command:chat-bridge", async (data: unknown) => {
		const { args: rawArgs, source } = data as { args: string; source?: string };
		const cmd = rawArgs?.trim().toLowerCase();
		const notify = (msg: string, type: "info" | "warning" | "error" = "info") => {
			pi.sendMessage({ customType: "command_result", content: msg, display: true, details: { type } });
			pi.events.emit("command_result", { command: "chat-bridge", message: msg, type, source: source ?? "" });
		};

		if (cmd === "on") {
			if (!bridge) { notify("Chat bridge not initialized — no channel config?", "warning"); return; }
			if (bridge.isActive()) { notify("Chat bridge is already running."); return; }
			bridge.start();
			notify("✓ Chat bridge started");
			return;
		}
		if (cmd === "off") {
			if (!bridge?.isActive()) { notify("Chat bridge is not running."); return; }
			bridge.stop();
			notify("✓ Chat bridge stopped");
			return;
		}
		// Default: status
		if (!bridge) { notify("Chat bridge: not initialized"); return; }
		const stats = bridge.getStats();
		const lines = [
			`Chat bridge: ${stats.active ? "🟢 Active" : "⚪ Inactive"}`,
			`Sessions: ${stats.sessions}`,
			`Active prompts: ${stats.activePrompts}`,
			`Queued: ${stats.totalQueued}`,
		];
		notify(lines.join("\n"));
	});
}
