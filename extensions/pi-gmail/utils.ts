/**
 * Shared utilities for pi-gmail.
 */

import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

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

// ── Cross-platform URL opener ───────────────────────────────────

export interface BrowserCommand {
	command: string;
	args: string[];
}

interface SpawnedBrowser {
	once(event: "error", listener: (error: Error) => void): unknown;
	unref(): unknown;
}

type SpawnBrowser = (
	command: string,
	args: string[],
	options: SpawnOptions,
) => SpawnedBrowser;

/** Select the platform browser launcher without invoking a shell. */
export function getBrowserCommand(
	url: string,
	platform: NodeJS.Platform = process.platform,
): BrowserCommand {
	switch (platform) {
		case "darwin":
			return { command: "open", args: [url] };
		case "win32":
			return {
				command: "rundll32",
				args: ["url.dll,FileProtocolHandler", url],
			};
		default:
			return { command: "xdg-open", args: [url] };
	}
}

/**
 * Best-effort browser launch. Launcher failures are deliberately ignored because
 * callers always provide a visible URL fallback.
 */
export function openUrl(
	url: string,
	platform: NodeJS.Platform = process.platform,
	spawnBrowser: SpawnBrowser = spawn,
): void {
	const { command, args } = getBrowserCommand(url, platform);
	try {
		const child = spawnBrowser(command, args, {
			detached: true,
			stdio: "ignore",
			shell: false,
		});
		child.once("error", () => {});
		child.unref();
	} catch {
		// A missing or unavailable launcher must not crash Pi.
	}
}
