/**
 * pi-a2a — Config from pi SettingsManager.
 *
 * Reads the "pi-a2a" key from settings.json.
 *
 * Example settings.json:
 * {
 *   "pi-a2a": {
 *     "name": "Pi Agent",
 *     "description": "Personal AI coding agent",
 *     "version": "1.0.0",
 *     "organization": "e9n",
 *     "skills": [
 *       { "id": "coding", "name": "Coding", "description": "Write and edit code" }
 *     ],
 *     "local": {
 *       "port": 3100,
 *       "bind": "127.0.0.1",
 *       "bindInterface": "en0",
 *       "requireApiKey": true,
 *       "apiKey": "your-local-api-key"
 *     },
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

import { randomBytes } from "node:crypto";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
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

	// Deep merge `local` — project local settings extend global local settings
	const globalLocal = globalConf.local as Record<string, unknown> | undefined;
	const projectLocal = projectConf.local as Record<string, unknown> | undefined;
	if (globalLocal || projectLocal) {
		merged.local = { ...(globalLocal ?? {}), ...(projectLocal ?? {}) };
	}

	const warnings: string[] = [];

	// ── Backward compat: hoist old flat server fields into `local` ──
	if (!merged.local) {
		merged.local = {};
	}
	const local = merged.local as Record<string, unknown>;

	const migratedFields = [
		"port",
		"portRange",
		"bind",
		"bindInterface",
		"publicUrl",
		"apiKey",
	] as const;

	const migratedAny = migratedFields.some((f) => merged[f] !== undefined && local[f] === undefined);
	if (migratedAny) {
		warnings.push(
			"Deprecation warning: pi-a2a settings using flat fields (port, bind, apiKey, etc.) " +
			"should be nested under \"local\". Move them to pi-a2a.local in settings.json. " +
			"See https://github.com/espennilsen/pi for the new schema.",
		);
	}

	for (const field of migratedFields) {
		if (merged[field] !== undefined && local[field] === undefined) {
			local[field] = merged[field];
		}
	}

	// ── Runtime validation for `local` fields ──
	if (local.port !== undefined) {
		const port = Number(local.port);
		if (!Number.isInteger(port) || port <= 0 || port > 65535) {
			warnings.push(`Invalid local.port "${local.port}", falling back to default (3100)`);
			delete local.port;
		} else {
			local.port = port;
		}
	}
	if (local.portRange !== undefined) {
		const range = local.portRange as [number, number];
		if (!Array.isArray(range) || range.length !== 2 ||
				!Number.isInteger(range[0]) || !Number.isInteger(range[1]) ||
				range[0] <= 0 || range[1] > 65535 || range[0] > range[1]) {
			warnings.push(`Invalid local.portRange, ignoring`);
			delete local.portRange;
		}
	}
	if (local.bind !== undefined && typeof local.bind !== "string") {
		warnings.push(`Invalid local.bind address "${local.bind}", falling back to default ("127.0.0.1")`);
		delete local.bind;
	}

	// ── Auto-generate apiKey when required ──
	if (local.requireApiKey === true && !local.apiKey) {
		const generated = "a2a_" + randomBytes(32).toString("hex");
		local.apiKey = generated;
		if (merged.staticAgents && Array.isArray(merged.staticAgents) && merged.staticAgents.length > 0) {
			warnings.push(
				`Warning: an API key was auto-generated but staticAgents are configured. ` +
				`Update static agent configs with the new key to prevent authentication failures.`,
			);
		}
	}

	// ── Runtime validation for top-level fields ──
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
