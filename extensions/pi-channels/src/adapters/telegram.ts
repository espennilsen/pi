/**
 * pi-channels — Built-in Telegram adapter (bidirectional).
 *
 * Outgoing: Telegram Bot API sendMessage.
 * Incoming: Long-polling via getUpdates.
 *
 * Supports:
 *   - Text messages
 *   - Photos (downloaded → temp file → passed as image attachment)
 *   - Documents (text files downloaded → content included in message)
 *   - File size validation (max 1MB)
 *   - MIME type filtering (text-like files only for documents)
 *
 * Config:
 * {
 *   "type": "telegram",
 *   "botToken": "env:TELEGRAM_BOT_TOKEN",
 *   "parseMode": "Markdown",
 *   "polling": true,
 *   "pollingTimeout": 30,
 *   "allowedChatIds": ["123456789", "-100987654321"]
 * }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
	ChannelAdapter,
	ChannelMessage,
	AdapterConfig,
	OnIncomingMessage,
	IncomingMessage,
	IncomingAttachment,
} from "../types.ts";

const MAX_LENGTH = 4096;
const MAX_FILE_SIZE = 1_048_576; // 1MB

/** MIME types we treat as text documents (content inlined into the prompt). */
const TEXT_MIME_TYPES = new Set([
	"text/plain",
	"text/markdown",
	"text/csv",
	"text/html",
	"text/xml",
	"text/css",
	"text/javascript",
	"application/json",
	"application/xml",
	"application/javascript",
	"application/typescript",
	"application/x-yaml",
	"application/x-toml",
	"application/x-sh",
]);

/** File extensions we treat as text even if MIME is generic (application/octet-stream). */
const TEXT_EXTENSIONS = new Set([
	".md", ".markdown", ".txt", ".csv", ".json", ".jsonl", ".yaml", ".yml",
	".toml", ".xml", ".html", ".htm", ".css", ".js", ".ts", ".tsx", ".jsx",
	".py", ".rs", ".go", ".rb", ".php", ".java", ".kt", ".c", ".cpp", ".h",
	".sh", ".bash", ".zsh", ".fish", ".sql", ".graphql", ".gql",
	".env", ".ini", ".cfg", ".conf", ".properties", ".log",
	".gitignore", ".dockerignore", ".editorconfig",
]);

/** Image MIME prefixes. */
function isImageMime(mime: string | undefined): boolean {
	if (!mime) return false;
	return mime.startsWith("image/");
}

function isTextDocument(mimeType: string | undefined, filename: string | undefined): boolean {
	if (mimeType && TEXT_MIME_TYPES.has(mimeType)) return true;
	if (filename) {
		const ext = path.extname(filename).toLowerCase();
		if (TEXT_EXTENSIONS.has(ext)) return true;
	}
	return false;
}

