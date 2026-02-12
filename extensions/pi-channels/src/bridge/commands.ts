/**
 * pi-channels — Bot command handler.
 *
 * Detects messages starting with / and handles them without routing
 * to the agent. Provides built-in commands and a registry for custom ones.
 *
 * Built-in: /start, /help, /abort, /status, /new
 */

import type { SenderSession } from "../types.ts";

export interface BotCommand {
	name: string;
	description: string;
	handler: (args: string, session: SenderSession | undefined, ctx: CommandContext) => string | null;
}

export interface CommandContext {
	abortCurrent: (sender: string) => boolean;
	clearQueue: (sender: string) => void;
	resetSession: (sender: string) => void;
	/** Check if a given sender is using persistent (RPC) mode. */
	isPersistent: (sender: string) => boolean;
}

const commands = new Map<string, BotCommand>();

export function isCommand(text: string): boolean {
	return /^\/[a-zA-Z]/.test(text.trim());
}

export function parseCommand(text: string): { command: string; args: string } {
	const match = text.trim().match(/^\/([a-zA-Z_]+)(?:@\S+)?\s*(.*)/s);
	if (!match) return { command: "", args: "" };
	return { command: match[1].toLowerCase(), args: match[2].trim() };
}

export function registerCommand(cmd: BotCommand): void {
	commands.set(cmd.name.toLowerCase(), cmd);
}

export function unregisterCommand(name: string): void {
	commands.delete(name.toLowerCase());
}

export function getAllCommands(): BotCommand[] {
	return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Handle a command. Returns reply text, or null if unrecognized
 * (fall through to agent).
 */
export function handleCommand(
	text: string,
	session: SenderSession | undefined,
	ctx: CommandContext,
): string | null {
	const { command } = parseCommand(text);
	if (!command) return null;
	const cmd = commands.get(command);
	if (!cmd) return null;
	const { args } = parseCommand(text);
	return cmd.handler(args, session, ctx);
}

// ── Built-in commands ───────────────────────────────────────────

registerCommand({
	name: "start",
	description: "Welcome message",
	handler: () =>
		"👋 Hi! I'm your Pi assistant.\n\n" +
		"Send me a message and I'll process it. Use /help to see available commands.",
});

registerCommand({
	name: "help",
	description: "Show available commands",
	handler: () => {
		const lines = getAllCommands().map((c) => `/${c.name} — ${c.description}`);
		return `**Available commands:**\n\n${lines.join("\n")}`;
	},
});

registerCommand({
	name: "abort",
	description: "Cancel the current prompt",
	handler: (_args, session, ctx) => {
		if (!session) return "No active session.";
		if (!session.processing) return "Nothing is running right now.";
		return ctx.abortCurrent(session.sender)
			? "⏹ Aborting current prompt..."
			: "Failed to abort — nothing running.";
	},
});

registerCommand({
	name: "status",
	description: "Show session info",
	handler: (_args, session, ctx) => {
		if (!session) return "No active session. Send a message to start one.";
		const persistent = ctx.isPersistent(session.sender);
		const uptime = Math.floor((Date.now() - session.startedAt) / 1000);
		const mins = Math.floor(uptime / 60);
		const secs = uptime % 60;
		return [
			`**Session Status**`,
			`- Mode: ${persistent ? "🔗 Persistent (conversation memory)" : "⚡ Stateless (no memory)"}`,
			`- State: ${session.processing ? "⏳ Processing..." : "💤 Idle"}`,
			`- Messages: ${session.messageCount}`,
			`- Queue: ${session.queue.length} pending`,
			`- Uptime: ${mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}`,
		].join("\n");
	},
});

registerCommand({
	name: "new",
	description: "Clear queue and start fresh conversation",
	handler: (_args, session, ctx) => {
		if (!session) return "No active session.";
		const persistent = ctx.isPersistent(session.sender);
		ctx.abortCurrent(session.sender);
		ctx.clearQueue(session.sender);
		ctx.resetSession(session.sender);
		return persistent
			? "🔄 Session reset. Conversation context cleared. Queue cleared."
			: "🔄 Session reset. Queue cleared.";
	},
});
