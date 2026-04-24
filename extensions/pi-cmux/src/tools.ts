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

import { Type } from "typebox";
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

/** Extract a surface ID from a cmux RPC result object.
 *  Prefers surface_ref (human-readable "surface:N") over UUID forms. */
function extractSurfaceId(result: unknown): string | undefined {
	if (result != null && typeof result === "object") {
		const r = result as Record<string, unknown>;
		const id = r.surface_ref ?? r.surface_id ?? r.id;
		if (typeof id === "string" && id.length > 0) return id;
	}
	return undefined;
}

export function registerTools(pi: ExtensionAPI, client: CmuxClient, _log: LogFn): { resetBrowserState: () => void } {

	// Track the most recently opened browser surface so subsequent actions
	// (screenshot, snapshot, click, etc.) can use it without a manual cmux_list call.
	// NOTE: This is a single shared slot. Concurrent open calls race (last writer wins),
	// but in practice tool calls are sequential. The surface ID is always returned in
	// tool results, so callers can pass it explicitly for multi-browser workflows.
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
			const workspaces = await client.listWorkspaces();

			// Fetch surfaces for each workspace in parallel
			const wsArray = Array.isArray(workspaces) ? workspaces : [];
			const surfaceEntries = await Promise.all(
				wsArray.map(async (w) => {
					const ws = w as Record<string, unknown>;
					const wsId = String(ws.id ?? "?");
					const surfaces = await client.listSurfaces({ workspaceId: wsId });
					return { wsId, ws, surfaces };
				}),
			);

			const allSurfaces: unknown[] = [];
			const lines: string[] = [];

			lines.push("## Workspaces");

			for (const { wsId, ws, surfaces } of surfaceEntries) {
				const wsName = String(ws.title ?? ws.name ?? "unnamed");

				// Show workspace name as header
				lines.push("");
				lines.push(`### ${wsName}`);

				for (const s of surfaces) {
					const sf = s as Record<string, unknown>;
					allSurfaces.push(sf);
					const id = String(sf.id ?? "?");
					const title = String(sf.title ?? sf.cwd ?? "untitled");
					const type = String(sf.type ?? "terminal");
					lines.push(`- ${id}: ${title} (${type})`);
				}
			}

			return txt(lines.join("\n"), { surfaces: allSurfaces, workspaces });
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
			"Use cmux_list first to find surface IDs (works across all workspaces). " +
			"Returns the text content of the terminal screen.",
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
			"Works across all workspaces — use cmux_list to discover surface IDs. " +
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
			// Clear tracked browser surface if it was the one closed
			if (lastBrowserSurfaceId === params.surface) {
				lastBrowserSurfaceId = undefined;
			}
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
			"Interact with cmux's built-in browser. Actions include navigation, DOM interaction, inspection, JS injection, " +
			"state management, and more. After open, the surface is remembered — subsequent actions auto-target it without needing a surface ID.",
		parameters: Type.Object({
			action: Type.Union([
				// Navigation
				Type.Literal("open"),
				Type.Literal("navigate"),
				Type.Literal("back"),
				Type.Literal("forward"),
				Type.Literal("reload"),
				Type.Literal("url"),
				Type.Literal("identify"),
				// Waiting
				Type.Literal("wait"),
				// DOM interaction
				Type.Literal("click"),
				Type.Literal("dblclick"),
				Type.Literal("hover"),
				Type.Literal("focus"),
				Type.Literal("check"),
				Type.Literal("uncheck"),
				Type.Literal("scroll-into-view"),
				Type.Literal("type"),
				Type.Literal("fill"),
				Type.Literal("press"),
				Type.Literal("keydown"),
				Type.Literal("keyup"),
				Type.Literal("select"),
				Type.Literal("scroll"),
				// Inspection
				Type.Literal("snapshot"),
				Type.Literal("screenshot"),
				Type.Literal("get"),
				Type.Literal("is"),
				Type.Literal("find"),
				Type.Literal("highlight"),
				// JS injection
				Type.Literal("eval"),
				Type.Literal("addinitscript"),
				Type.Literal("addscript"),
				Type.Literal("addstyle"),
				// Frames/Dialogs
				Type.Literal("frame"),
				Type.Literal("dialog"),
				Type.Literal("download"),
				// State
				Type.Literal("cookies"),
				Type.Literal("storage"),
				Type.Literal("state"),
				// Tabs/Logs
				Type.Literal("tab"),
				Type.Literal("console"),
				Type.Literal("errors"),
			], { description: "Browser action to perform" }),
			url: Type.Optional(Type.String({ description: "URL for open/navigate actions" })),
			surface: Type.Optional(Type.String({ description: "Browser surface ID (optional — auto-targets the last opened browser if omitted)" })),
			selector: Type.Optional(Type.String({ description: "CSS selector for DOM actions" })),
			value: Type.Optional(Type.String({ description: "Value for fill/select actions or JS expression for eval" })),
			compact: Type.Optional(Type.Boolean({ description: "Return compact DOM snapshot (default: true)" })),
			subaction: Type.Optional(Type.String({ description: "Sub-action for get/is/find/cookies/storage/state/tab/console/errors/dialog" })),
			text: Type.Optional(Type.String({ description: "Text for type action, wait text condition, or dialog prompt" })),
			key: Type.Optional(Type.String({ description: "Key name for press/keydown/keyup (e.g. 'Enter', 'Tab')" })),
			timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds for wait action" })),
			dx: Type.Optional(Type.Number({ description: "Horizontal scroll delta for scroll action" })),
			dy: Type.Optional(Type.Number({ description: "Vertical scroll delta for scroll action" })),
			attr: Type.Optional(Type.String({ description: "Attribute name for get attr" })),
			property: Type.Optional(Type.String({ description: "Property name for get styles" })),
			name: Type.Optional(Type.String({ description: "Name filter for find role, or key name for storage get/set" })),
			nth: Type.Optional(Type.Number({ description: "Index for find nth" })),
			path: Type.Optional(Type.String({ description: "File path for download or state save/load" })),
			domain: Type.Optional(Type.String({ description: "Domain for cookies set" })),
			storageType: Type.Optional(Type.String({ description: "Storage type: 'local' or 'session'" })),
			waitCondition: Type.Optional(Type.String({ description: "Wait condition: 'selector'|'text'|'url'|'load-state'|'function'" })),
			loadState: Type.Optional(Type.String({ description: "Load state for wait: 'load'|'domcontentloaded'|'networkidle'" })),
			urlContains: Type.Optional(Type.String({ description: "URL substring for wait url condition" })),
			function: Type.Optional(Type.String({ description: "JS function expression for wait condition" })),
			maxDepth: Type.Optional(Type.Number({ description: "Maximum depth for snapshot DOM traversal" })),
			interactive: Type.Optional(Type.Boolean({ description: "Include interactive elements only in snapshot" })),
			snapshotAfter: Type.Optional(Type.Boolean({ description: "Take a snapshot after executing the action" })),
			css: Type.Optional(Type.String({ description: "CSS string for addstyle action" })),
		}),
		async execute(_toolCallId, params) {
			// Resolve surface: explicit param → tracked last browser → auto-discover via surface.list
			let surface = params.surface || lastBrowserSurfaceId;

			// For non-open actions, if we don't have a surface, try to discover one
			if (!surface && params.action !== "open") {
				const discovered = await client.discoverBrowserSurface();
				if (discovered) {
					lastBrowserSurfaceId = discovered;
					surface = discovered;
				}
			}

			// Helper to take snapshot after action if requested.
			// Failures are swallowed — the primary action already succeeded,
			// so a snapshot error should not discard that result or trigger retries.
			const maybeSnapshot = async (baseResult: string): Promise<string> => {
				if (params.snapshotAfter && surface) {
					try {
						const snapshot = await client.browserSnapshot(surface, true);
						return baseResult + "\n\n" + snapshot;
					} catch {
						return baseResult + "\n\n(snapshot unavailable after action)";
					}
				}
				return baseResult;
			};

			switch (params.action) {
				// ── Navigation ──────────────────────────────────────
				case "open": {
					if (!params.url) throw new Error("url is required for open action");
					assertSafeUrl(params.url);
					const result = await client.browserOpen(params.url);
					const newSurfaceId = extractSurfaceId(result);
					if (newSurfaceId) {
						lastBrowserSurfaceId = newSurfaceId;
					} else {
						_log("browser_open_no_surface", { result }, "WARN");
					}
					const idInfo = lastBrowserSurfaceId ? ` (surface: ${lastBrowserSurfaceId})` : "";
					return txt(`Opened browser: ${params.url}${idInfo}`, { result, surfaceId: lastBrowserSurfaceId });
				}
				case "navigate": {
					if (!surface) throw new Error("surface is required for navigate (open a browser first)");
					if (!params.url) throw new Error("url is required for navigate");
					assertSafeUrl(params.url);
					await client.browserNavigate(surface, params.url);
					const message = await maybeSnapshot(`Navigated ${surface} to ${params.url}`);
					return txt(message);
				}
				case "back": {
					if (!surface) throw new Error("surface is required for back (open a browser first)");
					await client.browserBack(surface);
					const message = await maybeSnapshot(`Navigated back in ${surface}`);
					return txt(message);
				}
				case "forward": {
					if (!surface) throw new Error("surface is required for forward (open a browser first)");
					await client.browserForward(surface);
					const message = await maybeSnapshot(`Navigated forward in ${surface}`);
					return txt(message);
				}
				case "reload": {
					if (!surface) throw new Error("surface is required for reload (open a browser first)");
					await client.browserReload(surface);
					const message = await maybeSnapshot(`Reloaded ${surface}`);
					return txt(message);
				}
				case "url": {
					if (!surface) throw new Error("surface is required for url (open a browser first)");
					const urlResult = await client.browserUrl(surface);
					return txt(JSON.stringify(urlResult), { surface });
				}
				case "identify": {
					if (!surface) throw new Error("surface is required for identify (open a browser first)");
					const identifyResult = await client.browserIdentify(surface);
					return txt(JSON.stringify(identifyResult, null, 2), { surface });
				}

				// ── Waiting ─────────────────────────────────────────
				case "wait": {
					if (!surface) throw new Error("surface is required for wait (open a browser first)");
					const waitOpts: Record<string, unknown> = {};
					if (params.selector) waitOpts.selector = params.selector;
					if (params.text) waitOpts.text = params.text;
					if (params.urlContains) waitOpts.url_contains = params.urlContains;
					if (params.loadState) waitOpts.load_state = params.loadState;
					if (params.function) waitOpts.function = params.function;
					if (params.timeout !== undefined) waitOpts.timeout_ms = params.timeout;
					await client.browserWait(surface, waitOpts);
					const message = await maybeSnapshot(`Wait completed in ${surface}`);
					return txt(message);
				}

				// ── DOM interaction ─────────────────────────────────
				case "click": {
					if (!surface) throw new Error("surface is required for click (open a browser first)");
					if (!params.selector) throw new Error("selector is required for click");
					await client.browserClick(surface, params.selector);
					const message = await maybeSnapshot(`Clicked: ${params.selector}`);
					return txt(message);
				}
				case "dblclick": {
					if (!surface) throw new Error("surface is required for dblclick (open a browser first)");
					if (!params.selector) throw new Error("selector is required for dblclick");
					await client.browserDblclick(surface, params.selector);
					const message = await maybeSnapshot(`Double-clicked: ${params.selector}`);
					return txt(message);
				}
				case "hover": {
					if (!surface) throw new Error("surface is required for hover (open a browser first)");
					if (!params.selector) throw new Error("selector is required for hover");
					await client.browserHover(surface, params.selector);
					const message = await maybeSnapshot(`Hovered: ${params.selector}`);
					return txt(message);
				}
				case "focus": {
					if (!surface) throw new Error("surface is required for focus (open a browser first)");
					if (!params.selector) throw new Error("selector is required for focus");
					await client.browserFocus(surface, params.selector);
					const message = await maybeSnapshot(`Focused: ${params.selector}`);
					return txt(message);
				}
				case "check": {
					if (!surface) throw new Error("surface is required for check (open a browser first)");
					if (!params.selector) throw new Error("selector is required for check");
					await client.browserCheck(surface, params.selector);
					const message = await maybeSnapshot(`Checked: ${params.selector}`);
					return txt(message);
				}
				case "uncheck": {
					if (!surface) throw new Error("surface is required for uncheck (open a browser first)");
					if (!params.selector) throw new Error("selector is required for uncheck");
					await client.browserUncheck(surface, params.selector);
					const message = await maybeSnapshot(`Unchecked: ${params.selector}`);
					return txt(message);
				}
				case "scroll-into-view": {
					if (!surface) throw new Error("surface is required for scroll-into-view (open a browser first)");
					if (!params.selector) throw new Error("selector is required for scroll-into-view");
					await client.browserScrollIntoView(surface, params.selector);
					const message = await maybeSnapshot(`Scrolled into view: ${params.selector}`);
					return txt(message);
				}
				case "type": {
					if (!surface) throw new Error("surface is required for type (open a browser first)");
					if (!params.selector) throw new Error("selector is required for type");
					if (params.text === undefined) throw new Error("text is required for type");
					await client.browserType(surface, params.selector, params.text);
					const message = await maybeSnapshot(`Typed into ${params.selector}`);
					return txt(message);
				}
				case "fill": {
					if (!surface) throw new Error("surface is required for fill (open a browser first)");
					if (!params.selector) throw new Error("selector is required for fill");
					if (params.value === undefined) throw new Error("value is required for fill");
					await client.browserFill(surface, params.selector, params.value);
					const message = await maybeSnapshot(`Filled ${params.selector}`);
					return txt(message, { surface });
				}
				case "press": {
					if (!surface) throw new Error("surface is required for press (open a browser first)");
					if (!params.key) throw new Error("key is required for press");
					await client.browserPress(surface, params.key);
					const message = await maybeSnapshot(`Pressed key: ${params.key}`);
					return txt(message);
				}
				case "keydown": {
					if (!surface) throw new Error("surface is required for keydown (open a browser first)");
					if (!params.key) throw new Error("key is required for keydown");
					await client.browserKeydown(surface, params.key);
					const message = await maybeSnapshot(`Key down: ${params.key}`);
					return txt(message);
				}
				case "keyup": {
					if (!surface) throw new Error("surface is required for keyup (open a browser first)");
					if (!params.key) throw new Error("key is required for keyup");
					await client.browserKeyup(surface, params.key);
					const message = await maybeSnapshot(`Key up: ${params.key}`);
					return txt(message);
				}
				case "select": {
					if (!surface) throw new Error("surface is required for select (open a browser first)");
					if (!params.selector) throw new Error("selector is required for select");
					if (params.value === undefined) throw new Error("value is required for select");
					await client.browserSelect(surface, params.selector, params.value);
					const message = await maybeSnapshot(`Selected ${params.value} in ${params.selector}`);
					return txt(message);
				}
				case "scroll": {
					if (!surface) throw new Error("surface is required for scroll (open a browser first)");
					const scrollOpts: Record<string, unknown> = {};
					if (params.selector) scrollOpts.selector = params.selector;
					if (params.dx !== undefined) scrollOpts.dx = params.dx;
					if (params.dy !== undefined) scrollOpts.dy = params.dy;
					await client.browserScroll(surface, scrollOpts);
					const message = await maybeSnapshot(`Scrolled in ${surface}`);
					return txt(message);
				}

				// ── Inspection ──────────────────────────────────────
				case "snapshot": {
					if (!surface) throw new Error("surface is required for snapshot (open a browser first)");
					const snapshotOpts: Record<string, unknown> = {};
					if (params.selector) snapshotOpts.selector = params.selector;
					if (params.maxDepth !== undefined) snapshotOpts.max_depth = params.maxDepth;
					if (params.interactive !== undefined) snapshotOpts.interactive = params.interactive;
					const html = await client.browserSnapshot(surface, params.compact ?? true, snapshotOpts);
					return txt(html, { surface });
				}
				case "screenshot": {
					if (!surface) throw new Error("surface is required for screenshot (open a browser first)");
					const screenshot = await client.browserScreenshot(surface);
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
				case "get": {
					if (!surface) throw new Error("surface is required for get (open a browser first)");
					if (!params.subaction) throw new Error("subaction (what to get) is required for get");
					const getOpts: Record<string, unknown> = {};
					if (params.selector) getOpts.selector = params.selector;
					if (params.attr) getOpts.attr = params.attr;
					if (params.property) getOpts.property = params.property;
					const getResult = await client.browserGet(surface, params.subaction, getOpts);
					return txt(JSON.stringify(getResult, null, 2), { surface });
				}
				case "is": {
					if (!surface) throw new Error("surface is required for is (open a browser first)");
					if (!params.subaction) throw new Error("subaction (check type) is required for is");
					if (!params.selector) throw new Error("selector is required for is");
					const isResult = await client.browserIs(surface, params.subaction, params.selector);
					return txt(JSON.stringify(isResult), { surface });
				}
				case "find": {
					if (!surface) throw new Error("surface is required for find (open a browser first)");
					if (!params.subaction) throw new Error("subaction (find by) is required for find");
					if (!params.value) throw new Error("value is required for find");
					const findOpts: Record<string, unknown> = {};
					if (params.name) findOpts.name = params.name;
					if (params.nth !== undefined) findOpts.n = params.nth;
					const findResult = await client.browserFind(surface, params.subaction, params.value, findOpts);
					return txt(JSON.stringify(findResult, null, 2), { surface });
				}
				case "highlight": {
					if (!surface) throw new Error("surface is required for highlight (open a browser first)");
					if (!params.selector) throw new Error("selector is required for highlight");
					await client.browserHighlight(surface, params.selector);
					return txt(`Highlighted: ${params.selector}`);
				}

				// ── JS injection ────────────────────────────────────
				case "eval": {
					if (!surface) throw new Error("surface is required for eval (open a browser first)");
					if (params.value === undefined) throw new Error("value (JS expression) is required for eval");
					const evalResult = await client.browserEval(surface, params.value);
					return txt(JSON.stringify(evalResult, null, 2), { surface });
				}
				case "addinitscript": {
					if (!surface) throw new Error("surface is required for addinitscript (open a browser first)");
					if (!params.value) throw new Error("value (script) is required for addinitscript");
					await client.browserAddInitScript(surface, params.value);
					return txt(`Added init script to ${surface}`);
				}
				case "addscript": {
					if (!surface) throw new Error("surface is required for addscript (open a browser first)");
					if (!params.value) throw new Error("value (script) is required for addscript");
					await client.browserAddScript(surface, params.value);
					return txt(`Added script to ${surface}`);
				}
				case "addstyle": {
					if (!surface) throw new Error("surface is required for addstyle (open a browser first)");
					if (!params.css) throw new Error("css is required for addstyle");
					await client.browserAddStyle(surface, params.css);
					return txt(`Added stylesheet to ${surface}`);
				}

				// ── Frames/Dialogs ──────────────────────────────────
				case "frame": {
					if (!surface) throw new Error("surface is required for frame (open a browser first)");
					if (!params.selector) throw new Error("selector is required for frame");
					await client.browserFrame(surface, params.selector);
					const message = await maybeSnapshot(`Switched to frame: ${params.selector}`);
					return txt(message);
				}
				case "dialog": {
					if (!surface) throw new Error("surface is required for dialog (open a browser first)");
					if (!params.subaction) throw new Error("subaction (accept/dismiss) is required for dialog");
					await client.browserDialog(surface, params.subaction, params.text);
					return txt(`Dialog ${params.subaction}ed`);
				}
				case "download": {
					if (!surface) throw new Error("surface is required for download (open a browser first)");
					const downloadOpts: Record<string, unknown> = {};
					if (params.path) downloadOpts.path = params.path;
					if (params.timeout !== undefined) downloadOpts.timeout_ms = params.timeout;
					const downloadResult = await client.browserDownload(surface, downloadOpts);
					return txt(JSON.stringify(downloadResult, null, 2), { surface });
				}

				// ── State ───────────────────────────────────────────
				case "cookies": {
					if (!surface) throw new Error("surface is required for cookies (open a browser first)");
					if (!params.subaction) throw new Error("subaction (get/set/clear) is required for cookies");
					const cookieOpts: Record<string, unknown> = {};
					if (params.name) cookieOpts.name = params.name;
					if (params.domain) cookieOpts.domain = params.domain;
					if (params.value) cookieOpts.value = params.value;
					if (params.path) cookieOpts.path = params.path;
					const cookiesResult = await client.browserCookies(surface, params.subaction, cookieOpts);
					return txt(JSON.stringify(cookiesResult, null, 2), { surface });
				}
				case "storage": {
					if (!surface) throw new Error("surface is required for storage (open a browser first)");
					if (!params.storageType) throw new Error("storageType (local/session) is required for storage");
					if (!params.subaction) throw new Error("subaction is required for storage");
					const storageResult = await client.browserStorage(
						surface,
						params.storageType,
						params.subaction,
						params.name, // Storage key
						params.value,
					);
					return txt(JSON.stringify(storageResult, null, 2), { surface });
				}
				case "state": {
					if (!surface) throw new Error("surface is required for state (open a browser first)");
					if (!params.subaction) throw new Error("subaction (save/load) is required for state");
					if (!params.path) throw new Error("path is required for state");
					await client.browserState(surface, params.subaction, params.path);
					return txt(`State ${params.subaction}ed: ${params.path}`);
				}

				// ── Tabs/Logs ───────────────────────────────────────
				case "tab": {
					if (!surface) throw new Error("surface is required for tab (open a browser first)");
					if (!params.subaction) throw new Error("subaction (list/new/switch/close) is required for tab");
					const tabOpts: Record<string, unknown> = {};
					if (params.url) {
						assertSafeUrl(params.url);
						tabOpts.url = params.url;
					}
					if (params.value) tabOpts.value = params.value;
					const tabResult = await client.browserTab(surface, params.subaction, tabOpts);
					return txt(JSON.stringify(tabResult, null, 2), { surface });
				}
				case "console": {
					if (!surface) throw new Error("surface is required for console (open a browser first)");
					if (!params.subaction) throw new Error("subaction (list/clear) is required for console");
					const consoleResult = await client.browserConsole(surface, params.subaction);
					return txt(JSON.stringify(consoleResult, null, 2), { surface });
				}
				case "errors": {
					if (!surface) throw new Error("surface is required for errors (open a browser first)");
					if (!params.subaction) throw new Error("subaction (list/clear) is required for errors");
					const errorsResult = await client.browserErrors(surface, params.subaction);
					return txt(JSON.stringify(errorsResult, null, 2), { surface });
				}

				default:
					throw new Error(`Unknown browser action: ${params.action}`);
			}
		},
	});

	return {
		resetBrowserState() {
			lastBrowserSurfaceId = undefined;
		},
	};
}
