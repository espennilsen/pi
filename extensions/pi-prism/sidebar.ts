/**
 * WidgetSidebar — the main TUI overlay component for Prism.
 *
 * Renders a bordered panel with stacked widgets, handles scrolling,
 * refresh, and keyboard input.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth, Key } from "@earendil-works/pi-tui";
import { createQuery, fmtAgo, type Q } from "./helpers.ts";
import { resolveSettings } from "./settings.ts";
import type { Widget, WidgetContext } from "./widgets/index.ts";

export class WidgetSidebar {
	private tui: TUI;
	private theme: Theme;
	private query: Q;
	private cwd: string;
	private hubUrl: string | null;
	private hubApiKey: string | null;
	private project: string | null;
	private done: () => void;
	private widgets: Widget[] = [];

	private scroll = 0;
	private maxScroll = 0;
	private loading = true;
	private lastRefresh = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private disposed = false;
	private paused = false;
	private refreshing = false;

	// Cache
	private cache: string[] = [];
	private cacheW = 0;
	private ver = 0;
	private cacheVer = -1;

	constructor(tui: TUI, theme: Theme, pi: ExtensionAPI, cwd: string, widgets: Widget[], done: () => void) {
		this.tui = tui;
		this.theme = theme;
		this.query = createQuery(pi.events);
		this.cwd = cwd;
		this.widgets = widgets;
		this.done = done;
		const settings = resolveSettings(cwd);
		this.hubUrl = settings.hubUrl;
		this.hubApiKey = settings.hubApiKey;
		this.project = settings.project;
		this.refresh().catch(() => {});
		this.timer = setInterval(() => this.refresh().catch(() => {}), 60000);
	}

	private async refresh(): Promise<void> {
		if (this.disposed) return;
		if (this.paused) return;
		if (this.refreshing) return;
		this.refreshing = true;
		this.loading = true;
		this.ver++;
		if (!this.disposed) this.tui.requestRender();

		const ctx: WidgetContext = {
			query: this.query,
			cwd: this.cwd,
			hubUrl: this.hubUrl,
			hubApiKey: this.hubApiKey,
			project: this.project,
		};
		await Promise.all(this.widgets.map((w) => w.refresh(ctx).catch(() => {})));

		if (this.disposed) {
			this.refreshing = false;
			this.loading = false;
			return;
		}
		this.loading = false;
		this.lastRefresh = Date.now();
		this.ver++;
		this.refreshing = false;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
			this.dispose();
			this.done();
			return;
		}
		if ((matchesKey(data, Key.down) || data === "j") && this.scroll < this.maxScroll) {
			this.scroll++;
			this.ver++;
			this.tui.requestRender();
		}
		if ((matchesKey(data, Key.up) || data === "k") && this.scroll > 0) {
			this.scroll--;
			this.ver++;
			this.tui.requestRender();
		}
		if (data === "r" || data === "R") {
			this.refresh().catch(() => {});
		}
		if (data === "h" || data === "H") {
			this.paused = !this.paused;
			this.ver++;
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		if (width === this.cacheW && this.cacheVer === this.ver) return this.cache;

		const th = this.theme;
		const w = Math.max(24, width);
		const innerW = w - 2;
		const lines: string[] = [];

		const bdr = (c: string) => th.fg("border", c);
		const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
		const row = (s: string) => bdr("│") + padLine(s) + bdr("│");
		const sep = () => bdr("├" + "─".repeat(innerW) + "┤");

		// ── Header ──
		const title = th.fg("accent", th.bold(" ◈ PRISM"));
		const spin = this.loading ? th.fg("warning", " ⟳") : "";
		const date = th.fg("muted",
			new Date().toLocaleDateString("en-GB", { timeZone: "Europe/Oslo", weekday: "short", day: "numeric", month: "short" }) + " ",
		);
		const headerGap = Math.max(1, innerW - visibleWidth(title) - visibleWidth(spin) - visibleWidth(date));
		lines.push(bdr("╭" + "─".repeat(innerW) + "╮"));
		lines.push(bdr("│") + truncateToWidth(title + spin + " ".repeat(headerGap) + date, innerW) + bdr("│"));

		// ── Widgets ──
		const SEP_TAG = "\x00SEP";
		const content: string[] = [];
		for (let i = 0; i < this.widgets.length; i++) {
			if (i > 0) content.push(SEP_TAG);
			content.push(th.bold(` ${this.widgets[i].icon} ${th.fg("accent", this.widgets[i].label.toUpperCase())}`));
			const widgetLines = this.widgets[i].render(innerW, th);
			content.push(...widgetLines);
		}

		// Apply scroll — compute visible rows from terminal height so scrolling
		// works on small terminals. Overlay is capped at ~95% of terminal rows;
		// subtract header (2) + footer (4) to get the content viewport.
		const termRows = this.tui.terminal.rows;
		const overlayRows = Math.floor(termRows * 0.95);
		const maxVisible = Math.max(8, overlayRows - 6);
		this.maxScroll = Math.max(0, content.length - maxVisible);
		this.scroll = Math.min(this.scroll, this.maxScroll);
		const visible = content.slice(this.scroll, this.scroll + maxVisible);

		for (const line of visible) {
			if (line === SEP_TAG) {
				lines.push(sep());
			} else {
				lines.push(row(line));
			}
		}

		// ── Footer ──
		lines.push(sep());
		const keys = `${th.fg("muted", "j/k")} scroll ${th.fg("muted", "│ r")} refresh ${th.fg("muted", "│ h")} pause ${th.fg("muted", "│ q")} close`;
		lines.push(row(` ${keys}`));
		if (this.lastRefresh) {
			const pauseStatus = this.paused ? th.fg("warning", " │ PAUSED") : "";
			lines.push(row(` ${th.fg("dim", fmtAgo(this.lastRefresh))} ${th.fg("dim", `· ${this.widgets.length} widgets`)}${pauseStatus}`));
		}
		lines.push(bdr("╰" + "─".repeat(innerW) + "╯"));

		this.cache = lines;
		this.cacheW = width;
		this.cacheVer = this.ver;
		return lines;
	}

	invalidate(): void {
		this.cacheW = 0;
		this.cacheVer = -1;
	}

	/**
	 * Pause the refresh timer — stops background data fetches while hidden.
	 */
	pause(): void {
		this.paused = true;
		this.ver++;
		this.tui.requestRender();
	}

	/**
	 * Resume the refresh timer — restarts data fetches when shown again.
	 */
	resume(): void {
		this.paused = false;
		this.refresh().catch(() => {});
	}

	/**
	 * Stop the refresh timer and release resources.
	 * Does NOT signal the TUI to pop the overlay — use close() for that.
	 */
	dispose(): void {
		this.disposed = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Close the sidebar: stop the timer AND signal the TUI to pop the overlay.
	 * Call this from session_start / session_shutdown instead of dispose()
	 * so the TUI stack stays consistent and no ghost frame is left behind.
	 */
	close(): void {
		this.dispose();
		this.done();
	}
}
