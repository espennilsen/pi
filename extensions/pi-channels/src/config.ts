/**
 * pi-channels — Config from pi SettingsManager.
 *
 * Reads the "pi-channels" key from settings via SettingsManager,
 * which merges global (~/.pi/agent/settings.json) and project
 * (.pi/settings.json) configs automatically.
 *
 * Environment variable overrides (highest priority, override settings.json):
 *   - TELEGRAM_BOT_TOKEN → adapters.telegram.botToken
 *   - WEBHOOK_SECRET     → adapters.webhook.secret
 *
 * Example settings.json:
 * {
 *   "pi-channels": {
 *     "adapters": {
 *       "telegram": {
 *         "type": "telegram",
 *         "botToken": "your-telegram-bot-token"
 *       },
 *       "slack": {
 *         "type": "slack"
 *       }
 *     },
 *     "slack": {
 *       "appToken": "xapp-...",
 *       "botToken": "xoxb-..."
 *     },
 *     "routes": {
 *       "ops": { "adapter": "telegram", "recipient": "-100987654321" }
 *     }
 *   }
 * }
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import type { ChannelConfig } from "./types.ts";

const SETTINGS_KEY = "pi-channels";

export function loadConfig(cwd: string): ChannelConfig {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, any>;
	const project = sm.getProjectSettings() as Record<string, any>;

	const globalCh = global?.[SETTINGS_KEY] ?? {};
	const projectCh = project?.[SETTINGS_KEY] ?? {};

	// Project overrides global (shallow merge of adapters + routes + bridge)
	const merged: ChannelConfig = {
		adapters: {
			...(globalCh.adapters ?? {}),
			...(projectCh.adapters ?? {}),
		} as ChannelConfig["adapters"],
		routes: {
			...(globalCh.routes ?? {}),
			...(projectCh.routes ?? {}),
		},
		bridge: {
			...(globalCh.bridge ?? {}),
			...(projectCh.bridge ?? {}),
		} as ChannelConfig["bridge"],
	};

	// Env vars override settings.json values
	applyEnvOverrides(merged);

	return merged;
}

/**
 * Apply environment variable overrides to the merged config.
 *
 * Env vars take highest priority, overriding any value from settings.json.
 *
 *   TELEGRAM_BOT_TOKEN → adapters.telegram.botToken
 *   WEBHOOK_SECRET     → adapters.webhook.secret
 *
 * Adapter entries are auto-created with a default type if they don't already exist
 * in settings, so you can run purely from env vars without any settings.json config.
 */
function applyEnvOverrides(config: ChannelConfig): void {
	const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
	if (telegramToken) {
		if (!config.adapters.telegram) {
			config.adapters.telegram = { type: "telegram" };
		}
		config.adapters.telegram.botToken = telegramToken;
	}

	const webhookSecret = process.env.WEBHOOK_SECRET;
	if (webhookSecret) {
		if (!config.adapters.webhook) {
			config.adapters.webhook = { type: "webhook" };
		}
		config.adapters.webhook.secret = webhookSecret;
	}
}

/**
 * Read a setting from the "pi-channels" config by dotted key path.
 * Useful for adapter-specific secrets that shouldn't live in the adapter config block.
 *
 * Example: getChannelSetting(cwd, "slack.appToken") reads pi-channels.slack.appToken
 */
export function getChannelSetting(cwd: string, keyPath: string): unknown {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, any>;
	const project = sm.getProjectSettings() as Record<string, any>;

	const globalCh = global?.[SETTINGS_KEY] ?? {};
	const projectCh = project?.[SETTINGS_KEY] ?? {};

	// Walk the dotted path independently in each scope to avoid
	// shallow-merge dropping sibling keys from nested objects.
	function walk(obj: any): unknown {
		let current: any = obj;
		for (const part of keyPath.split(".")) {
			if (current == null || typeof current !== "object") return undefined;
			current = current[part];
		}
		return current;
	}

	// Project overrides global at the leaf level.
	// Use explicit undefined check so null can be used to unset a global default.
	const projectValue = walk(projectCh);
	return projectValue !== undefined ? projectValue : walk(globalCh);
}
