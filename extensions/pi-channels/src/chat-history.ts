/**
 * Chat History Handler for pi-channels
 * Speichert Telegram-Chats pro Person im Vault als Markdown
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage } from "../types.ts";

export interface ChatMessage {
	timestamp: string;
	role: "user" | "assistant";
	content: string;
	attachments?: Array<{
		filename: string;
		path: string;
		type: string;
	}>;
}

export interface ChatSession {
	person: string;
	senderId: string;
	adapter: string;
	messages: ChatMessage[];
}

const MAX_CONTEXT_MESSAGES = 10;
const VAULT_PATH = "/Users/luxus/projects/jadorey";
const HISTORY_DIR = path.join(VAULT_PATH, "Chat_History");

// Personen-Mapping (für lesbare Dateinamen)
const PERSON_MAP: Record<string, string> = {
	"14939216": "Yvonne Mauss",
	// Weitere Personen hier hinzufügen
};

/**
 * Speichert eine eingehende Nachricht in der Chat-History
 */
export function saveIncomingMessage(message: IncomingMessage): void {
	const senderId = message.sender;
	const personName = PERSON_MAP[senderId] || `Unknown_${senderId}`;
	
	// Ensure directory exists
	if (!fs.existsSync(HISTORY_DIR)) {
		fs.mkdirSync(HISTORY_DIR, { recursive: true });
	}
	
	const filePath = path.join(HISTORY_DIR, `Telegram_${personName}.md`);
	
	// Read existing or create new
	let session: ChatSession;
	if (fs.existsSync(filePath)) {
		session = parseChatFile(fs.readFileSync(filePath, "utf-8"), personName, senderId, message.adapter);
	} else {
		session = {
			person: personName,
			senderId,
			adapter: message.adapter,
			messages: [],
		};
	}
	
	// Add new message
	const attachments = message.attachments?.map(att => ({
		filename: att.filename || path.basename(att.path),
		path: att.path,
		type: att.type,
	}));
	
	session.messages.push({
		timestamp: new Date().toISOString(),
		role: "user",
		content: message.text || "",
		attachments: attachments?.length ? attachments : undefined,
	});
	
	// Write back
	fs.writeFileSync(filePath, serializeChatFile(session));
}

/**
 * Speichert eine Antwort vom Agenten
 */
export function saveAssistantResponse(senderId: string, response: string): void {
	const personName = PERSON_MAP[senderId] || `Unknown_${senderId}`;
	const filePath = path.join(HISTORY_DIR, `Telegram_${personName}.md`);
	
	if (!fs.existsSync(filePath)) return;
	
	const content = fs.readFileSync(filePath, "utf-8");
	const session = parseChatFile(content, personName, senderId, "telegram");
	
	session.messages.push({
		timestamp: new Date().toISOString(),
		role: "assistant",
		content: response,
	});
	
	fs.writeFileSync(filePath, serializeChatFile(session));
}

/**
 * Holt die letzten N Nachrichten als Kontext
 */
export function getRecentContext(senderId: string, count = MAX_CONTEXT_MESSAGES): ChatMessage[] {
	const personName = PERSON_MAP[senderId] || `Unknown_${senderId}`;
	const filePath = path.join(HISTORY_DIR, `Telegram_${personName}.md`);
	
	if (!fs.existsSync(filePath)) return [];
	
	const content = fs.readFileSync(filePath, "utf-8");
	const session = parseChatFile(content, personName, senderId, "telegram");
	
	// Return last N messages
	return session.messages.slice(-count);
}

/**
 * Formatiert Kontext für den Agenten-Prompt
 */
export function formatContextForPrompt(messages: ChatMessage[]): string {
	if (messages.length === 0) return "";
	
	const lines = ["\n--- Vorheriger Chat-Verlauf ---\n"];
	
	for (const msg of messages) {
		const time = new Date(msg.timestamp).toLocaleTimeString("de-DE", {
			hour: "2-digit",
			minute: "2-digit",
		});
		
		if (msg.role === "user") {
			lines.push(`[${time}] Yvonne: ${msg.content}`);
			if (msg.attachments) {
				for (const att of msg.attachments) {
					lines.push(`  📎 ${att.filename} (${att.type})`);
				}
			}
		} else {
			// Assistant message - truncate if too long
			const shortContent = msg.content.slice(0, 200) + (msg.content.length > 200 ? "..." : "");
			lines.push(`[${time}] Assistant: ${shortContent}`);
		}
	}
	
	lines.push("\n--- Ende Chat-Verlauf ---\n");
	return lines.join("\n");
}

// Helper: Parse markdown file to ChatSession
function parseChatFile(content: string, person: string, senderId: string, adapter: string): ChatSession {
	const session: ChatSession = {
		person,
		senderId,
		adapter,
		messages: [],
	};
	
	// Simple parsing - in production use a proper YAML/Markdown parser
	const lines = content.split("\n");
	let inFrontmatter = false;
	let currentMessage: Partial<ChatMessage> | null = null;
	
	for (const line of lines) {
		if (line === "---") {
			inFrontmatter = !inFrontmatter;
			continue;
		}
		
		if (inFrontmatter) continue;
		
		// Parse message entries
		const match = line.match(/^### (\d{2}:\d{2}:\d{2}) - (\w+)\s*$/);
		if (match) {
			if (currentMessage?.content) {
				session.messages.push(currentMessage as ChatMessage);
			}
			currentMessage = {
				timestamp: new Date().toISOString(), // Would parse from context
				role: match[2] === "Yvonne" ? "user" : "assistant",
				content: "",
			};
			continue;
		}
		
		// Parse content lines
		if (line.startsWith("> ") && currentMessage) {
			currentMessage.content = line.slice(2);
		}
	}
	
	if (currentMessage?.content) {
		session.messages.push(currentMessage as ChatMessage);
	}
	
	return session;
}

// Helper: Serialize ChatSession to markdown
function serializeChatFile(session: ChatSession): string {
	const lines: string[] = [];
	
	// Frontmatter
	lines.push("---");
	lines.push(`person: "${session.person}"`);
	lines.push(`sender_id: "${session.senderId}"`);
	lines.push(`adapter: "${session.adapter}"`);
	lines.push(`message_count: ${session.messages.length}`);
	lines.push(`last_update: "${new Date().toISOString()}"`);
	lines.push("---");
	lines.push("");
	
	// Group by date
	const byDate = new Map<string, ChatMessage[]>();
	for (const msg of session.messages) {
		const date = msg.timestamp.split("T")[0];
		if (!byDate.has(date)) byDate.set(date, []);
		byDate.get(date)!.push(msg);
	}
	
	// Write messages
	for (const [date, msgs] of byDate) {
		lines.push(`## ${date}`);
		lines.push("");
		
		for (const msg of msgs) {
			const time = new Date(msg.timestamp).toLocaleTimeString("de-DE", {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
			
			const sender = msg.role === "user" ? "Yvonne" : "Jadorey (Assistant)";
			lines.push(`### ${time} - ${sender}`);
			
			if (msg.content) {
				lines.push(`> ${msg.content}`);
			}
			
			if (msg.attachments) {
				for (const att of msg.attachments) {
					lines.push(`📎 [${att.filename}](attachments/${att.filename.replace(/\s+/g, "_")})`);
				}
			}
			
			lines.push("");
		}
	}
	
	return lines.join("\n");
}
