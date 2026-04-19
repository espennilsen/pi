/**
 * Voice ID to file path mapping.
 *
 * Add entries here to register new voice samples.
 * If voice_id is omitted when calling the tool, the TTS server
 * uses its default voice (no voice_sample_path sent).
 */

export const VOICE_MAP: Record<string, string> = {
	espen: "/opt/tts/voices/espen.wav",
};

/**
 * Resolve a logical voice_id to a file path.
 * Returns undefined if the voice_id is not in the map.
 */
export function resolveVoicePath(voiceId: string | undefined): string | undefined {
	if (!voiceId) return undefined;
	return VOICE_MAP[voiceId.toLowerCase()];
}

/**
 * Get a list of available voice IDs for error messages.
 */
export function getAvailableVoices(): string[] {
	return Object.keys(VOICE_MAP);
}