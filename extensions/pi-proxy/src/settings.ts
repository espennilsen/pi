/**
 * pi-proxy — Settings loader.
 *
 * Reads from `pi-proxy` key in settings.json (global + project merge).
 *
 * Example settings.json:
 *   {
 *     "pi-proxy": {
 *       "baseUrl": "https://proxy.example.com",
 *       "headers": {
 *         "X-Proxy-Auth": "MY_PROXY_TOKEN"
 *       },
 *       "providers": {
 *         "openai": "/custom/openai/path",
 *         "google": false
 *       }
 *     }
 *   }
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface ProxySettings {
	/** Base URL of the proxy server. Empty/undefined = no proxying. */
	baseUrl: string;

	/** Optional headers to add to all proxied requests. Values can be env var names. */
	headers: Record<string, string>;

	/**
	 * Per-provider overrides.
	 * - string: custom path suffix (e.g. "/v1/anthropic")
	 * - false: skip proxying for this provider
	 * - undefined/missing: use default `/{provider}` path
	 */
	providers: Record<string, string | false>;
}

export function resolveSettings(): ProxySettings {
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

		// Project settings override global
		const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl
			: typeof g.baseUrl === "string" ? g.baseUrl
			: "";

		// Merge headers (project overrides global per-key)
		const headers: Record<string, string> = {};
		if (g.headers && typeof g.headers === "object") {
			for (const [k, v] of Object.entries(g.headers)) {
				if (typeof v === "string") headers[k] = v;
			}
		}
		if (p.headers && typeof p.headers === "object") {
			for (const [k, v] of Object.entries(p.headers)) {
				if (typeof v === "string") headers[k] = v;
			}
		}

		// Merge provider overrides (project overrides global per-provider)
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

		return { baseUrl, headers, providers };
	} catch {
		return defaults;
	}
}
