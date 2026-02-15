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

/** Create a transcription provider from config. */
export function createTranscriptionProvider(config: TranscriptionConfig): TranscriptionProvider {
	switch (config.provider) {
		case "apple":
			return new AppleProvider(config);
		case "openai":
			return new OpenAIProvider(config);
		case "elevenlabs":
			return new ElevenLabsProvider(config);
		default:
			throw new Error(`Unknown transcription provider: ${config.provider}`);
	}
}

// ── Helpers ─────────────────────────────────────────────────────

/** Resolve "env:VAR_NAME" patterns to actual environment variable values. */
function resolveEnvValue(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (value.startsWith("env:")) {
		const envVar = value.slice(4);
		return process.env[envVar] || undefined;
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

const SWIFT_HELPER_SRC = path.join(import.meta.dirname, "transcribe-apple.swift");
const SWIFT_HELPER_BIN = path.join(import.meta.dirname, "transcribe-apple");

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

		const lang = language || this.language;
		const args = [filePath];
		if (lang) args.push(lang);

		return new Promise((resolve) => {
			execFile(SWIFT_HELPER_BIN, args, { timeout: 60_000 }, (err, stdout, stderr) => {
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

	constructor(config: TranscriptionConfig) {
		const key = resolveEnvValue(config.apiKey);
		if (!key) throw new Error("OpenAI transcription requires apiKey");
		this.apiKey = key;
		this.model = config.model || "whisper-1";
		this.language = config.language;
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

	constructor(config: TranscriptionConfig) {
		const key = resolveEnvValue(config.apiKey);
		if (!key) throw new Error("ElevenLabs transcription requires apiKey");
		this.apiKey = key;
		this.model = config.model || "scribe_v1";
		this.language = config.language;
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
