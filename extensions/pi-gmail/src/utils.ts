/**
 * Shared utilities for pi-gmail.
 */

import { execFile } from "node:child_process";

// ── HTML escaping ───────────────────────────────────────────────

const HTML_ESCAPE_MAP: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/**
 * Escape a string for safe interpolation into HTML.
 */
export function escapeHtml(str: string): string {
	return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]!);
}

// ── Config value helpers ────────────────────────────────────────

/**
 * Return a config value as-is (empty string if undefined).
 * Values should be set directly in settings.json.
 */
export function resolveEnv(value: string | undefined): string {
	if (!value) return "";
	return value;
}

// ── Cross-platform URL opener ───────────────────────────────────

/**
 * Open a URL in the default browser, cross-platform.
 * Uses execFile with argument array to prevent shell injection.
 */
export function openUrl(url: string): void {
	switch (process.platform) {
		case "darwin":
			execFile("open", [url]);
			break;
		case "win32":
			execFile("cmd", ["/c", "start", "", url]);
			break;
		default:
			// Linux and other Unix-like
			execFile("xdg-open", [url]);
			break;
	}
}
