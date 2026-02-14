/**
 * pi-myfinance — Extension entry point.
 *
 * Registers the finance tool, commands, and (optionally) web UI.
 *
 * Database backend is configurable:
 *   - Default: local SQLite via better-sqlite3
 *   - Optional: shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Settings:
 *   "pi-myfinance": { "dbPath": "db/finance.db" }  // SQLite (default)
 *   "pi-myfinance": { "useKysely": true }           // pi-kysely shared DB
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import { closeDb } from "./db.ts";
import { getFinanceStore, setFinanceStore, isStoreReady, createSqliteStore, createKyselyStore } from "./store.ts";
import { registerFinanceTool, setToolLogger } from "./tool.ts";
import { createLogger } from "./logger.ts";
import {
	mountOnWebServer,
	isMountedOnWebServer,
	startStandaloneServer,
	stopStandaloneServer,
} from "./web.ts";
import { analyzeBudgetRisk, detectAnomalies } from "./insights.ts";
import { importBankFile } from "./import-bank.ts";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const DEFAULT_DB_PATH = "db/finance.db";

function expandHome(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

function resolveSettings(cwd: string) {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		return {
			...(global?.["pi-myfinance"] ?? {}),
			...(project?.["pi-myfinance"] ?? {}),
		};
	} catch {
		return {};
	}
}

// Re-export for consumers (canonical location is now store.ts)
export { getFinanceStore, setFinanceStore } from "./store.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd) as Record<string, any>;

		if (settings.useKysely) {
			// ── Kysely backend ──────────────────────────────────
			// Handle both orderings: kysely may already be ready,
			// or it may start after us. Probe first, then listen.

			const initKysely = async () => {
				if (isStoreReady()) return;
				try {
					const store = await createKyselyStore(pi.events as any);
					setFinanceStore(store);
					mountOnWebServer(pi.events);
					await processAndNotify();
				} catch (_err: any) {
					// kysely init failed — will retry on kysely:ready
				}
			};

			// Listen for future kysely:ready events
			pi.events.on("kysely:ready", initKysely);

			// Probe: check if pi-kysely is already available
			let kyselyAlreadyReady = false;
			pi.events.emit("kysely:info", {
				reply: () => { kyselyAlreadyReady = true; },
			});
			if (kyselyAlreadyReady) {
				await initKysely();
			}
		} else {
			// ── SQLite backend (default) ────────────────────────
			const agentDir = getAgentDir();
			const configured = settings?.dbPath;
			let dbPath: string;
			if (configured) {
				const expanded = expandHome(String(configured).trim());
				dbPath = path.isAbsolute(expanded) ? expanded : path.resolve(agentDir, expanded);
			} else {
				dbPath = path.join(agentDir, DEFAULT_DB_PATH);
			}

			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
			const store = await createSqliteStore(dbPath);
			setFinanceStore(store);
			mountOnWebServer(pi.events);

			await processAndNotify();
		}
	});

	// Register the finance tool
	const log = createLogger(pi);
	setToolLogger(log);
	registerFinanceTool(pi);

	// Re-mount when pi-webserver starts after us
	pi.events.on("web:ready", () => {
		if (isStoreReady()) mountOnWebServer(pi.events);
	});

	// ── Recurring Transaction Processing ─────────────────────
	// Auto-process due recurring transactions on heartbeat or cron events.
	// Sends notification via pi-channels when transactions are created.

	async function processAndNotify() {
		if (!isStoreReady()) return;
		const store = getFinanceStore();
		const created = await store.processDueRecurring();
		if (created.length === 0) return;

		const lines = created.map(
			(t) => `• ${t.description} — ${Number(t.amount).toLocaleString("nb-NO")} NOK (${t.transaction_type})`,
		);
		const msg = `🔁 Auto-processed ${created.length} recurring transaction(s):\n${lines.join("\n")}`;

		// Notify via pi-channels (Telegram, etc.)
		pi.events.emit("channel:send", {
			route: "ops",
			text: msg,
			source: "pi-myfinance",
		});
	}

	// Process on heartbeat checks (runs periodically when heartbeat is active)
	pi.events.on("heartbeat:complete", () => {
		processAndNotify();
	});

	// Also process on cron job completion targeting finance
	pi.events.on("cron:job_complete", (event: any) => {
		if (event?.job?.name?.includes("finance") || event?.job?.name?.includes("recurring")) {
			processAndNotify();
		}
	});

	// ── Commands ──────────────────────────────────────────────

	pi.registerCommand("finance-web", {
		description: "Start standalone finance web UI (or stop if running)",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "stop", label: "stop — Stop the standalone server" },
				{ value: "status", label: "status — Show finance web status" },
			];
			return items.filter((i) => i.value.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			const arg = args?.trim() ?? "";

			if (arg === "status") {
				const lines: string[] = [];
				if (isMountedOnWebServer()) lines.push("Mounted on pi-webserver at /finance");
				if (lines.length === 0) {
					lines.push("Finance web UI is not running");
					lines.push("Use /finance-web [port] to start standalone, or install pi-webserver");
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (arg === "stop") {
				const was = stopStandaloneServer();
				ctx.ui.notify(was ? "Finance standalone server stopped" : "Not running", "info");
				return;
			}

			const port = parseInt(arg || "4200") || 4200;
			const running = stopStandaloneServer();
			if (running && !arg) {
				ctx.ui.notify("Finance standalone server stopped", "info");
				return;
			}
			const url = startStandaloneServer(port);
			let msg = `Finance web UI: ${url}`;
			if (isMountedOnWebServer()) msg += "\n(Also available via pi-webserver at /finance)";
			ctx.ui.notify(msg, "info");
		},
	});

	pi.registerCommand("finance-process", {
		description: "Process due recurring transactions now",
		handler: async (_args, ctx) => {
			if (!isStoreReady()) {
				ctx.ui.notify("Finance store not initialized", "error");
				return;
			}
			const store = getFinanceStore();
			const created = await store.processDueRecurring();
			if (created.length === 0) {
				ctx.ui.notify("No recurring transactions due", "info");
			} else {
				const lines = created.map(
					(t) => `• ${t.description} — ${Number(t.amount).toLocaleString("nb-NO")} NOK`,
				);
				ctx.ui.notify(`Processed ${created.length} recurring:\n${lines.join("\n")}`, "info");
			}
		},
	});

	pi.registerCommand("finance-summary", {
		description: "Show monthly financial summary",
		handler: async (_args, ctx) => {
			if (!isStoreReady()) {
				ctx.ui.notify("Finance store not initialized", "error");
				return;
			}
			const store = getFinanceStore();
			const now = new Date();
			const summary = await store.getSpendingSummary(now.getFullYear(), now.getMonth() + 1);
			const lines = [
				`💰 Financial Summary — ${summary.period}`,
				`  Income:   ${summary.total_income.toLocaleString("nb-NO")} NOK`,
				`  Expenses: ${summary.total_expenses.toLocaleString("nb-NO")} NOK`,
				`  Net:      ${summary.net.toLocaleString("nb-NO")} NOK`,
			];
			if (summary.by_category.length > 0) {
				lines.push("  Top categories:");
				for (const cat of summary.by_category.slice(0, 5)) {
					lines.push(`    • ${cat.category_name}: ${cat.amount.toLocaleString("nb-NO")} NOK`);
				}
			}

			// Budget alerts
			const risks = await analyzeBudgetRisk(store);
			const atRisk = risks.filter((r) => r.status !== "on_track");
			if (atRisk.length > 0) {
				lines.push("  ⚠️ Budget alerts:");
				for (const r of atRisk) {
					lines.push(`    ${r.status === "over_budget" ? "🔴" : "🟡"} ${r.category_name}: ${r.pct_used}% used`);
				}
			}

			// Anomalies
			const anomalies = await detectAnomalies(store);
			if (anomalies.length > 0) {
				lines.push("  🚨 Unusual spending:");
				for (const a of anomalies.slice(0, 3)) {
					lines.push(`    ${a.category_name}: ${a.deviation_pct}% above average`);
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("finance-import", {
		description: "Import transactions from CSV: /finance-import <path> <account_id>",
		handler: async (args, ctx) => {
			if (!isStoreReady()) {
				ctx.ui.notify("Finance store not initialized", "error");
				return;
			}
			const store = getFinanceStore();
			const parts = args?.trim().split(/\s+/) ?? [];
			if (parts.length < 2) {
				ctx.ui.notify("Usage: /finance-import <path> <account_id>", "error");
				return;
			}

			const filePath = path.resolve(parts[0]);
			const accountId = parseInt(parts[1]);

			if (!fs.existsSync(filePath)) {
				ctx.ui.notify(`File not found: ${filePath}`, "error");
				return;
			}
			if (isNaN(accountId)) {
				ctx.ui.notify("Invalid account_id", "error");
				return;
			}

			const csv = fs.readFileSync(filePath, "utf-8");
			const result = await store.importTransactionsCsv(csv, accountId);
			let msg = `Imported ${result.imported} transaction(s)`;
			if (result.errors.length > 0) {
				msg += `, ${result.errors.length} error(s)`;
			}
			ctx.ui.notify(msg, result.errors.length > 0 ? "warning" : "info");
		},
	});

	pi.registerCommand("finance-export", {
		description: "Export transactions to CSV",
		handler: async (_args, ctx) => {
			if (!isStoreReady()) {
				ctx.ui.notify("Finance store not initialized", "error");
				return;
			}
			const store = getFinanceStore();
			const csv = await store.exportTransactionsCsv();
			const outPath = path.join(process.cwd(), "finance-transactions.csv");
			fs.writeFileSync(outPath, csv, "utf-8");
			const lineCount = csv.split("\n").length - 1;
			ctx.ui.notify(`Exported ${lineCount} transactions to ${outPath}`, "info");
		},
	});

	// ── Read-only commands ────────────────────────────────────

	pi.registerCommand("finance-accounts", {
		description: "List accounts with balances",
		handler: async (_args, ctx) => {
			if (!isStoreReady()) { ctx.ui.notify("Finance store not initialized", "error"); return; }
			const accounts = await getFinanceStore().getAccounts();
			if (accounts.length === 0) { ctx.ui.notify("No accounts.", "info"); return; }

			// Group totals by currency
			const byCurrency = new Map<string, number>();
			for (const a of accounts) {
				const cur = a.currency || "NOK";
				byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + Number(a.balance));
			}
			const totalParts = [...byCurrency.entries()]
				.map(([cur, sum]) => `${sum.toLocaleString("nb-NO")} ${cur}`)
				.join(", ");

			const lines = accounts.map(a =>
				`  ${a.name} (${a.account_type}): ${Number(a.balance).toLocaleString("nb-NO")} ${a.currency || "NOK"}`
			);
			lines.unshift(`💳 **${accounts.length} Account${accounts.length !== 1 ? "s" : ""}** — Total: ${totalParts}`);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("finance-recent", {
		description: "Show recent transactions: /finance-recent [count]",
		handler: async (args, ctx) => {
			if (!isStoreReady()) { ctx.ui.notify("Finance store not initialized", "error"); return; }
			const limit = Math.min(parseInt(args?.trim() || "20") || 20, 100);
			const txs = await getFinanceStore().getTransactions({ limit });
			if (txs.length === 0) { ctx.ui.notify("No transactions.", "info"); return; }

			const lines = [`📋 **Last ${txs.length} transactions:**`, ""];
			for (const t of txs) {
				const sign = t.transaction_type === "in" ? "+" : "-";
				const cat = t.category_name ? ` [${t.category_name}]` : "";
				lines.push(`  ${t.date} ${sign}${Number(t.amount).toLocaleString("nb-NO")} ${t.description}${cat} (${t.account_name ?? "?"})`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("finance-search", {
		description: "Search transactions: /finance-search <query>",
		handler: async (args, ctx) => {
			if (!isStoreReady()) { ctx.ui.notify("Finance store not initialized", "error"); return; }
			const query = args?.trim();
			if (!query) { ctx.ui.notify("Usage: /finance-search <query>", "error"); return; }

			const txs = await getFinanceStore().searchTransactions(query, 30);
			if (txs.length === 0) { ctx.ui.notify(`No transactions matching "${query}".`, "info"); return; }

			const lines = [`🔍 **${txs.length} result${txs.length !== 1 ? "s" : ""} for "${query}":**`, ""];
			for (const t of txs) {
				const sign = t.transaction_type === "in" ? "+" : "-";
				lines.push(`  ${t.date} ${sign}${Number(t.amount).toLocaleString("nb-NO")} ${t.description} (${t.account_name ?? "?"})`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("finance-budgets", {
		description: "Show budget status for current month",
		handler: async (_args, ctx) => {
			if (!isStoreReady()) { ctx.ui.notify("Finance store not initialized", "error"); return; }
			const now = new Date();
			const budgets = await getFinanceStore().getBudgetStatus(now.getFullYear(), now.getMonth() + 1);
			if (budgets.length === 0) { ctx.ui.notify("No budgets configured.", "info"); return; }

			const month = now.toLocaleString("en", { month: "long", year: "numeric" });
			const lines = [`📊 **Budget Status — ${month}:**`, ""];
			for (const b of budgets) {
				const spent = Number(b.spent ?? 0);
				const amount = Number(b.amount);
				const pct = amount > 0 ? Math.round((spent / amount) * 100) : 0;
				const icon = pct > 100 ? "🔴" : pct > 80 ? "🟡" : "🟢";
				lines.push(`  ${icon} ${b.category_name ?? "?"}: ${spent.toLocaleString("nb-NO")} / ${amount.toLocaleString("nb-NO")} NOK (${pct}%)`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("finance-goals", {
		description: "Show financial goals and progress",
		handler: async (_args, ctx) => {
			if (!isStoreReady()) { ctx.ui.notify("Finance store not initialized", "error"); return; }
			const goals = await getFinanceStore().getGoals();
			if (goals.length === 0) { ctx.ui.notify("No financial goals.", "info"); return; }

			const lines = [`🎯 **Financial Goals:**`, ""];
			for (const g of goals) {
				const current = Number(g.current_amount);
				const target = Number(g.target_amount);
				const pct = target > 0 ? Math.round((current / target) * 100) : 0;
				const icon = g.status === "completed" ? "✅" : g.status === "cancelled" ? "❌" : pct >= 80 ? "🟢" : pct >= 40 ? "🟡" : "⚪";
				const deadline = g.deadline ? ` (deadline: ${g.deadline})` : "";
				lines.push(`  ${icon} ${g.name}: ${current.toLocaleString("nb-NO")} / ${target.toLocaleString("nb-NO")} NOK (${pct}%)${deadline}`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("finance-recurring", {
		description: "Show upcoming recurring transactions",
		handler: async (_args, ctx) => {
			if (!isStoreReady()) { ctx.ui.notify("Finance store not initialized", "error"); return; }
			const recurring = await getFinanceStore().getUpcomingRecurring(30);
			if (recurring.length === 0) { ctx.ui.notify("No upcoming recurring transactions.", "info"); return; }

			const lines = [`🔁 **Upcoming Recurring (next 30 days):**`, ""];
			for (const r of recurring) {
				const sign = r.transaction_type === "in" ? "+" : "-";
				lines.push(`  ${r.next_date} ${sign}${Number(r.amount).toLocaleString("nb-NO")} ${r.description} (${r.frequency}, ${r.account_name ?? "?"})`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("finance-trend", {
		description: "Show monthly income/expense trend: /finance-trend [months]",
		handler: async (args, ctx) => {
			if (!isStoreReady()) { ctx.ui.notify("Finance store not initialized", "error"); return; }
			const months = Math.min(parseInt(args?.trim() || "6") || 6, 24);
			const trend = await getFinanceStore().getMonthlyTrend(months);
			if (trend.length === 0) { ctx.ui.notify("No transaction data.", "info"); return; }

			const lines = [`📈 **Monthly Trend (last ${trend.length} months):**`, ""];
			for (const m of trend) {
				const netIcon = m.net >= 0 ? "🟢" : "🔴";
				lines.push(`  ${m.month}: In ${Number(m.income).toLocaleString("nb-NO")} · Out ${Number(m.expenses).toLocaleString("nb-NO")} · ${netIcon} Net ${Number(m.net).toLocaleString("nb-NO")}`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("finance-categories", {
		description: "List spending categories",
		handler: async (_args, ctx) => {
			if (!isStoreReady()) { ctx.ui.notify("Finance store not initialized", "error"); return; }
			const now = new Date();
			const breakdown = await getFinanceStore().getCategoryBreakdown(now.getFullYear(), now.getMonth() + 1);
			if (breakdown.length === 0) { ctx.ui.notify("No spending this month.", "info"); return; }

			const month = now.toLocaleString("en", { month: "long", year: "numeric" });
			const lines = [`📂 **Spending by Category — ${month}:**`, ""];
			for (const c of breakdown) {
				lines.push(`  ${c.category_name}: ${Number(c.amount).toLocaleString("nb-NO")} NOK (${c.percentage}%, ${c.transaction_count} txns)`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ── Bank statement import ────────────────────────────────

	pi.registerCommand("finance-import-bank", {
		description: "Import bank statement: /finance-import-bank <path> <account-name>. Auto-detects DNB, SAS Mastercard, Amex formats.",
		handler: async (args, ctx) => {
			if (!isStoreReady()) { ctx.ui.notify("Finance store not initialized", "error"); return; }

			const argStr = args?.trim() ?? "";
			// Parse: path can be quoted, account name is the rest
			let filePath: string;
			let accountName: string;

			const quotedMatch = argStr.match(/^"([^"]+)"\s+(.+)$/);
			const singleQuotedMatch = argStr.match(/^'([^']+)'\s+(.+)$/);
			if (quotedMatch) {
				filePath = quotedMatch[1];
				accountName = quotedMatch[2].trim();
			} else if (singleQuotedMatch) {
				filePath = singleQuotedMatch[1];
				accountName = singleQuotedMatch[2].trim();
			} else {
				const parts = argStr.split(/\s+/);
				if (parts.length < 2) {
					ctx.ui.notify('Usage: /finance-import-bank <path> <account-name>\nExample: /finance-import-bank ~/Downloads/transactions.xlsx "DNB Brukskonto"', "error");
					return;
				}
				filePath = parts[0];
				accountName = parts.slice(1).join(" ");
			}

			// Strip surrounding quotes from account name (user may quote it)
			accountName = accountName.replace(/^["']|["']$/g, "");

			filePath = expandHome(filePath);
			if (!path.isAbsolute(filePath)) filePath = path.resolve(filePath);

			if (!fs.existsSync(filePath)) {
				ctx.ui.notify(`File not found: ${filePath}`, "error");
				return;
			}

			ctx.ui.notify(`Importing ${path.basename(filePath)} into "${accountName}"…`, "info");

			try {
				const result = await importBankFile(getFinanceStore(), filePath, accountName, { skipDuplicates: true });
				const lines = [
					`✅ Import complete: ${result.account_name}`,
					`  Imported: ${result.imported} · Skipped: ${result.skipped} · Categorized: ${result.categorized}`,
				];
				if (result.linked > 0) lines.push(`  Linked transfers: ${result.linked}`);
				if (result.errors.length > 0) {
					lines.push(`  ⚠️ ${result.errors.length} error(s):`);
					for (const e of result.errors.slice(0, 5)) lines.push(`    - ${e}`);
					if (result.errors.length > 5) lines.push(`    … and ${result.errors.length - 5} more`);
				}
				ctx.ui.notify(lines.join("\n"), result.errors.length > 0 ? "warning" : "info");
			} catch (err: any) {
				ctx.ui.notify(`❌ Import failed: ${err.message}`, "error");
			}
		},
	});

	// ── Cleanup ──────────────────────────────────────────────

	pi.on("session_shutdown", async () => {
		stopStandaloneServer();
		closeDb();
		setFinanceStore(null);
	});
}
