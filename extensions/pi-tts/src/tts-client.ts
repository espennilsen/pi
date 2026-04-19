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
 * Call the TTS server and save the resulting WAV to a temp file.
 */
export async function generateAudio(
	request: TtsRequest,
	baseUrl: string = DEFAULT_BASE_URL,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TtsResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const payload: Record<string, string> = {
			text: request.text,
		};
		if (request.language_id) {
			payload.language_id = request.language_id;
		}
		if (request.voice_sample_path) {
			payload.voice_sample_path = request.voice_sample_path;
		}

		const response = await fetch(`${baseUrl}/tts`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: controller.signal,
		});

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			const truncated = body.slice(0, 2048);
			return {
				ok: false,
				status: response.status,
				message: "TTS backend error",
				details: truncated,
			};
		}

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

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
		if (err.name === "AbortError" || controller.signal.aborted) {
			return {
				ok: false,
				status: 0,
				message: "TTS request timed out",
				details: `Request exceeded ${timeoutMs}ms timeout. The TTS server at ${baseUrl} may be unresponsive.`,
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