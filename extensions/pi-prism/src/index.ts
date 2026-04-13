/**
 * pi-prism — Configurable widget sidebar overlay for pi.
 *
 * Right-anchored overlay (34% width) with a stack of user-chosen widgets.
 * Auto-opens on session start; toggle with /prism or Ctrl+Shift+P.
 *
 * Configure via .pi/settings.json:
 *   { "pi-prism": { "widgets": ["active-task", "today-calendar", "git-status", ...] } }
 *
 * Available widgets:
 *   active-task, task-queue, git-status, today-calendar, week-calendar,
 *   recent-ops, system-health, accounts, budget-bars, recent-txns,
 *   reminders, recent-contacts, session-stats, clock
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { OverlayHandle, TUI } from "@mariozechner/pi-tui";
import { Key } from "@mariozechner/pi-tui";
import { resolveSettings, type PrismSettings } from "./settings.ts";
import { WidgetSidebar } from "./sidebar.ts";
import { WIDGET_FACTORIES, DEFAULT_WIDGETS, type Widget } from "./widgets/index.ts";

const ACTOR = "pi-prism";

export default function (pi: ExtensionAPI) {
	// ── DB access grants (read-only, scoped to needed tables) ─────────────
	//
	// Enumerate exactly the tables each widget reads. A wildcard owner/table
	// grant would expose vault credentials, auth tokens, and private notes.

	const PRISM_GRANTS: { owner: string; tables: string[] }[] = [
		{ owner: "pi-jobs",         tables: ["jobs", "tool_calls"] },
		{ owner: "pi-myfinance",    tables: ["finance_transactions", "finance_accounts", "finance_budgets", "finance_categories", "finance_vendors"] },
		{ owner: "pi-personal-crm", tables: ["crm_contacts", "crm_companies", "crm_reminders"] },
		{ owner: "pi-calendar",     tables: ["calendar_events"] },
	];

	for (const { owner, tables } of PRISM_GRANTS) {
		for (const table of tables) {
			pi.events.emit("kysely:grant", {
				owner,
				grantee: ACTOR,
				table,
				operations: ["select"],
			});
		}
	}

	let overlayHandle: OverlayHandle | null = null;
	let isOpen = false;
	/** Reference to the live sidebar instance — needed to dispose its timer on session end. */
	let liveSidebar: import("./sidebar.ts").WidgetSidebar | null = null;
	/** Auto-open timer — stored so it can be cancelled if session_shutdown fires first. */
	let autoOpenTimer: ReturnType<typeof setTimeout> | null = null;

	// ── Build widgets from settings ──────────────────────────

	function buildWidgets(settings: PrismSettings): Widget[] {
		const ids = settings.widgets.length > 0
			? settings.widgets.filter((id) => id in WIDGET_FACTORIES)
			: DEFAULT_WIDGETS;

		const widgets: Widget[] = [];
		for (const id of ids) {
			const factory = WIDGET_FACTORIES[id];
			if (factory) widgets.push(factory());
		}
		return widgets;
	}

	// ── Toggle sidebar ───────────────────────────────────────

	async function toggle(ctx: { hasUI: boolean; ui: any }) {
		if (!ctx.hasUI) return;

		// Toggle if already exists
		if (overlayHandle && isOpen) {
			overlayHandle.setHidden(true);
			isOpen = false;
			return;
		}
		if (overlayHandle && !isOpen) {
			overlayHandle.setHidden(false);
			isOpen = true;
			return;
		}

		const cwd = process.cwd();
		const settings = resolveSettings(cwd);
		const widgets = buildWidgets(settings);

		if (widgets.length === 0) return;

		ctx.ui.custom(
			(tui: TUI, theme: any, _kb: unknown, done: (v: undefined) => void) => {
				const sidebar = new WidgetSidebar(tui, theme, pi, cwd, widgets, () => {
					isOpen = false;
					done(undefined);
					overlayHandle = null;
					liveSidebar = null;
				});
				liveSidebar = sidebar;
				return sidebar;
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "right-center" as const,
					width: "34%",
					minWidth: 28,
					maxHeight: "95%",
					margin: { right: 1, top: 1, bottom: 1 },
					visible: (termWidth: number) => termWidth >= 90,
				},
				onHandle: (handle: OverlayHandle) => {
					overlayHandle = handle;
					isOpen = true;
				},
			},
		);
	}

	// ── Auto-launch on session start ─────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Cancel any pending auto-open from a previous session
		if (autoOpenTimer) { clearTimeout(autoOpenTimer); autoOpenTimer = null; }
		// Close any sidebar that survived from a previous session.
		// close() calls both dispose() (stops the timer) and done() (pops the
		// TUI overlay stack) so no ghost frame accumulates on restart.
		if (liveSidebar) {
			liveSidebar.close();
			liveSidebar = null;
			overlayHandle = null;
			isOpen = false;
		}
		if (!ctx.hasUI) return;
		const settings = resolveSettings(process.cwd());
		if (!settings.autoOpen) return;
		autoOpenTimer = setTimeout(() => { autoOpenTimer = null; toggle(ctx); }, 800);
	});

	// ── Dispose sidebar on session shutdown to stop the refresh timer ─

	pi.on("session_shutdown", async () => {
		if (autoOpenTimer) { clearTimeout(autoOpenTimer); autoOpenTimer = null; }
		if (liveSidebar) {
			liveSidebar.close();
			liveSidebar = null;
			overlayHandle = null;
			isOpen = false;
		}
	});

	// ── Command & shortcut ───────────────────────────────────

	pi.registerCommand("prism", {
		description: "Toggle Prism widget sidebar",
		handler: async (_args, ctx) => toggle(ctx),
	});

	pi.registerShortcut(Key.ctrlShift("p"), {
		description: "Toggle Prism sidebar",
		handler: async (ctx) => toggle(ctx),
	});
}
