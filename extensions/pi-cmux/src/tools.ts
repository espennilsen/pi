/**
 * pi-cmux — Agent tools for cmux pane management and interaction.
 *
 * Registers tools that let the LLM control cmux:
 *   - cmux_list       — List surfaces and workspaces
 *   - cmux_split      — Split pane and optionally run a command
 *   - cmux_read       — Read terminal output from another pane
 *   - cmux_send       — Send text/keystrokes to another pane
 *   - cmux_close      — Close a pane
 *   - cmux_notify     — Send a desktop notification
 *   - cmux_browser    — Open URL, snapshot DOM, click, fill, eval JS
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CmuxClient } from "./client.ts";
import type { LogFn } from "./logger.ts";

/** Helper to build a tool result. */
function txt(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

const ALLOWED_SCHEMES = ["http:", "https:"];

/** Validate that a URL uses an allowed scheme (http/https only). */
function assertSafeUrl(url: string): void {
	const parsed = URL.canParse(url) ? new URL(url) : null;
	if (!parsed || !ALLOWED_SCHEMES.includes(parsed.protocol)) {
		throw new Error("Disallowed URL scheme — only http/https are permitted");
	}
}

/** Extract a surface ID from a cmux RPC result object. */
function extractSurfaceId(result: unknown): string | undefined {
	if (result != null && typeof result === "object") {
		const r = result as Record<string, unknown>;
		// cmux returns surface_id (UUID) or surface_ref (surface:N)
		const id = r.surface_id ?? r.surface_ref ?? r.id;
		if (typeof id === "string" && id.length > 0) return id;
	}
	return undefined;
}

export function registerTools(pi: ExtensionAPI, client: CmuxClient, _log: LogFn): void {

	// Track the most recently opened browser surface so subsequent actions
	// (screenshot, snapshot, click, etc.) can use it without a manual cmux_list call.
	let lastBrowserSurfaceId: string | undefined;

	// ── cmux_list ───────────────────────────────────────────────

	pi.registerTool({
		name: "cmux_list",
		label: "cmux List",
		description:
			"List all cmux surfaces (terminal panes) and workspaces. " +
			"Returns surface IDs, titles, and workspace info. Use this to discover " +
			"available panes before reading or sending input.",
		parameters: Type.Object({}),
		async execute() {
			const [surfaces, workspaces] = await Promise.all([
				client.listSurfaces(),
				client.listWorkspaces(),
			]);
			const lines: string[] = [];
			lines.push("## Workspaces");
			if (Array.isArray(workspaces) && workspaces.length > 0) {
				for (const w of workspaces) {
					const ws = w as Record<string, unknown>;
					lines.push(`- ${ws.id ?? "?"}: ${ws.name ?? ws.title ?? "unnamed"}`);
				}
			} else {
				lines.push("No workspaces found.");
			}
			lines.push("\n## Surfaces");
			if (Array.isArray(surfaces) && surfaces.length > 0) {
				for (const s of surfaces) {
					const sf = s as Record<string, unknown>;
					lines.push(`- ${sf.id ?? "?"}: ${sf.title ?? sf.cwd ?? "untitled"} (${sf.type ?? "terminal"})`);
				}
			} else {
				lines.push("No surfaces found.");
			}
			return txt(lines.join("\n"), { surfaces, workspaces });
		},
	});

	// ── cmux_split ──────────────────────────────────────────────

	pi.registerTool({
		name: "cmux_split",
		label: "cmux Split",
		description:
			"Split the current terminal pane and optionally run a command in the new pane. " +
			"Returns the new surface ID for subsequent reads/sends. " +
			"Note: if you pass a command, the shell may not be fully ready — use cmux_read to verify the command ran.",
		parameters: Type.Object({
			direction: Type.Union([Type.Literal("right"), Type.Literal("down")], {
				description: 'Split direction: "right" (vertical split) or "down" (horizontal split)',
			}),
			command: Type.Optional(Type.String({
				description: "Command to run in the new pane (e.g. 'npm run dev'). Include trailing newline to execute.",
			})),
		}),
		async execute(_toolCallId, params) {
			const raw = await client.splitSurface(params.direction);
			const result = (raw != null && typeof raw === "object") ? raw as Record<string, unknown> : {};
			const surfaceId = (result.surface_ref ?? result.surface_id ?? result.id ?? "unknown") as string;

			if (params.command) {
				// Ensure command ends with newline to execute
				const cmd = params.command.endsWith("\n") ? params.command : params.command + "\n";
				await client.sendInput(surfaceId, cmd);
			}

			const cmdInfo = params.command ? ` — running: ${params.command.replace(/\n$/, "")}` : "";
			return txt(`Created surface ${surfaceId} (split ${params.direction})${cmdInfo}`, { surfaceId, ...result });
		},
	});

	// ── cmux_read ───────────────────────────────────────────────

	pi.registerTool({
		name: "cmux_read",
		label: "cmux Read Screen",
		description:
			"Read the visible terminal output from another cmux pane. " +
			"Use cmux_list first to find surface IDs. Returns the text content " +
			"of the terminal screen.",
		parameters: Type.Object({
			surface: Type.String({
				description: 'Surface ID to read from (e.g. "surface:2")',
			}),
			lines: Type.Optional(Type.Number({
				description: "Number of lines to read (default: 50)",
			})),
		}),
		async execute(_toolCallId, params) {
			const output = await client.readScreen(params.surface, params.lines ?? 50);
			return txt(output, { surface: params.surface, lines: params.lines ?? 50 });
		},
	});

	// ── cmux_send ───────────────────────────────────────────────

	pi.registerTool({
		name: "cmux_send",
		label: "cmux Send Input",
		description:
			"Send text or keystrokes to another cmux pane. " +
			"Provide exactly one of `text` or `key` (not both). " +
			"Use this to type commands, answer prompts, or interact with programs " +
			"running in other panes. Append \\n to execute a command.",
		parameters: Type.Object({
			surface: Type.String({
				description: 'Surface ID to send to (e.g. "surface:2")',
			}),
			text: Type.Optional(Type.String({
				description: 'Text to send (e.g. "npm test\\n"). Use \\n for Enter.',
			})),
			key: Type.Optional(Type.String({
				description: 'Named key to send (e.g. "ctrl+c", "enter", "escape")',
			})),
		}),
		async execute(_toolCallId, params) {
			if (params.text !== undefined && params.key !== undefined) {
				throw new Error("Provide either text or key, not both");
			}
			if (params.text !== undefined) {
				await client.sendInput(params.surface, params.text);
				return txt(`Sent text to ${params.surface}: ${params.text.replace(/\n/g, "\\n")}`, { surface: params.surface });
			} else if (params.key) {
				await client.sendKey(params.surface, params.key);
				return txt(`Sent key to ${params.surface}: ${params.key}`, { surface: params.surface });
			} else {
				throw new Error("Provide either text or key parameter");
			}
		},
	});

	// ── cmux_close ──────────────────────────────────────────────

	pi.registerTool({
		name: "cmux_close",
		label: "cmux Close",
		description: "Close a cmux pane. Use cmux_list to find surface IDs.",
		parameters: Type.Object({
			surface: Type.String({
				description: 'Surface ID to close (e.g. "surface:2")',
			}),
		}),
		async execute(_toolCallId, params) {
			await client.closeSurface(params.surface);
			return txt(`Closed surface ${params.surface}`, { surface: params.surface });
		},
	});

	// ── cmux_notify ─────────────────────────────────────────────

	pi.registerTool({
		name: "cmux_notify",
		label: "cmux Notify",
		description:
			"Send a desktop notification via cmux. Triggers the blue notification ring " +
			"on the cmux tab and a macOS notification.",
		parameters: Type.Object({
			title: Type.String({ description: "Notification title" }),
			body: Type.String({ description: "Notification body text" }),
			subtitle: Type.Optional(Type.String({ description: "Optional subtitle" })),
		}),
		async execute(_toolCallId, params) {
			await client.notify(params.title, params.body, params.subtitle);
			return txt(`Notification sent: ${params.title} — ${params.body}`);
		},
	});

	// ── cmux_browser ────────────────────────────────────────────

	pi.registerTool({
		name: "cmux_browser",
		label: "cmux Browser",
		description:
			"Interact with cmux's built-in browser. Actions: open (new browser pane), " +
			"navigate (go to URL), snapshot (get DOM), screenshot, click, fill, eval (run JS). " +
			"After open, the surface is remembered — subsequent actions auto-target it without needing a surface ID.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("open"),
				Type.Literal("navigate"),
				Type.Literal("snapshot"),
				Type.Literal("screenshot"),
				Type.Literal("click"),
				Type.Literal("fill"),
				Type.Literal("eval"),
			], { description: "Browser action to perform" }),
			url: Type.Optional(Type.String({ description: "URL for open/navigate actions" })),
			surface: Type.Optional(Type.String({ description: "Browser surface ID (optional — auto-targets the last opened browser if omitted)" })),
			selector: Type.Optional(Type.String({ description: "CSS selector for click/fill actions" })),
			value: Type.Optional(Type.String({ description: "Value for fill action or JS expression for eval" })),
			compact: Type.Optional(Type.Boolean({ description: "Return compact DOM snapshot (default: true)" })),
		}),
		async execute(_toolCallId, params) {
			// Resolve surface: use explicit param, fall back to last opened browser surface
			const surface = params.surface || lastBrowserSurfaceId;

			switch (params.action) {
				case "open": {
					if (!params.url) throw new Error("url is required for open action");
					assertSafeUrl(params.url);
					const result = await client.browserOpen(params.url);
					const newSurfaceId = extractSurfaceId(result);
					if (newSurfaceId) lastBrowserSurfaceId = newSurfaceId;
					const idInfo = newSurfaceId ? ` (surface: ${newSurfaceId})` : "";
					return txt(`Opened browser: ${params.url}${idInfo}`, { result, surfaceId: newSurfaceId });
				}
				case "navigate": {
					if (!surface) throw new Error("surface is required for navigate (open a browser first)");
					if (!params.url) throw new Error("url is required for navigate");
					assertSafeUrl(params.url);
					await client.browserNavigate(surface, params.url);
					return txt(`Navigated ${surface} to ${params.url}`);
				}
				case "snapshot": {
					if (!surface) throw new Error("surface is required for snapshot (open a browser first)");
					const html = await client.browserSnapshot(surface, params.compact ?? true);
					return txt(html, { surface });
				}
				case "screenshot": {
					if (!surface) throw new Error("surface is required for screenshot (open a browser first)");
					const screenshot = await client.browserScreenshot(surface);
					// Extract file path from screenshot result
					const screenshotObj = (screenshot != null && typeof screenshot === "object")
						? screenshot as Record<string, unknown>
						: null;
					const filePath = screenshotObj?.path as string | undefined;
					if (filePath) {
						return txt(
							`Screenshot saved to: ${filePath}\nUse the read tool on this path to view the image.`,
							{ surface, path: filePath },
						);
					}
					return txt(JSON.stringify(screenshot), { surface });
				}
				case "click": {
					if (!surface) throw new Error("surface is required for click (open a browser first)");
					if (!params.selector) throw new Error("selector is required for click");
					await client.browserClick(surface, params.selector);
					return txt(`Clicked: ${params.selector}`);
				}
				case "fill": {
					if (!surface) throw new Error("surface is required for fill (open a browser first)");
					if (!params.selector) throw new Error("selector is required for fill");
					if (params.value === undefined) throw new Error("value is required for fill");
					await client.browserFill(surface, params.selector, params.value);
					return txt(`Filled ${params.selector}`, { surface });
				}
				case "eval": {
					if (!surface) throw new Error("surface is required for eval (open a browser first)");
					if (params.value === undefined) throw new Error("value (JS expression) is required for eval");
					const evalResult = await client.browserEval(surface, params.value);
					return txt(JSON.stringify(evalResult, null, 2), { surface });
				}
				default:
					throw new Error(`Unknown browser action: ${params.action}`);
			}
		},
	});
}
