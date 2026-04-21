/**
 * pi-tts — Settings loader.
 *
 * Settings in settings.json under "pi-tts":
 * {
 *   "pi-tts": {
 *     "baseUrl": "http://192.168.0.27:8001",
 *     "timeoutMs": 30000
 *   }
 * }
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface TtsSettings {
	/** TTS server base URL (default: "http://192.168.0.27:8001"). */
	baseUrl: string;
	/** Request timeout in milliseconds (default: 30000). */
	timeoutMs: number;
}

const DEFAULTS: TtsSettings = {
	baseUrl: "http://192.168.0.27:8001",
	timeoutMs: 30_000,
};

export function resolveSettings(cwd: string): TtsSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-tts"] ?? {}), ...(project?.["pi-tts"] ?? {}) };

		return {
			baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : DEFAULTS.baseUrl,
			timeoutMs: typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0 ? cfg.timeoutMs : DEFAULTS.timeoutMs,
		};
	} catch {
		return { ...DEFAULTS };
	}
}