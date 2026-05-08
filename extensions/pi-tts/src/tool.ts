/**
 * Register the `generate_tts` tool for LLM use.
 *
 * Transforms logical voice IDs into file paths and calls the TTS server.
 * Returns a file path to the generated WAV audio.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { generateAudio, type TtsResult } from "./tts-client.ts";
import { resolveVoicePath, getAvailableVoices } from "./voices.ts";

interface TtsToolDetails {
	text: string;
	language_id: string;
	voice_id?: string;
	voice_sample_path?: string;
	file_path?: string;
	size_bytes?: number;
	error?: boolean;
	status?: number;
	message?: string;
}

export interface TtsToolConfig {
	getBaseUrl: (ctx: ExtensionContext) => string;
	getTimeoutMs: (ctx: ExtensionContext) => number;
	onFileCreated?: (filePath: string, ctx: ExtensionContext) => void;
}

export function registerTtsTool(pi: ExtensionAPI, config: TtsToolConfig) {
	pi.registerTool({
		name: "generate_tts",
		label: "Generate TTS",
		description:
			"Generate speech audio from text using the local TTS server. Returns a WAV file path that can be played or streamed. " +
			'Use voice_id to select a voice: "espen" for the Espen voice, or omit for the default voice.',
		promptSnippet: "Generate speech audio from text via the local TTS server",
		promptGuidelines: [
			"Use generate_tts when the user wants spoken audio generated from text.",
			"The tool returns a file path to a WAV file — mention the path so the user can play it.",
		],
		parameters: Type.Object({
			text: Type.String({ description: "The text to speak" }),
			language_id: Type.Optional(Type.String({ description: 'Language code, e.g. "en", "no". Default: "en"', default: "en" })),
			voice_id: Type.Optional(Type.String({ description: 'Logical voice name, e.g. "espen". Omit to use the TTS server default voice.' })),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const { text, language_id = "en", voice_id } = params;

			// Resolve voice ID to file path
			let voice_sample_path: string | undefined;
			if (voice_id) {
				voice_sample_path = resolveVoicePath(voice_id);
				if (!voice_sample_path) {
					const available = getAvailableVoices();
					const message = `Unknown voice_id "${voice_id}". Available voices: ${available.join(", ")}. Omit voice_id to use the server default.`;
					return {
						content: [{
							type: "text" as const,
							text: message,
						}],
						details: { text, language_id, voice_id, error: true, message } as TtsToolDetails,
						isError: true,
					};
				}
			}

			onUpdate?.({ content: [{ type: "text", text: `Generating speech…` }], details: {} });

			const result: TtsResult = await generateAudio({
				text,
				language_id,
				voice_sample_path,
			}, config.getBaseUrl(ctx), config.getTimeoutMs(ctx), signal);

			if (!result.ok) {
				const details: TtsToolDetails = {
					text,
					language_id,
					voice_id,
					error: true,
					status: result.status,
					message: result.message,
				};
				return {
					content: [{
						type: "text" as const,
						text: `TTS error (${result.status}): ${result.message}. Check the TTS server logs for details.`,
					}],
					details,
					isError: true,
				};
			}

			// Track file for session cleanup
			config.onFileCreated?.(result.file_path, ctx);

			const sizeKb = (result.size_bytes / 1024).toFixed(1);
			const details: TtsToolDetails = {
				text,
				language_id,
				voice_id,
				voice_sample_path,
				file_path: result.file_path,
				size_bytes: result.size_bytes,
			};

			return {
				content: [{
					type: "text" as const,
					text: `Audio generated successfully.\n\nFile: ${result.file_path}\nMIME: ${result.mime_type}\nSize: ${sizeKb} KB`,
				}],
				details,
			};
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("generate_tts "));
			if (args.voice_id) {
				text += theme.fg("accent", args.voice_id + " ");
			}
			text += theme.fg("muted", `"${(args.text ?? "").slice(0, 60)}${(args.text ?? "").length > 60 ? "…" : ""}"`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Generating audio…"), 0, 0);
			}

			const details = result.details as TtsToolDetails | undefined;

			if (details?.error) {
				return new Text(theme.fg("error", `TTS error: ${details.message ?? "unknown"}`), 0, 0);
			}

			const sizeKb = details?.size_bytes != null ? (details.size_bytes / 1024).toFixed(1) : "?";
			let text = theme.fg("success", "✓ Audio generated");
			text += theme.fg("dim", ` — ${sizeKb} KB`);
			if (details?.file_path) {
				text += theme.fg("muted", `\n${details.file_path}`);
			}

			return new Text(text, 0, 0);
		},
	});
}