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

// Cache for auto-generated API key to ensure consistency across loadConfig() calls
let cachedGeneratedApiKey: string | undefined;

function isExternalBind(local: Record<string, unknown>): boolean {
	if (typeof local.bindInterface === "string" && local.bindInterface.length > 0) {
		return true;
	}
	const bind = typeof local.bind === "string" ? local.bind : undefined;
	return !!bind && bind !== "127.0.0.1" && bind !== "::1";
}

export interface ConfigResult {
	config: A2AConfig;
	warnings: string[];
}

const LEGACY_LOCAL_FIELDS = [
	"port", "portRange", "bind", "bindInterface", "publicUrl", "requireApiKey", "apiKey",
] as const;
const AUTH_MODES = new Set(["legacy-api-key", "oauth2", "oauth2+mtls"]);

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function normalizeAuth(auth: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
	const normalized = { ...auth };
	if (auth.supportedAuthModes !== undefined && !Array.isArray(auth.supportedAuthModes)) {
		delete normalized.supportedAuthModes;
		warnings.push("Invalid local.auth supportedAuthModes was ignored");
	}
	if (Array.isArray(auth.supportedAuthModes)) {
		const modes = [...new Set(auth.supportedAuthModes.filter((mode): mode is string => typeof mode === "string" && AUTH_MODES.has(mode)))];
		if (modes.length !== auth.supportedAuthModes.length) {
			warnings.push("Invalid local.auth supportedAuthModes entries were ignored");
		}
		if (modes.includes("oauth2+mtls")) {
			const mtls = asRecord(auth.mtls);
			const transport = asRecord(auth.transport);
			if (typeof mtls.certPath !== "string" || typeof mtls.keyPath !== "string" ||
				transport.mtls !== true || transport.clientCertificate !== true) {
				normalized.supportedAuthModes = modes.filter((mode) => mode !== "oauth2+mtls");
				delete normalized.mtls;
				warnings.push("mTLS support was ignored because certificate material is incomplete");
				return normalized;
			}
			// Preserve usable material so startup can reject it rather than silently
			// changing an authenticated deployment into an unauthenticated one.
			warnings.push("mTLS support will be rejected at startup because certificate-bound transport is unavailable");
		}
		normalized.supportedAuthModes = modes;
	}
	if (auth.selectedAuthMode !== undefined) {
		delete normalized.selectedAuthMode;
		warnings.push("local.auth selectedAuthMode is ignored; selection is evaluated per request");
	}
	return normalized;
}

/** Merge global and project settings without runtime-dependent validation or key generation. */
export function normalizeConfig(globalSettings: Record<string, unknown>, projectSettings: Record<string, unknown>): ConfigResult {
	const warnings: string[] = [];
	const globalConf = { ...asRecord(globalSettings) };
	const projectConf = { ...asRecord(projectSettings) };
	let migratedAny = false;

	for (const conf of [globalConf, projectConf]) {
		const local = { ...asRecord(conf.local) };
		for (const field of LEGACY_LOCAL_FIELDS) {
			if (conf[field] !== undefined && local[field] === undefined) {
				local[field] = conf[field];
				migratedAny = true;
			}
		}
		conf.local = local;
	}
	if (migratedAny) {
		warnings.push(
			"Deprecation warning: pi-a2a settings using flat fields (port, bind, apiKey, etc.) " +
			"should be nested under \"local\". Move them to pi-a2a.local in settings.json. " +
			"See https://github.com/espennilsen/pi for the new schema.",
		);
	}

	const globalLocal = asRecord(globalConf.local);
	const projectLocal = asRecord(projectConf.local);
	const globalAuth = asRecord(globalLocal.auth);
	const projectAuth = asRecord(projectLocal.auth);
	const auth = { ...globalAuth, ...projectAuth };
	if (globalAuth.transport !== undefined || projectAuth.transport !== undefined) {
		auth.transport = { ...asRecord(globalAuth.transport), ...asRecord(projectAuth.transport) };
	}
	if (globalAuth.mtls !== undefined || projectAuth.mtls !== undefined) {
		auth.mtls = { ...asRecord(globalAuth.mtls), ...asRecord(projectAuth.mtls) };
	}
	if (globalAuth.oauth2 !== undefined || projectAuth.oauth2 !== undefined) {
		auth.oauth2 = { ...asRecord(globalAuth.oauth2), ...asRecord(projectAuth.oauth2) };
	}
	const local = { ...globalLocal, ...projectLocal };
	if (globalLocal.auth !== undefined || projectLocal.auth !== undefined) {
		local.auth = normalizeAuth(auth, warnings);
	}

	const merged: Record<string, unknown> = { ...globalConf, ...projectConf };
	if (globalConf.hub !== undefined || projectConf.hub !== undefined) {
		merged.hub = { ...asRecord(globalConf.hub), ...asRecord(projectConf.hub) };
	}
	merged.local = local;
	if (Array.isArray(merged.staticAgents)) {
		merged.staticAgents = merged.staticAgents.map((agent) => {
			if (agent === null || typeof agent !== "object" || Array.isArray(agent)) {
				warnings.push("Invalid static agent entry was preserved unchanged");
				return agent;
			}
			const peer = { ...(agent as Record<string, unknown>) };
			if (peer.auth !== undefined) peer.auth = normalizeAuth(asRecord(peer.auth), warnings);
			return peer;
		});
	}
	return { config: merged as A2AConfig, warnings };
}

export function loadConfig(cwd: string): ConfigResult {
	const agentDir = getAgentDir();
	const sm = SettingsManager.create(cwd, agentDir);
	const global = sm.getGlobalSettings() as Record<string, unknown>;
	const project = sm.getProjectSettings() as Record<string, unknown>;
	const normalized = normalizeConfig(global[SETTINGS_KEY] as Record<string, unknown>, project[SETTINGS_KEY] as Record<string, unknown>);
	const merged = normalized.config as Record<string, unknown>;
	const warnings = normalized.warnings;
	const local = merged.local as Record<string, unknown>;

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

	// ── Auto-generate apiKey when required or implied by hub-backed external exposure ──
	const hubImpliesApiKey = isExternalBind(local) && typeof (merged.hub as Record<string, unknown> | undefined)?.url === "string";
	const requireApiKeyImpliesApiKey = local.requireApiKey === true;
	// Hub-connected sessions receive a runtime-only fallback credential during
	// startup. Never generate and inject a local key into effective settings.
	const shouldAutoGenerateApiKey = !local.apiKey && !hubImpliesApiKey && requireApiKeyImpliesApiKey;
	if (shouldAutoGenerateApiKey) {
		// Check for existing generated key before creating a new one
		if (!cachedGeneratedApiKey) {
			cachedGeneratedApiKey = "a2a_" + randomBytes(32).toString("hex");
			if (requireApiKeyImpliesApiKey && !hubImpliesApiKey) {
				warnings.push(
					"pi-a2a auto-generated a local API key for external access. " +
					"Run `/a2a apikey` to view it.",
				);
			}
			if (merged.staticAgents && Array.isArray(merged.staticAgents) && merged.staticAgents.length > 0) {
				warnings.push(
					`Warning: an API key was auto-generated but staticAgents are configured. ` +
					`Update static agent configs with the new key to prevent authentication failures.`,
				);
			}
		}
		local.apiKey = cachedGeneratedApiKey;
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
