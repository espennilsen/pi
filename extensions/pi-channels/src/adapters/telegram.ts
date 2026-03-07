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
 *   - Voice messages (downloaded → transcribed → passed as text)
 *   - Audio files (music/recordings → transcribed → passed as text)
 *   - Audio documents (files with audio MIME → routed through transcription)
 *   - File size validation (1MB for docs/photos, 10MB for voice/audio)
 *   - MIME type filtering (text-like files only for documents)
 *
 * Config (in settings.json under pi-channels.adapters.telegram):
 * {
 *   "type": "telegram",
 *   "botToken": "your-telegram-bot-token",
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
	TranscriptionConfig,
} from "../types.ts";
import type { AdapterFactoryContext } from "../registry.ts";
import { createTranscriptionProvider, type TranscriptionProvider } from "./transcription.ts";

const MAX_LENGTH = 4096;
const MAX_FILE_SIZE = 1_048_576; // 1MB
const MAX_AUDIO_SIZE = 10_485_760; // 10MB — voice/audio files are larger

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

/** Audio MIME types that can be transcribed. */
const AUDIO_MIME_PREFIXES = ["audio/"];
const AUDIO_MIME_TYPES = new Set([
	"audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm",
	"audio/x-m4a", "audio/flac", "audio/aac", "audio/mp3",
	"video/ogg", // .ogg containers can be audio-only
]);

function isAudioMime(mime: string | undefined): boolean {
	if (!mime) return false;
	if (AUDIO_MIME_TYPES.has(mime)) return true;
	return AUDIO_MIME_PREFIXES.some(p => mime.startsWith(p));
}

function isTextDocument(mimeType: string | undefined, filename: string | undefined): boolean {
	if (mimeType && TEXT_MIME_TYPES.has(mimeType)) return true;
	if (filename) {
		const ext = path.extname(filename).toLowerCase();
		if (TEXT_EXTENSIONS.has(ext)) return true;
	}
	return false;
}

