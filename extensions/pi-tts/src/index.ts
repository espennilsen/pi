/**
 * pi-tts — Text-to-speech extension for pi.
 *
 * Provides a `generate_tts` tool that the LLM can use to convert text
 * into spoken audio via a local TTS server on the LAN.
 *
 * The generated WAV file is saved to /tmp and the file path is returned
 * so the assistant or client can play or stream the audio.
 * Temp files are cleaned up when the session ends.
 *
 * Also provides a `/tts` command for quick speech generation from the TUI.
 *
 * Voice mapping:
 *   "espen" → /opt/tts/voices/espen.wav
 *   (omit voice_id for the TTS server default voice)
 *
 * Settings:
 *   "pi-tts": {
 *     "baseUrl": "http://192.168.0.27:8001",  // TTS server URL (optional, default shown)
 *     "timeoutMs": 30000                       // Request timeout in ms (optional)
 *   }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { registerTtsTool } from "./tool.ts";
import { resolveSettings } from "./settings.ts";
import { resolveVoicePath, getAvailableVoices } from "./voices.ts";
import { generateAudio } from "./tts-client.ts";

const DEFAULT_BASE_URL = "http://192.168.0.27:8001";
const DEFAULT_TIMEOUT_MS = 30_000;

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);

	let baseUrl = DEFAULT_BASE_URL;
	let timeoutMs = DEFAULT_TIMEOUT_MS;

	// Track temp files created during this session for cleanup
	const tempFiles: string[] = [];

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);
		baseUrl = settings.baseUrl;
		timeoutMs = settings.timeoutMs;
		log("init", { status: "ready", baseUrl, timeoutMs });
	});

	pi.on("session_shutdown", async () => {
		// Clean up temp WAV files created during the session
		if (tempFiles.length > 0) {
			const { unlink } = await import("node:fs/promises");
			let removed = 0;
			for (const filePath of tempFiles) {
				try {
					await unlink(filePath);
					removed++;
				} catch {
					// File may already be gone — ignore
				}
			}
			log("cleanup", { filesTracked: tempFiles.length, filesRemoved: removed });
		}
	});

	// ── TTS tool for LLM ────────────────────────────────────────

	registerTtsTool(pi, {
		getBaseUrl: () => baseUrl,
		getTimeoutMs: () => timeoutMs,
		onFileCreated: (filePath) => tempFiles.push(filePath),
	});

	// ── /tts command for TUI ─────────────────────────────────────

	pi.registerCommand("tts", {
		description: "Generate speech: /tts <text> | /tts --voice espen <text>",
		getArgumentCompletions: (prefix: string) => {
			if (prefix.startsWith("--voice ")) {
				const voices = getAvailableVoices();
				const voicePrefix = prefix.slice(8);
				const filtered = voices.filter(v => v.startsWith(voicePrefix));
				return filtered.length > 0 ? filtered.map(v => ({ value: `--voice ${v}`, label: v })) : null;
			}
			if (prefix.startsWith("--")) {
				return [{ value: "--voice ", label: "--voice <name>" }];
			}
			return null;
		},
		handler: async (args, ctx) => {
			const raw = args?.trim() ?? "";
			if (!raw) {
				const voices = getAvailableVoices();
				ctx.ui.notify(`Usage: /tts <text>\n       /tts --voice <name> <text>\n\nAvailable voices: ${voices.join(", ")}`, "info");
				return;
			}

			let voiceId: string | undefined;
			let text = raw;

			if (raw.startsWith("--voice ")) {
				const parts = raw.slice(8).split(/\s+/, 1);
				voiceId = parts[0];
				text = raw.slice(8 + voiceId.length).trim();
			}

			const voicePath = resolveVoicePath(voiceId);
			if (voiceId && !voicePath) {
				const voices = getAvailableVoices();
				ctx.ui.notify(`Unknown voice "${voiceId}". Available: ${voices.join(", ")}`, "error");
				return;
			}

			if (!text) {
				ctx.ui.notify("No text provided.", "error");
				return;
			}

			ctx.ui.notify("Generating speech…", "info");

			const result = await generateAudio({
				text,
				language_id: "en",
				voice_sample_path: voicePath,
			}, baseUrl, timeoutMs);

			if (!result.ok) {
				ctx.ui.notify(`TTS error (${result.status}): ${result.message}\n${result.details}`, "error");
				return;
			}

			// Track file for session cleanup
			tempFiles.push(result.file_path);

			const sizeKb = (result.size_bytes / 1024).toFixed(1);
			ctx.ui.notify(`Audio saved: ${result.file_path} (${sizeKb} KB)`, "info");
		},
	});
}