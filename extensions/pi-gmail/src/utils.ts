/**
 * Shared utilities for pi-gmail.
 */

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

// ── Environment variable resolution ─────────────────────────────

/**
 * Resolve a value that may use the `env:VAR_NAME` pattern.
 * Returns the environment variable value, or the original string.
 */
export function resolveEnv(value: string | undefined): string {
	if (!value) return "";
	if (value.startsWith("env:")) return process.env[value.slice(4)] ?? "";
	return value;
}

// ── Cross-platform URL opener ───────────────────────────────────

/**
 * Open a URL in the default browser, cross-platform.
 */
export function openUrl(url: string): void {
	const { exec } = require("node:child_process") as typeof import("node:child_process");

	switch (process.platform) {
		case "darwin":
			exec(`open "${url}"`);
			break;
		case "win32":
			exec(`start "" "${url}"`);
			break;
		default:
			// Linux and other Unix-like
			exec(`xdg-open "${url}"`);
			break;
	}
}