export async function createTelegramAdapter(config: AdapterConfig, context: AdapterFactoryContext): Promise<ChannelAdapter> {
	const botToken = config.botToken as string;
	const parseMode = config.parseMode as string | undefined;
	const pollingEnabled = config.polling === true;
	const pollingTimeout = (config.pollingTimeout as number) ?? 30;
	const allowedChatIds = config.allowedChatIds as string[] | undefined;

	if (!botToken) {
		throw new Error("Telegram adapter requires botToken");
	}

	// ── Transcription setup ─────────────────────────────────
	const transcriptionConfig = config.transcription as TranscriptionConfig | undefined;
	let transcriber: TranscriptionProvider | null = null;
	let transcriberError: string | null = null;
	if (transcriptionConfig?.enabled) {
		try {
			transcriber = await createTranscriptionProvider(transcriptionConfig, context.modelRegistry);
		} catch (err: any) {
			transcriberError = err.message ?? "Unknown transcription config error";
			console.error(`[pi-channels] Transcription config error: ${transcriberError}`);
		}
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
	async function downloadFile(fileId: string, suggestedName?: string, maxSize = MAX_FILE_SIZE): Promise<{ localPath: string; size: number } | null> {
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
			if (fileSize > maxSize) return null;

			// Download
			const fileUrl = `https://api.telegram.org/file/bot${botToken}/${info.result.file_path}`;
			const fileRes = await fetch(fileUrl);
			if (!fileRes.ok) return null;

			const buffer = Buffer.from(await fileRes.arrayBuffer());

			// Double-check size after download
			if (buffer.length > maxSize) return null;

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

			// Audio documents — route through transcription
			if (isAudioMime(mimeType)) {
				if (!transcriber) {
					return {
						adapter: "telegram",
						sender: chatId,
						text: transcriberError
							? `⚠️ Audio transcription misconfigured: ${transcriberError}`
							: `⚠️ Audio files are not supported. Please type your message.`,
						metadata: { ...metadata, rejected: true, hasAudio: true },
					};
				}

				if (doc.file_size && doc.file_size > MAX_AUDIO_SIZE) {
					return {
						adapter: "telegram",
						sender: chatId,
						text: `⚠️ Audio file too large: ${filename || "audio"} (${formatSize(doc.file_size)}, max 10MB).`,
						metadata: { ...metadata, rejected: true, hasAudio: true },
					};
				}

				const downloaded = await downloadFile(doc.file_id, filename, MAX_AUDIO_SIZE);
				if (!downloaded) {
					return {
						adapter: "telegram",
						sender: chatId,
						text: caption || `🎵 ${filename || "audio"} (failed to download)`,
						metadata: { ...metadata, hasAudio: true },
					};
				}

				const result = await transcriber.transcribe(downloaded.localPath);
				if (!result.ok || !result.text) {
					return {
						adapter: "telegram",
						sender: chatId,
						text: `🎵 ${filename || "audio"} (transcription failed${result.error ? ": " + result.error : ""})`,
						metadata: { ...metadata, hasAudio: true },
					};
				}

				const label = filename ? `Audio: ${filename}` : "Audio file";
				return {
					adapter: "telegram",
					sender: chatId,
					text: `🎵 [${label}]: ${result.text}`,
					metadata: { ...metadata, hasAudio: true, audioTitle: filename },
				};
			}

			// Unsupported file type
			return {
				adapter: "telegram",
				sender: chatId,
				text: `⚠️ Unsupported file type: ${filename || "document"} (${mimeType || "unknown"}). I can handle text files, images, and audio.`,
				metadata: { ...metadata, rejected: true },
			};
		}

		// ── Voice message ──────────────────────────────────
		if (msg.voice) {
			const voice = msg.voice;

			if (!transcriber) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: transcriberError
						? `⚠️ Voice transcription misconfigured: ${transcriberError}`
						: "⚠️ Voice messages are not supported. Please type your message.",
					metadata: { ...metadata, rejected: true, hasVoice: true },
				};
			}

			// Size check
			if (voice.file_size && voice.file_size > MAX_AUDIO_SIZE) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `⚠️ Voice message too large (${formatSize(voice.file_size)}, max 10MB).`,
					metadata: { ...metadata, rejected: true, hasVoice: true },
				};
			}

			const downloaded = await downloadFile(voice.file_id, "voice.ogg", MAX_AUDIO_SIZE);
			if (!downloaded) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: "🎤 (voice message — failed to download)",
					metadata: { ...metadata, hasVoice: true },
				};
			}

			const result = await transcriber.transcribe(downloaded.localPath);
			if (!result.ok || !result.text) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `🎤 (voice message — transcription failed${result.error ? ": " + result.error : ""})`,
					metadata: { ...metadata, hasVoice: true, voiceDuration: voice.duration },
				};
			}

			return {
				adapter: "telegram",
				sender: chatId,
				text: `🎤 [Voice message]: ${result.text}`,
				metadata: { ...metadata, hasVoice: true, voiceDuration: voice.duration },
			};
		}

		// ── Audio file (sent as music) ─────────────────────
		if (msg.audio) {
			const audio = msg.audio;

			if (!transcriber) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: transcriberError
						? `⚠️ Audio transcription misconfigured: ${transcriberError}`
						: "⚠️ Audio files are not supported. Please type your message.",
					metadata: { ...metadata, rejected: true, hasAudio: true },
				};
			}

			if (audio.file_size && audio.file_size > MAX_AUDIO_SIZE) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `⚠️ Audio too large (${formatSize(audio.file_size)}, max 10MB).`,
					metadata: { ...metadata, rejected: true, hasAudio: true },
				};
			}

			const audioName = audio.title || audio.performer || "audio";
			const downloaded = await downloadFile(audio.file_id, `${audioName}.mp3`, MAX_AUDIO_SIZE);
			if (!downloaded) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: caption || `🎵 ${audioName} (failed to download)`,
					metadata: { ...metadata, hasAudio: true },
				};
			}

			const result = await transcriber.transcribe(downloaded.localPath);
			if (!result.ok || !result.text) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `🎵 ${audioName} (transcription failed${result.error ? ": " + result.error : ""})`,
					metadata: { ...metadata, hasAudio: true, audioTitle: audio.title, audioDuration: audio.duration },
				};
			}

			const label = audio.title
				? `Audio: ${audio.title}${audio.performer ? ` by ${audio.performer}` : ""}`
				: "Audio";
			return {
				adapter: "telegram",
				sender: chatId,
				text: `🎵 [${label}]: ${result.text}`,
				metadata: { ...metadata, hasAudio: true, audioTitle: audio.title, audioDuration: audio.duration },
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

		// Unsupported message type (sticker, video, etc.) — ignore
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
			if (!message.text) {
				throw new Error("Telegram adapter requires text");
			}
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

		async syncBotCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
			try {
				const res = await fetch(`${apiBase}/setMyCommands`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ commands }),
				});
				if (!res.ok) {
					const err = await res.text().catch(() => "unknown error");
					console.error(`[pi-channels] Failed to sync bot commands: ${res.status} ${err}`);
				}
			} catch (err: any) {
				console.error(`[pi-channels] Failed to sync bot commands: ${err.message}`);
			}
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
	voice?: {
		file_id: string;
		file_unique_id: string;
		duration: number;
		mime_type?: string;
		file_size?: number;
	};
	audio?: {
		file_id: string;
		file_unique_id: string;
		duration: number;
		performer?: string;
		title?: string;
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
