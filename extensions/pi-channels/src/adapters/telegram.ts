/**
 * pi-channels — Built-in Telegram adapter (bidirectional).
 *
 * Outgoing: Telegram Bot API sendMessage / sendDocument.
 * Incoming: Long-polling via getUpdates.
 *
 * Supports:
 *   - Text messages
 *   - Photos (downloaded → temp file → passed as image attachment)
 *   - Documents (text files downloaded → content included in message)
 *   - Voice messages (downloaded → transcribed → passed as text, or saved as file when fileUpload enabled)
 *   - Audio files (music/recordings → transcribed → passed as text, or saved as file when fileUpload enabled)
 *   - Video files (downloaded → saved as file when fileUpload enabled)
 *   - Any file type (downloaded → saved as file when fileUpload enabled)
 *   - File size validation (configurable per-type)
 *   - MIME type filtering (text-like files only for documents)
 *   - sendFile for outgoing file attachments (sendDocument / sendPhoto / sendAudio / sendVideo)
 *
 * Config (in settings.json under pi-channels.adapters.telegram):
 * {
 *   "type": "telegram",
 *   "botToken": "your-telegram-bot-token",
 *   "parseMode": "Markdown",
 *   "polling": true,
 *   "pollingTimeout": 30,
 *   "allowedChatIds": ["123456789", "-100987654321"],
 *   "fileUpload": {
 *     "enabled": true,
 *     "maxSize": 52428800
 *   }
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
	FileUploadConfig,
} from "../types.ts";
import type { AdapterFactoryContext } from "../registry.ts";
import { createTranscriptionProvider, type TranscriptionProvider } from "./transcription.ts";

const MAX_LENGTH = 4096;
const MAX_FILE_SIZE = 1_048_576; // 1MB
const MAX_AUDIO_SIZE = 10_485_760; // 10MB — voice/audio files are larger
const MAX_FILE_UPLOAD_SIZE = 52_428_800; // 50MB — Telegram Bot API limit for sendDocument
const TELEGRAM_DOWNLOAD_LIMIT = 20_971_520; // 20MB — Telegram Bot API download limit

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

/** Video MIME prefixes. */
function isVideoMime(mime: string | undefined): boolean {
	if (!mime) return false;
	return mime.startsWith("video/");
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

	// ── File upload config ──────────────────────────────────
	const fileUploadConfig = config.fileUpload as FileUploadConfig | undefined;
	const fileUploadEnabled = fileUploadConfig?.enabled === true;
	const fileUploadMaxSize = (fileUploadConfig?.maxSize as number) ?? 52_428_800; // 50MB default

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
		// Messages are pre-formatted by format.ts as Telegram HTML — hardcode HTML
		body.parse_mode = "HTML";

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
	 * Send a file to a Telegram chat using the appropriate Bot API method.
	 * Uses sendDocument for generic files, sendPhoto for images, sendAudio for audio,
	 * sendVideo for video.
	 */
	async function sendTelegramFile(chatId: string, filePath: string, fileName?: string, caption?: string): Promise<void> {
		if (!fs.existsSync(filePath)) {
			throw new Error(`File not found: ${filePath}`);
		}

		const stat = fs.statSync(filePath);
		if (stat.size > MAX_FILE_UPLOAD_SIZE) {
			throw new Error(`File too large: ${formatSize(stat.size)} (max ${formatSize(MAX_FILE_UPLOAD_SIZE)})`);
		}

		const ext = path.extname(filePath).toLowerCase();
		const resolvedName = fileName || path.basename(filePath);
		const mimeType = guessMimeType(filePath);

		// Pick the best API method based on file type
		let method: string;
		let fileField = "document";
		if (isImageMime(mimeType) && [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
			method = "sendPhoto";
			fileField = "photo";
		} else if (isAudioMime(mimeType) || [".mp3", ".ogg", ".wav", ".m4a", ".flac"].includes(ext)) {
			method = "sendAudio";
			fileField = "audio";
		} else if (isVideoMime(mimeType) || [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext)) {
			method = "sendVideo";
			fileField = "video";
		} else {
			method = "sendDocument";
		}

		const fileBuffer = await fs.promises.readFile(filePath);
		const blob = new Blob([fileBuffer]);

		const form = new FormData();
		form.append(fileField, blob, resolvedName);
		form.append("chat_id", chatId);
		if (caption) form.append("caption", caption);
		if (parseMode && caption) form.append("parse_mode", parseMode);

		const res = await fetch(`${apiBase}/${method}`, {
			method: "POST",
			body: form,
		});

		if (!res.ok) {
			const err = await res.text().catch(() => "unknown error");
			throw new Error(`Telegram API error ${res.status}: ${err}`);
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

	/**
	 * Save an uploaded file to temp and create a file-type IncomingMessage
	 * for the LLM to access directly.
	 */
	function buildFileUploadMessage(
		chatId: string,
		caption: string,
		downloaded: { localPath: string; size: number },
		filename: string,
		mimeType: string | undefined,
		extraMetadata: Record<string, unknown>,
	): IncomingMessage {
		const attachment: IncomingAttachment = {
			type: "file",
			path: downloaded.localPath,
			filename,
			mimeType: mimeType || "application/octet-stream",
			size: downloaded.size,
		};

		return {
			adapter: "telegram",
			sender: chatId,
			text: caption || `📎 File uploaded: ${filename} (${formatSize(downloaded.size)}). The file is saved at: ${downloaded.localPath}`,
			attachments: [attachment],
			metadata: { ...extraMetadata, hasFile: true },
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
	 * Process audio/voice through transcription, with fileUpload fallback.
	 * Returns a transcribed IncomingMessage, or falls back to file upload if fileUpload is enabled.
	 */
	async function processAudioWithFallback(
		chatId: string,
		caption: string,
		metadata: Record<string, unknown>,
		fileId: string,
		suggestedName: string,
		maxSize: number,
		audioLabel: string,
		extraMetadata: Record<string, unknown>,
	): Promise<IncomingMessage> {
		// Try transcription first if available
		if (transcriber) {
			const downloaded = await downloadFile(fileId, suggestedName, maxSize);
			if (!downloaded) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: caption || `${audioLabel} (failed to download)`,
					metadata: { ...metadata, ...extraMetadata },
				};
			}

			const result = await transcriber.transcribe(downloaded.localPath);
			if (result.ok && result.text) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `${audioLabel}: ${result.text}`,
					metadata: { ...metadata, ...extraMetadata },
				};
			}

			// Transcription failed — fall back to file upload if enabled
			if (fileUploadEnabled) {
				return buildFileUploadMessage(chatId, caption, downloaded, suggestedName, undefined, { ...metadata, ...extraMetadata });
			}

			// No fallback
			return {
				adapter: "telegram",
				sender: chatId,
				text: `${audioLabel} (transcription failed${result.error ? ": " + result.error : ""})`,
				metadata: { ...metadata, ...extraMetadata },
			};
		}

		// No transcriber — use file upload if enabled
		if (fileUploadEnabled) {
			const downloaded = await downloadFile(fileId, suggestedName, maxSize);
			if (!downloaded) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: caption || `${audioLabel} (failed to download)`,
					metadata: { ...metadata, ...extraMetadata },
				};
			}
			return buildFileUploadMessage(chatId, caption, downloaded, suggestedName, undefined, { ...metadata, ...extraMetadata });
		}

		// No transcriber and no fileUpload — reject
		return {
			adapter: "telegram",
			sender: chatId,
			text: transcriberError
				? `⚠️ Audio transcription misconfigured: ${transcriberError}`
				: `⚠️ Audio files are not supported. Enable transcription or fileUpload in config.`,
			metadata: { ...metadata, rejected: true, ...extraMetadata },
		};
	}

	/**
	 * Process a single Telegram message into an IncomingMessage.
	 * Handles text, photos, documents, voice, audio, video, and other files.
	 */
	async function processMessage(msg: TelegramMessage, chatId: string): Promise<IncomingMessage | null> {
		const metadata = buildBaseMetadata(msg);
		const caption = msg.caption || "";

		// ── Photo ──────────────────────────────────────────
		if (msg.photo && msg.photo.length > 0) {
			const largest = msg.photo[msg.photo.length - 1];
			const effectiveMaxSize = fileUploadEnabled ? Math.min(fileUploadMaxSize, TELEGRAM_DOWNLOAD_LIMIT) : MAX_FILE_SIZE;

			// Size check
			if (largest.file_size && largest.file_size > effectiveMaxSize) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `⚠️ Photo too large (max ${formatSize(effectiveMaxSize)}).`,
					metadata: { ...metadata, rejected: true },
				};
			}

			const downloaded = await downloadFile(largest.file_id, "photo.jpg", effectiveMaxSize);
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
			const filename = doc.file_name || "document";
			const effectiveMaxSize = fileUploadEnabled ? Math.min(fileUploadMaxSize, TELEGRAM_DOWNLOAD_LIMIT) : MAX_FILE_SIZE;

			// Size check
			if (doc.file_size && doc.file_size > effectiveMaxSize) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `⚠️ File too large: ${filename} (${formatSize(doc.file_size)}, max ${formatSize(effectiveMaxSize)}).`,
					metadata: { ...metadata, rejected: true },
				};
			}

			// Image documents (e.g. uncompressed photos sent as files)
			if (isImageMime(mimeType)) {
				const downloaded = await downloadFile(doc.file_id, filename, effectiveMaxSize);
				if (!downloaded) {
					return {
						adapter: "telegram",
						sender: chatId,
						text: caption || `📎 ${filename} (failed to download)`,
						metadata,
					};
				}

				const attachment: IncomingAttachment = {
					type: "image",
					path: downloaded.localPath,
					filename,
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

			// Text documents — download and attach
			if (isTextDocument(mimeType, filename)) {
				const downloaded = await downloadFile(doc.file_id, filename, effectiveMaxSize);
				if (!downloaded) {
					return {
						adapter: "telegram",
						sender: chatId,
						text: caption || `📎 ${filename} (failed to download)`,
						metadata,
					};
				}

				const attachment: IncomingAttachment = {
					type: "document",
					path: downloaded.localPath,
					filename,
					mimeType: mimeType || "text/plain",
					size: downloaded.size,
				};

				return {
					adapter: "telegram",
					sender: chatId,
					text: caption || `Here is the file ${filename}.`,
					attachments: [attachment],
					metadata: { ...metadata, hasDocument: true, documentType: "text" },
				};
			}

			// Audio documents — transcribe or save as file
			if (isAudioMime(mimeType)) {
				return await processAudioWithFallback(
					chatId, caption, metadata,
					doc.file_id, filename, MAX_AUDIO_SIZE,
					`🎵 [Audio: ${filename}]`,
					{ hasDocument: true, hasAudio: true },
				);
			}

			// Video and other file types — save as file if fileUpload enabled
			if (fileUploadEnabled) {
				const downloaded = await downloadFile(doc.file_id, filename, Math.min(fileUploadMaxSize, TELEGRAM_DOWNLOAD_LIMIT));
				if (!downloaded) {
					return {
						adapter: "telegram",
						sender: chatId,
						text: caption || `📎 ${filename} (failed to download)`,
						metadata,
					};
				}
				return buildFileUploadMessage(chatId, caption, downloaded, filename, mimeType, { ...metadata, hasDocument: true });
			}

			// Unsupported file type (no fileUpload)
			return {
				adapter: "telegram",
				sender: chatId,
				text: `⚠️ Unsupported file type: ${filename} (${mimeType || "unknown"}). I can handle text files, images, and audio. Enable fileUpload in config for other file types.`,
				metadata: { ...metadata, rejected: true },
			};
		}

		// ── Voice message ──────────────────────────────────
		if (msg.voice) {
			const voice = msg.voice;
			const maxSize = fileUploadEnabled ? Math.min(fileUploadMaxSize, TELEGRAM_DOWNLOAD_LIMIT) : MAX_AUDIO_SIZE;

			if (voice.file_size && voice.file_size > maxSize) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `⚠️ Voice message too large (${formatSize(voice.file_size)}, max ${formatSize(maxSize)}).`,
					metadata: { ...metadata, rejected: true, hasVoice: true },
				};
			}

			return await processAudioWithFallback(
				chatId, "", metadata,
				voice.file_id, "voice.ogg", maxSize,
				"🎤 [Voice message]",
				{ hasVoice: true, voiceDuration: voice.duration },
			);
		}

		// ── Audio file (sent as music) ─────────────────────
		if (msg.audio) {
			const audio = msg.audio;
			const maxSize = fileUploadEnabled ? Math.min(fileUploadMaxSize, TELEGRAM_DOWNLOAD_LIMIT) : MAX_AUDIO_SIZE;

			if (audio.file_size && audio.file_size > maxSize) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `⚠️ Audio too large (${formatSize(audio.file_size)}, max ${formatSize(maxSize)}).`,
					metadata: { ...metadata, rejected: true, hasAudio: true },
				};
			}

			const audioName = audio.title || audio.performer || "audio";
			const label = audio.title
				? `Audio: ${audio.title}${audio.performer ? ` by ${audio.performer}` : ""}`
				: "Audio";

			return await processAudioWithFallback(
				chatId, caption, metadata,
				audio.file_id, `${audioName}.mp3`, maxSize,
				`🎵 [${label}]`,
				{ hasAudio: true, audioTitle: audio.title, audioDuration: audio.duration },
			);
		}

		// ── Video ────────────────────────────────────────────
		if (msg.video) {
			const video = msg.video;
			const maxSize = fileUploadEnabled ? Math.min(fileUploadMaxSize, TELEGRAM_DOWNLOAD_LIMIT) : 0;

			if (!fileUploadEnabled) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: "⚠️ Video files are not supported. Enable fileUpload in config to receive video files.",
					metadata: { ...metadata, rejected: true, hasVideo: true },
				};
			}

			if (video.file_size && video.file_size > maxSize) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: `⚠️ Video too large (${formatSize(video.file_size)}, max ${formatSize(maxSize)}).`,
					metadata: { ...metadata, rejected: true, hasVideo: true },
				};
			}

			const videoExt = guessExtFromMime(video.mime_type) || ".mp4";
			const filename = `video_${video.file_unique_id?.slice(0, 8) || Date.now()}${videoExt}`;
			const downloaded = await downloadFile(video.file_id, filename, maxSize);
			if (!downloaded) {
				return {
					adapter: "telegram",
					sender: chatId,
					text: caption || "🎬 (video — failed to download)",
					metadata: { ...metadata, hasVideo: true },
				};
			}
			return buildFileUploadMessage(chatId, caption, downloaded, filename, video.mime_type, { ...metadata, hasVideo: true });
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

		// Unsupported message type (sticker, animation, etc.) — ignore
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

	/** HTML-safe split: finds > or ; boundary to avoid breaking tags/entities. */
	function safeHtmlSplit(html: string, maxLen: number): number {
		// Scan from maxLen-1 to avoid returning > maxLen chars
		for (let i = maxLen - 1; i >= maxLen / 2; i--) {
			const ch = html[i];
			if (ch === '>' || ch === ';') {
				let safe = true;
				for (let j = i + 1; j < maxLen; j++) {
					if (html[j] === '<' || html[j] === '&') { safe = false; break; }
				}
				if (safe) return i + 1;
			}
		}
		return maxLen;
	}

	return {
		direction: "bidirectional" as const,

		async sendTyping(recipient: string): Promise<void> {
			await sendChatAction(recipient, "typing");
		},

		async send(message: ChannelMessage): Promise<void> {
			// If filePath is provided, send as file
			if (message.filePath) {
				await sendTelegramFile(message.recipient, message.filePath, message.fileName, message.caption || message.text);
				return;
			}

			if (!message.text) {
				throw new Error("Telegram adapter requires text or filePath");
			}
			const prefix = message.source ? `[${message.source}]\n` : "";
			const full = prefix + message.text;

			if (full.length <= MAX_LENGTH) {
				await sendTelegram(message.recipient, full);
				return;
			}

			// Split long messages at newlines, keeping HTML tags/entities intact
			let remaining = full;
			while (remaining.length > 0) {
				if (remaining.length <= MAX_LENGTH) {
					await sendTelegram(message.recipient, remaining);
					break;
				}
				let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
				if (splitAt < MAX_LENGTH / 2) splitAt = safeHtmlSplit(remaining, MAX_LENGTH);
				await sendTelegram(message.recipient, remaining.slice(0, splitAt));
				remaining = remaining.slice(splitAt).replace(/^\n/, "");
			}
		},

		async sendFile(recipient: string, filePath: string, fileName?: string, caption?: string): Promise<void> {
			await sendTelegramFile(recipient, filePath, fileName, caption);
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
	video?: {
		file_id: string;
		file_unique_id: string;
		duration: number;
		width: number;
		height: number;
		mime_type?: string;
		file_size?: number;
		file_name?: string;
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

/** Guess MIME type from file extension. */
function guessMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const mimeMap: Record<string, string> = {
		".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
		".gif": "image/gif", ".webp": "image/webp",
		".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
		".m4a": "audio/x-m4a", ".flac": "audio/flac",
		".mp4": "video/mp4", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
		".mkv": "video/x-matroska", ".webm": "video/webm",
		".pdf": "application/pdf", ".zip": "application/zip",
		".json": "application/json", ".xml": "application/xml",
		".txt": "text/plain", ".html": "text/html", ".csv": "text/csv",
		".md": "text/markdown",
	};
	return mimeMap[ext] || "application/octet-stream";
}

/** Guess file extension from MIME type. */
function guessExtFromMime(mime: string | undefined): string {
	if (!mime) return "";
	const extMap: Record<string, string> = {
		"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
		"audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav",
		"audio/x-m4a": ".m4a", "audio/flac": ".flac",
		"video/mp4": ".mp4", "video/quicktime": ".mov", "video/x-msvideo": ".avi",
		"video/x-matroska": ".mkv", "video/webm": ".webm",
		"application/pdf": ".pdf", "application/zip": ".zip",
	};
	return extMap[mime] || "";
}
