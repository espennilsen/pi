/**
 * pi-channels — Bot command handler.
 *
 * Detects messages starting with / and handles them:
 *   1. Built-in commands (start, help, abort, status, new)
 *   2. Registered pi slash commands (extension, skill, prompt)
 *   3. Unrecognized — fall through to agent
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
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
	/** Available pi slash commands for help display. */
	slashCommands?: SlashCommandInfo[];
}

/** Slash command info, mirrors pi's SlashCommandInfo but simplified for transport. */
export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
	sourceInfo: {
		path: string;
		baseDir?: string;
	};
}

/** Result of routing a slash command. */
export interface CommandRouteResult {
	action: "handled" | "error";
	/** For extension commands, the event name to emit. */
	eventName?: string;
	/** For skill/prompt commands, the expanded text to use as prompt. */
	expandedText?: string;
	/** Error message when action is "error". */
	errorMessage?: string;
	/** Parsed command name. */
	command: string;
	/** Parsed args string. */
	args: string;
}

const commands = new Map<string, BotCommand>();

export function isCommand(text: string): boolean {
	return /^\/[a-zA-Z]/.test(text.trim());
}

export function parseCommand(text: string): { command: string; args: string } {
	const match = text.trim().match(/^\/([a-zA-Z_-]+)(?:@\S+)?\s*(.*)/s);
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
 * Handle a built-in command. Returns reply text, or null if unrecognized
 * (fall through to slash command routing or agent).
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

/**
 * Route a slash command against pi's registered slash commands.
 * Returns the routing decision for the caller to act on.
 */
export async function routeSlashCommand(
	text: string,
	slashCommands: SlashCommandInfo[],
): Promise<CommandRouteResult | null> {
	const parsed = parseCommand(text);
	if (!parsed.command) return null;

	const cmd = slashCommands.find(c => c.name === parsed.command);
	if (!cmd) return null;

	if (cmd.source === "extension") {
		return {
			action: "handled",
			eventName: `command:${parsed.command}`,
			command: parsed.command,
			args: parsed.args,
		};
	}

	if (cmd.source === "skill") {
		const expandedText = await expandSkill(cmd.sourceInfo.path, parsed.args, cmd.sourceInfo.baseDir);
		if (expandedText) {
			return { action: "handled", expandedText, command: parsed.command, args: parsed.args };
		}
		return { action: "error", errorMessage: "Failed to load skill file.", command: parsed.command, args: parsed.args };
	}

	if (cmd.source === "prompt") {
		const expandedText = await expandPrompt(cmd.sourceInfo.path, parsed.args);
		if (expandedText) {
			return { action: "handled", expandedText, command: parsed.command, args: parsed.args };
		}
		return { action: "error", errorMessage: "Failed to expand prompt template.", command: parsed.command, args: parsed.args };
	}

	return null;
}

/** Try to expand a skill command by reading the SKILL.md file. */
async function expandSkill(skillPath: string, args: string, baseDir?: string): Promise<string | null> {
	try {
		let content = await fs.readFile(skillPath, "utf-8");
		// Strip YAML frontmatter
		const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/);
		if (fmMatch) content = content.slice(fmMatch[0].length);
		content = content.trim();
		if (!content) return null;
		const dir = baseDir ?? path.dirname(skillPath);
		const block = `<skill name="${skillPath}" location="${skillPath}">\nReferences are relative to ${dir}.\n\n${content}\n</skill>`;
		return args ? `${block}\n\n${args}` : block;
	} catch {
		return null;
	}
}

/** Try to expand a prompt command by reading the template file and substituting args. */
async function expandPrompt(promptPath: string, argsString: string): Promise<string | null> {
	try {
		let content = await fs.readFile(promptPath, "utf-8");
		// Strip YAML frontmatter
		const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/);
		if (fmMatch) content = content.slice(fmMatch[0].length);
		content = content.trim();
		if (!content) return null;

		// Parse bash-style args
		const args = parseCommandArgs(argsString);

		// Escape $$ → placeholder before substitution
		const DOLLAR_ESCAPE = "\u0001DOLLAR\u0001";
		content = content.replace(/\$\$/g, DOLLAR_ESCAPE);

		// Substitute $1, $@, $ARGUMENTS, ${@:N}, ${@:N:L}
		content = content.replace(/\$(\d+)/g, (_, num: string) => args[parseInt(num, 10) - 1] ?? "");
		content = content.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startStr: string, lengthStr?: string) => {
			let start = parseInt(startStr, 10) - 1;
			if (start < 0) start = 0;
			if (lengthStr) return args.slice(start, start + parseInt(lengthStr, 10)).join(" ");
			return args.slice(start).join(" ");
		});
		const allArgs = args.join(" ");
		content = content.replace(/\$ARGUMENTS/g, allArgs);
		content = content.replace(/\$@/g, allArgs);

		// Restore escaped $
		content = content.replace(new RegExp(DOLLAR_ESCAPE, "g"), "$");

		return content;
	} catch {
		return null;
	}
}

/** Bash-style argument parsing — respects quoted strings. */
function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;
	let tokenStarted = false;
	for (let i = 0; i < argsString.length; i++) {
		const char = argsString[i];
		if (inQuote) {
			if (char === inQuote) inQuote = null;
			else current += char;
		} else if (char === '"' || char === "'") {
			inQuote = char;
			tokenStarted = true;
		} else if (char === " " || char === "\t") {
			if (tokenStarted) { args.push(current); current = ""; tokenStarted = false; }
		} else {
			current += char;
			tokenStarted = true;
		}
	}
	if (inQuote) throw new Error(`Unterminated quote '${inQuote}'`);
	if (tokenStarted) args.push(current);
	return args;
}

// ── Built-in commands ───────────────────────────────────────────

registerCommand({
	name: "start",
	description: "Welcome message",
	handler: () =>
		"👋 Hi! I'm your Pi assistant.\n\n" +
		"Send me a message and I'll process it. Use /help to see available commands.\n" +
		"You can also use any /command registered in pi (e.g. /model, /workon).",
});

registerCommand({
	name: "help",
	description: "Show available commands",
	handler: (_args, _session, ctx) => {
		const lines = getAllCommands().map((c) => `/${c.name} — ${c.description}`);
		const builtIn = lines.length > 0
			? `**Built-in:**\n${lines.join("\n")}`
			: "";

		const slashLines = (ctx.slashCommands ?? [])
			.map(c => `/${c.name}${c.description ? ` — ${c.description}` : ""}`);
		const slashSection = slashLines.length > 0
			? `\n**Slash commands:**\n${slashLines.join("\n")}`
			: "";

		const parts = [builtIn, slashSection].filter(Boolean);
		if (parts.length > 0) parts.push("");
		parts.push(`Type / followed by any pi slash command (e.g. /model, /workon).`);
		return parts.join("\n");
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
