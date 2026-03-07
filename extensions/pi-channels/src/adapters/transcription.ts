/**
 * pi-channels — Pluggable audio transcription.
 *
 * Supports three providers:
 *   - "apple"      — macOS SFSpeechRecognizer (free, offline, no API key)
 *   - "openai"     — Whisper API
 *   - "elevenlabs" — Scribe API
 *
 * Usage:
 *   const provider = createTranscriptionProvider(config);
 *   const result = await provider.transcribe("/path/to/audio.ogg", "en");
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { TranscriptionConfig } from "../types.ts";

// ── Public interface ────────────────────────────────────────────

export interface TranscriptionResult {
	ok: boolean;
	text?: string;
	error?: string;
}

export interface TranscriptionProvider {
	transcribe(filePath: string, language?: string): Promise<TranscriptionResult>;
}

/**
 * Create a transcription provider from config.
 * If modelRegistry is provided, OpenAI provider will use pi's built-in
 * authentication instead of requiring explicit API keys in config.
 */
export async function createTranscriptionProvider(
	config: TranscriptionConfig,
	modelRegistry?: ModelRegistry
): Promise<TranscriptionProvider> {
	switch (config.provider) {
		case "apple":
			return new AppleProvider(config);
		case "openai":
			return await OpenAIProvider.create(config, modelRegistry);
		case "elevenlabs":
			return await ElevenLabsProvider.create(config, modelRegistry);
		default:
			throw new Error(`Unknown transcription provider: ${config.provider}`);
	}
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Resolve API key from config value.
 * Priority:
 * 1. If no value provided and modelRegistry available → use pi's built-in auth
 * 2. Plain string → literal value (put secrets directly in settings.json)
 */
async function resolveApiKey(
	value: string | undefined,
	provider: string,
	modelRegistry?: ModelRegistry
): Promise<string | undefined> {
	// No explicit config → try pi's built-in authentication
	if (!value) {
		if (modelRegistry) {
			const key = await modelRegistry.getApiKeyForProvider(provider);
			if (key) return key;
		}
		return undefined;
	}

	return value;
}

function validateFile(filePath: string): TranscriptionResult | null {
	if (!fs.existsSync(filePath)) {
		return { ok: false, error: `File not found: ${filePath}` };
	}
	const stat = fs.statSync(filePath);
	// 25MB limit (Whisper max; Telegram max is 20MB)
	if (stat.size > 25 * 1024 * 1024) {
		return { ok: false, error: `File too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max 25MB)` };
	}
	if (stat.size === 0) {
		return { ok: false, error: "File is empty" };
	}
	return null;
}

// ── Apple Provider ──────────────────────────────────────────────

const SWIFT_HELPER_SRC = path.join(import.meta.dirname, "transcribe-apple-v2.swift");
const SWIFT_HELPER_BIN = path.join(import.meta.dirname, "transcribe-apple-v2");

class AppleProvider implements TranscriptionProvider {
	private language: string | undefined;
	private compilePromise: Promise<TranscriptionResult> | null = null;

	constructor(config: TranscriptionConfig) {
		this.language = config.language;
	}

	async transcribe(filePath: string, language?: string): Promise<TranscriptionResult> {
		if (process.platform !== "darwin") {
			return { ok: false, error: "Apple transcription is only available on macOS" };
		}

		const fileErr = validateFile(filePath);
		if (fileErr) return fileErr;

		// Compile Swift helper on first use (promise-based lock prevents races)
		if (!this.compilePromise) {
			this.compilePromise = this.compileHelper();
		}
		const compileResult = await this.compilePromise;
		if (!compileResult.ok) return compileResult;

		// Convert to M4A if needed (SFSpeechRecognizer has poor support for Ogg Opus)
		const converted = await this.convertToCompatibleFormat(filePath);
		if (!converted.ok) return { ok: false, error: converted.error! };
		const audioPath = converted.path;
		const shouldCleanup = audioPath !== filePath;

		const lang = language || this.language;
		const args = [audioPath];
		if (lang) args.push(lang);

		return new Promise((resolve) => {
			execFile(SWIFT_HELPER_BIN, args, { timeout: 60_000 }, (err, stdout, stderr) => {
				// Clean up converted file
				if (shouldCleanup) {
					try { fs.unlinkSync(audioPath); } catch {}
				}

				if (err) {
					resolve({ ok: false, error: stderr?.trim() || err.message });
					return;
				}
				const text = stdout.trim();
				if (!text) {
					resolve({ ok: false, error: "Transcription returned empty result" });
					return;
				}
				resolve({ ok: true, text });
			});
		});
	}

	/**
	 * Convert audio to M4A (AAC) if it's in an incompatible format.
	 * SFSpeechRecognizer works best with M4A, WAV, MP3, AIFF.
	 * Returns the path to use (converted or original).
	 */
	private convertToCompatibleFormat(filePath: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
		const ext = path.extname(filePath).toLowerCase();
		const compatibleFormats = [".m4a", ".mp3", ".wav", ".aiff", ".aif"];

		if (compatibleFormats.includes(ext)) {
			return Promise.resolve({ ok: true, path: filePath });
		}

		const outputPath = filePath.replace(/\.[^.]+$/, ".m4a");

		return new Promise((resolve) => {
			execFile(
				"ffmpeg",
				["-i", filePath, "-vn", "-acodec", "aac", "-b:a", "128k", "-y", outputPath],
				{ timeout: 30_000 },
				(err, _stdout, stderr) => {
					if (err) {
						resolve({ ok: false, error: `Audio conversion failed (ffmpeg): ${stderr?.trim() || err.message}` });
						return;
					}
					resolve({ ok: true, path: outputPath });
				},
			);
		});
	}

	private compileHelper(): Promise<TranscriptionResult> {
		// Skip if already compiled and binary exists
		if (fs.existsSync(SWIFT_HELPER_BIN)) {
			return Promise.resolve({ ok: true });
		}

		if (!fs.existsSync(SWIFT_HELPER_SRC)) {
			return Promise.resolve({
				ok: false,
				error: `Swift helper source not found: ${SWIFT_HELPER_SRC}`,
			});
		}

		return new Promise((resolve) => {
			execFile(
				"swiftc",
				["-O", "-o", SWIFT_HELPER_BIN, SWIFT_HELPER_SRC],
				{ timeout: 30_000 },
				(err, _stdout, stderr) => {
					if (err) {
						resolve({ ok: false, error: `Failed to compile Swift helper: ${stderr?.trim() || err.message}` });
						return;
					}
					resolve({ ok: true });
				},
			);
		});
	}
}

// ── OpenAI Provider ─────────────────────────────────────────────

class OpenAIProvider implements TranscriptionProvider {
	private apiKey: string;
	private model: string;
	private language: string | undefined;

	private constructor(apiKey: string, model: string, language?: string) {
		this.apiKey = apiKey;
		this.model = model;
		this.language = language;
	}

	static async create(
		config: TranscriptionConfig,
		modelRegistry?: ModelRegistry
	): Promise<OpenAIProvider> {
		const key = await resolveApiKey(config.apiKey, "openai", modelRegistry);
		if (!key) {
			throw new Error(
				"OpenAI transcription requires API key. " +
				"Either configure OpenAI in pi (run: /login openai) or set apiKey in transcription config."
			);
		}
		return new OpenAIProvider(key, config.model || "whisper-1", config.language);
	}

	async transcribe(filePath: string, language?: string): Promise<TranscriptionResult> {
		const fileErr = validateFile(filePath);
		if (fileErr) return fileErr;

		const lang = language || this.language;

		try {
			const form = new FormData();
			const fileBuffer = fs.readFileSync(filePath);
			const filename = path.basename(filePath);
			form.append("file", new Blob([fileBuffer]), filename);
			form.append("model", this.model);
			if (lang) form.append("language", lang);

			const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
				method: "POST",
				headers: { Authorization: `Bearer ${this.apiKey}` },
				body: form,
			});

			if (!response.ok) {
				const body = await response.text();
				return { ok: false, error: `OpenAI API error (${response.status}): ${body.slice(0, 200)}` };
			}

			const data = await response.json() as { text?: string };
			if (!data.text) {
				return { ok: false, error: "OpenAI returned empty transcription" };
			}
			return { ok: true, text: data.text };
		} catch (err: any) {
			return { ok: false, error: `OpenAI transcription failed: ${err.message}` };
		}
	}
}