export function createTelegramAdapter(config: AdapterConfig): ChannelAdapter {
	const botToken = config.botToken as string;
	const parseMode = config.parseMode as string | undefined;
	const pollingEnabled = config.polling === true;
	const pollingTimeout = (config.pollingTimeout as number) ?? 30;
	const allowedChatIds = config.allowedChatIds as string[] | undefined;

	if (!botToken) {
		throw new Error("Telegram adapter requires botToken");
	}

	const apiBase = `https://api.telegram.org/bot${botToken}`;
	let offset = 0;
	let running = false;
	let abortController: AbortController | null = null;

	// Track temp files for cleanup
	const tempFiles: string[] = [];

	// ── Telegram API helpers ────────────────────────────────

	async function sendTelegram(chatId: string, text: string): Promise<void> {
		const body: Record<string, unknown> = { chat_id: chatId, text };
		if (parseMode) body.parse_mode = parseMode;

		const res = await fetch(`${apiBase}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const err = await res.text().catch(() => "unknown error");
			throw new Error(`Telegram API error ${res.status}: ${err}`);
		}
	}

	async function sendChatAction(chatId: string, action = "typing"): Promise<void> {
		try {
			await fetch(`${apiBase}/sendChatAction`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: chatId, action }),
			});
		} catch {
			// Best-effort
		}
	}

	/**
	 * Download a file from Telegram by file_id.
	 * Returns { path, size } or null on failure.
	 */
	async function downloadFile(fileId: string, suggestedName?: string): Promise<{ localPath: string; size: number } | null> {
		try {
			// Get file info
			const infoRes = await fetch(`${apiBase}/getFile?file_id=${fileId}`);
			if (!infoRes.ok) return null;

			const info = await infoRes.json() as {
				ok: boolean;
				result?: { file_id: string; file_size?: number; file_path?: string };
			};
			if (!info.ok || !info.result?.file_path) return null;

			const fileSize = info.result.file_size ?? 0;

			// Size check before downloading
			if (fileSize > MAX_FILE_SIZE) return null;

			// Download
			const fileUrl = `https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`;
			const fileRes = await fetch(fileUrl);
			if (!fileRes.ok) return null;

			const buffer = Buffer.from(await fileRes.arrayBuffer());

			// Double-check size after download
			if (buffer.length > MAX_FILE_SIZE) return null;

			// Write to temp file
			const ext = path.extname(info.result.file_path) || path.extname(suggestedName || "") || "";
			const tmpDir = path.join(os.tmpdir(), "pi-channels");
			fs.mkdirSync(tmpDir, { recursive: true });
			const localPath = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
			fs.writeFileSync(localPath, buffer);
			tempFiles.push(localPath);

			return { localPath, size: buffer.length };
		} catch {
			return null;
		}
	}

	// ── Message building helpers ────────────────────────────

	function buildBaseMetadata(msg: TelegramMessage): Record<string, unknown> {
		return {
			messageId: msg.message_id,
			chatType: msg.chat.type,
			chatTitle: msg.chat.title,
			userId: msg.from?.id,
			username: msg.from?.username,
			firstName: msg.from?.first_name,
			date: msg.date,
		};
	}

	// ── Incoming (long polling) ─────────────────────────────

	async function poll(onMessage: OnIncomingMessage): Promise<void> {
		while (running) {
			try {
				abortController = new AbortController();
				const url = `${apiBase}/getUpdates?offset=${offset}&timeout=${pollingTimeout}&allowed_updates=["message"]`;
				const res = await fetch(url, {
					signal: abortController.signal,
				});

				if (!res.ok) {
					await sleep(5000);
					continue;
				}

				const data = await res.json() as {
					ok: boolean;
					result: Array<{ update_id: number; message?: TelegramMessage }>;
				};

				if (!data.ok || !data.result?.length) continue;

				for (const update of data.result) {
					offset = update.update_id + 1;
					const msg = update.message;
					if (!msg) continue;

					const chatId = String(msg.chat.id);
					if (allowedChatIds && !allowedChatIds.includes(chatId)) continue;

					const incoming = await processMessage(msg, chatId);
					if (incoming) onMessage(incoming);
				}
			} catch (err: any) {
				if (err.name === "AbortError") break;
				if (running) await sleep(5000);
			}
		}
	}

	/**
	 * Process a single Telegram message into an IncomingMessage.
	 * Handles text, photos, and documents.
	 */
	async function processMessage(msg: TelegramMessage, chatId: string): Promise<IncomingMessage | null> {
		const metadata = buildBaseMetadata(msg);
		const caption = msg.caption || "";

		// ── Photo ──────────────────────────────────────────
		if (msg.photo && msg.photo.length > 0) {
			// Pick the largest photo (last in array)
			const largest = msg.photo[msg.photo.length - 1];

			// Size check
			if (largest.file_size && largest.file_size > MAX_FILE_SIZE) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: "⚠️ Photo too large (max 1MB).",
					metadata: { ...metadata, rejected: true },
				};
			}

			const downloaded = await downloadFile(largest.file_id, "photo.jpg");
			if (!downloaded) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: caption || "📷 (photo — failed to download)",
					metadata,
				};
			}

			const attachment: IncomingAttachment = {
				type: "image",
				path: downloaded.localPath,
				filename: "photo.jpg",
				mimeType: "image/jpeg",
				size: downloaded.size,
			};

			return {
				adapter: "telegram",
				sender: chatId,
				text: caption || "Describe this image.",
				attachments: [attachment],
				metadata: { ...metadata, hasPhoto: true },
			};
		}

		// ── Document ───────────────────────────────────────
		if (msg.document) {
			const doc = msg.document;
			const mimeType = doc.mime_type;
			const filename = doc.file_name;

			// Size check
			if (doc.file_size && doc.file_size > MAX_FILE_SIZE) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `⚠️ File too large: ${filename || "document"} (${formatSize(doc.file_size)}, max 1MB).`,
					metadata: { ...metadata, rejected: true },
				};
			}

			// Image documents (e.g. uncompressed photos sent as files)
			if (isImageMime(mimeType)) {
				const downloaded = await downloadFile(doc.file_id, filename);
				if (!downloaded) {
					return {
						adapter: "telegram",
						sender: chatId,
						text: caption || `📎 ${filename || "image"} (failed to download)`,
						metadata,
					};
				}

				const ext = path.extname(filename || "").toLowerCase();
				const attachment: IncomingAttachment = {
					type: "image",
					path: downloaded.localPath,
					filename: filename || "image",
					mimeType: mimeType || "image/jpeg",
					size: downloaded.size,
				};

				return {
					adapter: "telegram",
					sender: chatId,
					text: caption || "Describe this image.",
					attachments: [attachment],
					metadata: { ...metadata, hasDocument: true, documentType: "image" },
				};
			}

			// Text documents — download and inline content
			if (isTextDocument(mimeType, filename)) {
				const downloaded = await downloadFile(doc.file_id, filename);
				if (!downloaded) {
					return {
						adapter: "telegram",
						sender: chatId,
						text: caption || `📎 ${filename || "document"} (failed to download)`,
						metadata,
					};
				}

				const attachment: IncomingAttachment = {
					type: "document",
					path: downloaded.localPath,
					filename: filename || "document",
					mimeType: mimeType || "text/plain",
					size: downloaded.size,
				};

				return {
					adapter: "telegram",
					sender: chatId,
					text: caption || `Here is the file ${filename || "document"}.`,
					attachments: [attachment],
					metadata: { ...metadata, hasDocument: true, documentType: "text" },
				};
			}

			// Unsupported file type
			return {
				adapter: "telegram",
				sender: chatId,
				text: `⚠️ Unsupported file type: ${filename || "document"} (${mimeType || "unknown"}). I can handle text files and images.`,
				metadata: { ...metadata, rejected: true },
			};
		}

		// ── Text ───────────────────────────────────────────
		if (msg.text) {
			return {
				adapter: "telegram",
				sender: chatId,
				text: msg.text,
				metadata,
			};
		}

		// Unsupported message type (sticker, voice, etc.) — ignore
		return null;
	}

	// ── Cleanup ─────────────────────────────────────────────

	function cleanupTempFiles(): void {
		for (const f of tempFiles) {
			try { fs.unlinkSync(f); } catch { /* ignore */ }
		}
		tempFiles.length = 0;
	}

	// ── Adapter ─────────────────────────────────────────────

	return {
		direction: "bidirectional" as const,

		async sendTyping(recipient: string): Promise<void> {
			await sendChatAction(recipient, "typing");
		},

		async send(message: ChannelMessage): Promise<void> {
			const prefix = message.source ? `[${message.source}]\n` : "";
			const full = prefix + message.text;

			if (full.length <= MAX_LENGTH) {
				await sendTelegram(message.recipient, full);
				return;
			}

			// Split long messages at newlines
			let remaining = full;
			while (remaining.length > 0) {
				if (remaining.length <= MAX_LENGTH) {
					await sendTelegram(message.recipient, remaining);
					break;
				}
				let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
				if (splitAt < MAX_LENGTH / 2) splitAt = MAX_LENGTH;
				await sendTelegram(message.recipient, remaining.slice(0, splitAt));
				remaining = remaining.slice(splitAt).replace(/^\n/, "");
			}
		},

		async start(onMessage: OnIncomingMessage): Promise<void> {
			if (!pollingEnabled) return;
			if (running) return;
			running = true;
			poll(onMessage);
		},

		async stop(): Promise<void> {
			running = false;
			abortController?.abort();
			abortController = null;
			cleanupTempFiles();
		},
	};
}

// ── Telegram API types (subset) ─────────────────────────────────

interface TelegramMessage {
	message_id: number;
	from?: { id: number; username?: string; first_name?: string };
	chat: { id: number; type: string; title?: string };
	date: number;
	text?: string;
	caption?: string;
	photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
	document?: {
		file_id: string;
		file_unique_id: string;
		file_name?: string;
		mime_type?: string;
		file_size?: number;
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / 1_048_576).toFixed(1)}MB`;
}
