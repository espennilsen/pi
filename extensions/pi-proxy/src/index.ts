/**
 * pi-proxy — Route LLM API calls through a configurable proxy.
 *
 * Reads `pi-proxy.baseUrl` from global settings.json.
 * When set, overrides the baseUrl for all known providers so requests
 * go through the proxy instead of directly to provider APIs.
 *
 * Each provider is mounted at `{baseUrl}/{provider}`, e.g.:
 *   https://proxy.example.com/anthropic
 *   https://proxy.example.com/openai
 *
 * When `pi-proxy.baseUrl` is not set (or empty), the extension is
 * a no-op — requests go directly to provider APIs as usual.
 *
 * Security:
 *   - baseUrl and headers are global-only (project settings cannot override)
 *   - baseUrl must use https:// (except localhost for local dev)
 *   - Project settings can only configure per-provider path overrides
 *
 * Optional per-provider path overrides via `pi-proxy.providers`:
 *   {
 *     "pi-proxy": {
 *       "providers": {
 *         "anthropic": "/v1/anthropic",
 *         "openai": false
 *       }
 *     }
 *   }
 *
 * Set a provider to `false` to skip proxying for that provider.
 * Set a provider to a string to use a custom path suffix.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveSettings } from "./settings.ts";

const CH = "pi-proxy";

/** Known providers that can be proxied. */
const KNOWN_PROVIDERS = [
	"anthropic",
	"openai",
	"google",
	"xai",
	"openrouter",
	"groq",
	"mistral",
] as const;

/** Check if a URL is a local address (localhost / 127.0.0.1 / [::1]). */
function isLocalUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname === "localhost"
			|| parsed.hostname === "127.0.0.1"
			|| parsed.hostname === "[::1]";
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	const log = (event: string, data: unknown, level: string = "INFO") =>
		pi.events.emit("log", { channel: CH, event, data, level });

	const { settings, error } = resolveSettings();

	if (error) {
		log("error", { reason: "settings error", error }, "WARN");
		return;
	}

	if (!settings.baseUrl) {
		log("skip", { reason: "no baseUrl configured" });
		return;
	}

	const baseUrl = settings.baseUrl.replace(/\/+$/, ""); // strip trailing slashes

	// Validate URL scheme — require https:// unless it's a local dev proxy
	if (!baseUrl.startsWith("https://") && !isLocalUrl(baseUrl)) {
		log("error", {
			reason: "baseUrl must use https:// (http:// allowed only for localhost)",
			baseUrl,
		}, "WARN");
		return;
	}

	const hasHeaders = Object.keys(settings.headers).length > 0;
	let proxiedCount = 0;
	let disabledCount = 0;
	let errorCount = 0;

	for (const provider of KNOWN_PROVIDERS) {
		const override = settings.providers[provider];

		// Explicitly disabled
		if (override === false) {
			log("skip-provider", { provider, reason: "disabled" });
			disabledCount++;
			continue;
		}

		// Build the provider URL — normalize leading slash on custom paths
		const rawPath = typeof override === "string" ? override : `/${provider}`;
		const path = `/${rawPath.replace(/^\/+/, "")}`;
		const providerUrl = `${baseUrl}${path}`;

		try {
			pi.registerProvider(provider, {
				baseUrl: providerUrl,
				...(hasHeaders ? { headers: settings.headers } : {}),
			});

			log("proxied", { provider, url: providerUrl });
			proxiedCount++;
		} catch (err) {
			log("register-error", {
				provider,
				url: providerUrl,
				error: err instanceof Error ? err.message : String(err),
			}, "WARN");
			errorCount++;
		}
	}

	log("init", {
		baseUrl,
		proxied: proxiedCount,
		disabled: disabledCount,
		errors: errorCount,
	});
}
