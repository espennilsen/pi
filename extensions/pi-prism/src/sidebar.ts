/**
 * WidgetSidebar — the main TUI overlay component for Prism.
 *
 * Renders a bordered panel with stacked widgets, handles scrolling,
 * refresh, and keyboard input.
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth, Key } from "@mariozechner/pi-tui";
import { createQuery, fmtAgo, type Q } from "./helpers.ts";
import type { Widget, WidgetContext } from "./widgets/index.ts";

export class WidgetSidebar {
	private tui: TUI;
	private theme: Theme;
	private query: Q;
	private cwd: string;
	private done: () => void;
	private widgets: Widget[] = [];

	private scroll = 0;
	private maxScroll = 0;
	private loading = true;
	private lastRefresh = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private disposed = false;

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
		this.refresh();
		this.timer = setInterval(() => this.refresh(), 60000);
	}

	private async refresh(): Promise<void> {
		if (this.disposed) return;
		this.loading = true;
		this.ver++;
		this.tui.requestRender();

		const ctx: WidgetContext = { query: this.query, cwd: this.cwd };
		await Promise.all(this.widgets.map((w) => w.refresh(ctx).catch(() => {})));

		if (this.disposed) return;
		this.loading = false;
		this.lastRefresh = Date.now();
		this.ver++;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
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
			this.refresh();
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

		// Apply scroll
		const maxVisible = 40;
		this.maxScroll = Math.max(0, content.length - maxVisible);
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
		const keys = `${th.fg("muted", "j/k")} scroll ${th.fg("muted", "│ r")} refresh ${th.fg("muted", "│ q")} close`;
		lines.push(row(` ${keys}`));
		if (this.lastRefresh) {
			lines.push(row(` ${th.fg("dim", fmtAgo(this.lastRefresh))} ${th.fg("dim", `· ${this.widgets.length} widgets`)}`));
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

	dispose(): void {
		this.disposed = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}
}