// ── ElevenLabs Provider ─────────────────────────────────────────

class ElevenLabsProvider implements TranscriptionProvider {
	private apiKey: string;
	private model: string;
	private language: string | undefined;

	private constructor(apiKey: string, model: string, language?: string) {
		this.apiKey = apiKey;
		this.model = model;
		this.language = language;
	}

	static async create(
		config: TranscriptionConfig,
		modelRegistry?: ModelRegistry
	): Promise<ElevenLabsProvider> {
		const key = await resolveApiKey(config.apiKey, "elevenlabs", modelRegistry);
		if (!key) {
			throw new Error(
				"ElevenLabs transcription requires API key. " +
				"Set apiKey in settings.json under pi-channels transcription config."
			);
		}
		return new ElevenLabsProvider(key, config.model || "scribe_v1", config.language);
	}

	async transcribe(filePath: string, language?: string): Promise<TranscriptionResult> {
		const fileErr = validateFile(filePath);
		if (fileErr) return fileErr;

		const lang = language || this.language;

		try {
			const form = new FormData();
			const fileBuffer = fs.readFileSync(filePath);
			const filename = path.basename(filePath);
			form.append("file", new Blob([fileBuffer]), filename);
			form.append("model_id", this.model);
			if (lang) form.append("language_code", lang);

			const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
				method: "POST",
				headers: { "xi-api-key": this.apiKey },
				body: form,
			});

			if (!response.ok) {
				const body = await response.text();
				return { ok: false, error: `ElevenLabs API error (${response.status}): ${body.slice(0, 200)}` };
			}

			const data = await response.json() as { text?: string };
			if (!data.text) {
				return { ok: false, error: "ElevenLabs returned empty transcription" };
			}
			return { ok: true, text: data.text };
		} catch (err: any) {
			return { ok: false, error: `ElevenLabs transcription failed: ${err.message}` };
		}
	}
}
