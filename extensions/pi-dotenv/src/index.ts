/**
 * pi-dotenv — DEPRECATED.
 *
 * All extensions now read config directly from settings.json.
 * The "env:" syntax and .env file loading are no longer used.
 *
 * This extension is kept as a no-op for backwards compatibility
 * (safe to remove from your extensions directory).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (_pi: ExtensionAPI) {
	// No-op — all config is now in settings.json
}
