/**
 * pi-proxy — Settings loader.
 *
 * Reads from `pi-proxy` key in settings.json (global + project merge).
 *
 * Security: `baseUrl` and `headers` are global-only settings. Project-level
 * settings can only configure `providers` (path overrides / exclusions) to
 * prevent a malicious repo from redirecting LLM traffic to an attacker server.
 *
 * Example global settings.json (~/.pi/agent/settings.json):
 *   {
 *     "pi-proxy": {
 *       "baseUrl": "https://proxy.example.com",
 *       "headers": {
 *         "X-Proxy-Auth": "MY_PROXY_TOKEN"
 *       }
 *     }
 *   }
 *
 * Example project settings.json (.pi/settings.json):
 *   {
 *     "pi-proxy": {
 *       "providers": {
 *         "openai": "/custom/openai/path",
 *         "google": false
 *       }
 *     }
 *   }
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface ProxySettings {
	/** Base URL of the proxy server. Empty/undefined = no proxying. Global-only. */
	baseUrl: string;

	/** Optional headers to add to all proxied requests. Values can be env var names. Global-only. */
	headers: Record<string, string>;

	/**
	 * Per-provider overrides (global + project merged).
	 * - string: custom path suffix (e.g. "/v1/anthropic")
	 * - false: skip proxying for this provider
	 * - undefined/missing: use default `/{provider}` path
	 */
	providers: Record<string, string | false>;
}

export interface ResolveResult {
	settings: ProxySettings;
	error?: string;
}

export function resolveSettings(): ResolveResult {
	const defaults: ProxySettings = {
		baseUrl: "",
		headers: {},
		providers: {},
	};

	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(process.cwd(), agentDir);
		const global = (sm.getGlobalSettings() as Record<string, any>) ?? {};
		const project = (sm.getProjectSettings() as Record<string, any>) ?? {};

		const g = global["pi-proxy"] ?? {};
		const p = project["pi-proxy"] ?? {};

		// baseUrl is global-only — project settings cannot override it
		const baseUrl = typeof g.baseUrl === "string" ? g.baseUrl : "";

		// headers are global-only — project settings cannot override them
		const headers: Record<string, string> = {};
		if (g.headers && typeof g.headers === "object") {
			for (const [k, v] of Object.entries(g.headers)) {
				if (typeof v === "string") headers[k] = v;
			}
		}

		// Provider path overrides are merged (project overrides global per-provider)
		const providers: Record<string, string | false> = {};
		for (const src of [g.providers, p.providers]) {
			if (src && typeof src === "object") {
				for (const [k, v] of Object.entries(src)) {
					if (typeof v === "string" || v === false) {
						providers[k] = v;
					}
				}
			}
		}

		return { settings: { baseUrl, headers, providers } };
	} catch (err) {
		return {
			settings: defaults,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
