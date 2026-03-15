/**
 * pi-proxy — Route LLM API calls through a configurable proxy.
 *
 * Reads `pi-proxy.baseUrl` from settings.json (global or project).
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
 * Optional per-provider path overrides via `pi-proxy.providers`:
 *   {
 *     "pi-proxy": {
 *       "baseUrl": "https://proxy.example.com",
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

export default function (pi: ExtensionAPI) {
	const log = (event: string, data: unknown, level: string = "INFO") =>
		pi.events.emit("log", { channel: CH, event, data, level });

	const settings = resolveSettings();

	if (!settings.baseUrl) {
		log("skip", { reason: "no baseUrl configured" });
		return;
	}

	const baseUrl = settings.baseUrl.replace(/\/+$/, ""); // strip trailing slashes
	let proxiedCount = 0;

	for (const provider of KNOWN_PROVIDERS) {
		const override = settings.providers[provider];

		// Explicitly disabled
		if (override === false) {
			log("skip-provider", { provider, reason: "disabled" });
			continue;
		}

		// Build the provider URL
		const path = typeof override === "string" ? override : `/${provider}`;
		const providerUrl = `${baseUrl}${path}`;

		pi.registerProvider(provider, {
			baseUrl: providerUrl,
			...(settings.headers ? { headers: settings.headers } : {}),
		});

		log("proxied", { provider, url: providerUrl });
		proxiedCount++;
	}

	log("init", {
		baseUrl,
		proxied: proxiedCount,
		skipped: KNOWN_PROVIDERS.length - proxiedCount,
	});
}
