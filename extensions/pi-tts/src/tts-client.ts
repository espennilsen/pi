/**
 * TTS server client.
 *
 * Endpoint: POST http://192.168.0.27:8001/tts
 * Request:  JSON { text, language_id?, voice_sample_path? }
 * Response: WAV binary (audio/wav)
 *
 * The server runs on the LAN at the configured base URL.
 * A sensible timeout (30s) prevents hanging on unresponsive servers.
 */

const DEFAULT_BASE_URL = "http://192.168.0.27:8001";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_ERROR_BODY_BYTES = 2 * 1024;           // 2 KB

export interface TtsRequest {
	text: string;
	language_id?: string;
	voice_sample_path?: string;
}

export interface TtsSuccessResult {
	ok: true;
	file_path: string;
	mime_type: "audio/wav";
	size_bytes: number;
}

export interface TtsErrorResult {
	ok: false;
	status: number;
	message: string;
	details: string;
}

export type TtsResult = TtsSuccessResult | TtsErrorResult;

/**
 * Strip embedded credentials from a URL before logging or displaying it.
 */
export function redactUrl(baseUrl: string): string {
	try {
		const url = new URL(baseUrl);
		if (url.username || url.password) {
			url.username = "";
			url.password = "";
			return url.href;
		}
	} catch {
		// Invalid URL — return as-is
	}
	return baseUrl;
}

async function readBodyLimited(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
	const reader = response.body?.getReader();
	if (!reader) return Buffer.alloc(0);

	const chunks: Uint8Array[] = [];
	let total = 0;

	try {
		while (true) {
			if (signal?.aborted) {
				await reader.cancel();
				throw new DOMException("The operation was aborted.", "AbortError");
			}

			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				total += value.length;
				if (total > maxBytes) {
					await reader.cancel();
					throw new Error(`Response body exceeds maximum size of ${maxBytes} bytes`);
				}
				chunks.push(value);
			}
		}
	} finally {
		reader.releaseLock();
	}

	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return Buffer.from(result);
}

/**
 * Call the TTS server and save the resulting WAV to a temp file.
 *
 * @param request - TTS request payload
 * @param baseUrl - TTS server base URL
 * @param timeoutMs - Request timeout in milliseconds
 * @param signal - Optional AbortSignal from the framework for cancellation
 */
export async function generateAudio(
	request: TtsRequest,
	baseUrl: string = DEFAULT_BASE_URL,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<TtsResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		// Link external signal with timeout controller so either can abort
		const combinedSignal = signal
			? AbortSignal.any([controller.signal, signal])
			: controller.signal;

		const payload: Record<string, string> = {
			text: request.text,
		};
		if (request.language_id) {
			payload.language_id = request.language_id;
		}
		if (request.voice_sample_path) {
			payload.voice_sample_path = request.voice_sample_path;
		}

		const response = await fetch(new URL("/tts", baseUrl).href, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: combinedSignal,
		});

		if (!response.ok) {
			const body = await readBodyLimited(response, MAX_ERROR_BODY_BYTES).catch(() => Buffer.alloc(0));
			const text = body.toString("utf-8");
			const truncated = text.slice(0, 2048);
			return {
				ok: false,
				status: response.status,
				message: "TTS backend error",
				details: truncated,
			};
		}

		// If cancelled by framework before file write, skip creating the file
		if (signal?.aborted) {
			return {
				ok: false,
				status: 0,
				message: "TTS request cancelled",
				details: "The request was cancelled before the audio file could be saved.",
			};
		}

		const buffer = await readBodyLimited(response, MAX_RESPONSE_SIZE_BYTES, combinedSignal);

		if (combinedSignal.aborted) {
			return {
				ok: false,
				status: 0,
				message: signal?.aborted ? "TTS request cancelled" : "TTS request timed out",
				details: signal?.aborted
					? "The request was cancelled by the framework."
					: `Request exceeded ${timeoutMs}ms timeout. The TTS server at ${redactUrl(baseUrl)} may be unresponsive.`,
			};
		}

		// Save to /tmp/tts-<uuid>.wav
		const { randomUUID } = await import("node:crypto");
		const { writeFile } = await import("node:fs/promises");
		const { join } = await import("node:path");

		const fileName = `tts-${randomUUID()}.wav`;
		const filePath = join("/tmp", fileName);

		await writeFile(filePath, buffer);

		return {
			ok: true,
			file_path: filePath,
			mime_type: "audio/wav",
			size_bytes: buffer.length,
		};
	} catch (err: any) {
		if (err.name === "AbortError") {
			if (signal?.aborted) {
				return {
					ok: false,
					status: 0,
					message: "TTS request cancelled",
					details: "The request was cancelled by the framework.",
				};
			}
			return {
				ok: false,
				status: 0,
				message: "TTS request timed out",
				details: `Request exceeded ${timeoutMs}ms timeout. The TTS server at ${redactUrl(baseUrl)} may be unresponsive.`,
			};
		}

		return {
			ok: false,
			status: 0,
			message: "TTS request failed",
			details: err.message ?? String(err),
		};
	} finally {
		clearTimeout(timeout);
	}
}