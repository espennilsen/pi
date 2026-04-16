/**
 * Widget registry — all available widgets and their factories.
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Q } from "../helpers.ts";

// ── Widget interface ─────────────────────────────────────────

export interface WidgetContext {
	query: Q;
	cwd: string;
	/** Hub JSON-RPC endpoint (e.g. http://localhost:8080/api/rpc). Null if not configured. */
	hubUrl: string | null;
	/** Hub API key for the X-API-Key header. Null if not configured. */
	hubApiKey: string | null;
	/** Optional project filter for hub task widgets. */
	project: string | null;
}

export interface Widget {
	readonly id: string;
	readonly label: string;
	readonly icon: string;
	refresh(ctx: WidgetContext): Promise<void>;
	render(w: number, th: Theme): string[];
}

// ── Widget imports ───────────────────────────────────────────

import { ActiveTaskWidget } from "./active-task.ts";
import { TaskQueueWidget } from "./task-queue.ts";
import { GitStatusWidget } from "./git-status.ts";
import { TodayCalendarWidget } from "./today-calendar.ts";
import { WeekCalendarWidget } from "./week-calendar.ts";
import { RecentOpsWidget } from "./recent-ops.ts";
import { SystemHealthWidget } from "./system-health.ts";
import { AccountsWidget } from "./accounts.ts";
import { BudgetBarsWidget } from "./budget-bars.ts";
import { RecentTxnsWidget } from "./recent-txns.ts";
import { RemindersWidget } from "./reminders.ts";
import { RecentContactsWidget } from "./recent-contacts.ts";
import { SessionStatsWidget } from "./session-stats.ts";
import { ClockWidget } from "./clock.ts";

// ── Registry ─────────────────────────────────────────────────

export const WIDGET_FACTORIES: Record<string, () => Widget> = {
	"active-task": () => new ActiveTaskWidget(),
	"task-queue": () => new TaskQueueWidget(),
	"git-status": () => new GitStatusWidget(),
	"today-calendar": () => new TodayCalendarWidget(),
	"week-calendar": () => new WeekCalendarWidget(),
	"recent-ops": () => new RecentOpsWidget(),
	"system-health": () => new SystemHealthWidget(),
	accounts: () => new AccountsWidget(),
	"budget-bars": () => new BudgetBarsWidget(),
	"recent-txns": () => new RecentTxnsWidget(),
	reminders: () => new RemindersWidget(),
	"recent-contacts": () => new RecentContactsWidget(),
	"session-stats": () => new SessionStatsWidget(),
	clock: () => new ClockWidget(),
};

export const DEFAULT_WIDGETS = ["active-task", "today-calendar", "recent-ops", "accounts"];
