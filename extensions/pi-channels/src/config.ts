/**
 * pi-channels — Config from pi settings files.
 *
 * Reads the "pi-channels" key from:
 *   1. ~/.pi/agent/settings.json (global)
 *   2. .pi/settings.json (project, overrides global)
 *
 * Example settings.json:
 * {
 *   "pi-channels": {
 *     "adapters": {
 *       "telegram": {
 *         "type": "telegram",
 *         "botToken": "your-telegram-bot-token"
 *       }
 *     },
 *     "routes": {
 *       "ops": { "adapter": "telegram", "recipient": "-100987654321" },
 *       "cron": { "adapter": "telegram", "recipient": "123456789" }
 *     }
 *   }
 * }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ChannelConfig } from "./types.ts";

const SETTINGS_KEY = "pi-channels";

function readJsonSafe(filePath: string): Record<string, unknown> {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return {};
	}
}

export function loadConfig(cwd: string): ChannelConfig {
	const globalPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	const projectPath = path.join(cwd, ".pi", "settings.json");

	const global = readJsonSafe(globalPath)[SETTINGS_KEY] as Record<string, unknown> | undefined;
	const project = readJsonSafe(projectPath)[SETTINGS_KEY] as Record<string, unknown> | undefined;

	// Project overrides global (shallow merge of adapters + routes + bridge)
	const merged: ChannelConfig = {
		adapters: {
			...(global?.adapters as Record<string, unknown> ?? {}),
			...(project?.adapters as Record<string, unknown> ?? {}),
		} as ChannelConfig["adapters"],
		routes: {
			...(global?.routes as Record<string, { adapter: string; recipient: string }> ?? {}),
			...(project?.routes as Record<string, { adapter: string; recipient: string }> ?? {}),
		},
		bridge: {
			...(global?.bridge as Record<string, unknown> ?? {}),
			...(project?.bridge as Record<string, unknown> ?? {}),
		} as ChannelConfig["bridge"],
	};

	return merged;
}
