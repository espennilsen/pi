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

export interface ConfigResult {
	config: A2AConfig;
	warnings: string[];
}

export function loadConfig(cwd: string): ConfigResult {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, unknown>;
	const project = sm.getProjectSettings() as Record<string, unknown>;
	const globalConf = (global[SETTINGS_KEY] as Record<string, unknown>) ?? {};
	const projectConf = (project[SETTINGS_KEY] as Record<string, unknown>) ?? {};
	const merged = { ...globalConf, ...projectConf };

	// Deep merge `hub` — project hub settings extend global hub settings
	const globalHub = globalConf.hub as Record<string, unknown> | undefined;
	const projectHub = projectConf.hub as Record<string, unknown> | undefined;
	if (globalHub || projectHub) {
		merged.hub = { ...(globalHub ?? {}), ...(projectHub ?? {}) };
	}
	const warnings: string[] = [];

	// Runtime validation for critical fields
	if (merged.port !== undefined) {
		const port = Number(merged.port);
		if (!Number.isInteger(port) || port <= 0 || port > 65535) {
			warnings.push(`Invalid port "${merged.port}", falling back to default (3100)`);
			delete merged.port;
		} else {
			merged.port = port;
		}
	}
	if (merged.portRange !== undefined) {
		const range = merged.portRange as [number, number];
		if (!Array.isArray(range) || range.length !== 2 ||
				!Number.isInteger(range[0]) || !Number.isInteger(range[1]) ||
				range[0] <= 0 || range[1] > 65535 || range[0] > range[1]) {
			warnings.push(`Invalid portRange, ignoring`);
			delete merged.portRange;
		}
	}
	if (merged.bind !== undefined && typeof merged.bind !== "string") {
		warnings.push(`Invalid bind address "${merged.bind}", falling back to default ("127.0.0.1")`);
		delete merged.bind;
	}
	if (merged.sendTimeoutMs !== undefined) {
		const timeout = Number(merged.sendTimeoutMs);
		if (!Number.isFinite(timeout) || timeout <= 0) {
			warnings.push(`Invalid sendTimeoutMs "${merged.sendTimeoutMs}", ignoring (no timeout)`);
			delete merged.sendTimeoutMs;
		} else {
			merged.sendTimeoutMs = timeout;
		}
	}

	return { config: merged as A2AConfig, warnings };
}
