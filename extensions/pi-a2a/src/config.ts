/**
 * pi-a2a — Config from pi SettingsManager.
 *
 * Reads the "pi-a2a" key from settings.json.
 *
 * Example settings.json:
 * {
 *   "pi-a2a": {
 *     "port": 3100,
 *     "publicUrl": "http://localhost:3100",
 *     "name": "Pi Agent",
 *     "description": "Personal AI coding agent",
 *     "version": "1.0.0",
 *     "organization": "e9n",
 *     "contactEmail": "hi@e9n.dev",
 *     "skills": [
 *       { "id": "coding", "name": "Coding", "description": "Write and edit code" }
 *     ],
 *     "hub": {
 *       "url": "http://localhost:3001/api",
 *       "apiKey": "your-hub-api-key",
 *       "categories": ["development-tools"],
 *       "tags": ["coding", "agent"],
 *       "visibility": "public",
 *       "autoRegister": true
 *     }
 *   }
 * }
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import type { A2AConfig } from "./types.ts";

const SETTINGS_KEY = "pi-a2a";

export function loadConfig(cwd: string): A2AConfig {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, unknown>;
	const project = sm.getProjectSettings() as Record<string, unknown>;
	const merged = {
		...(global[SETTINGS_KEY] as Record<string, unknown> ?? {}),
		...(project[SETTINGS_KEY] as Record<string, unknown> ?? {}),
	};
	return merged as A2AConfig;
}
