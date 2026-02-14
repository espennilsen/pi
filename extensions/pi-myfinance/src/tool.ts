/**
 * pi-myfinance — Pi Tool: finance operations.
 *
 * Conversational finance tracking accessible from Pi agent prompts.
 */

import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { getFinanceStore } from "./store.ts";
import { generateInsights, analyzeTrends, autoCategorize } from "./insights.ts";
import { importBankFile, importBankDirectory } from "./import-bank.ts";
import type { TransactionFilters, GoalStatus } from "./types.ts";

let log: ((event: string, data: unknown, level?: string) => void) | null = null;

export function setToolLogger(logger: (event: string, data: unknown, level?: string) => void) {
	log = logger;
}

interface ExtensionAPI {
	registerTool(tool: any): void;
	on(event: string, handler: (...args: any[]) => any): void;
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }], details: {} });

export function registerFinanceTool(pi: ExtensionAPI): void {
	// ── System prompt injection ───────────────────────────────

	pi.on("before_agent_start", async (event: any) => {
		return {
			systemPrompt:
				event.systemPrompt +
				"\n\n---\n\n" +
				"## Finance Tool\n\n" +
				"You have access to a personal finance tracker via the `finance` tool.\n\n" +
				"**Common workflows:**\n" +
				'- "How much did I spend this month?" → finance.spending_summary\n' +
				'- "Add a transaction" → finance.add_transaction\n' +
				'- "Show my accounts" → finance.list_accounts\n' +
				'- "Am I on budget?" → finance.budget_status\n' +
				'- "How are my goals?" → finance.list_goals\n\n' +
				"**Actions:**\n" +
				"- list_accounts, add_account, update_account, delete_account\n" +
				"- list_transactions, add_transaction, update_transaction, delete_transaction, search_transactions\n" +
				"- list_categories, add_category\n" +
				"- list_budgets, set_budget, budget_status\n" +
				"- list_goals, add_goal, update_goal, goal_progress\n" +
				"- list_recurring, add_recurring, process_recurring, upcoming_recurring\n" +
				"- list_vendors, add_vendor, update_vendor, delete_vendor\n" +
				"- spending_summary, category_breakdown, insights, trend_analysis, auto_categorize\n" +
				"- import_csv, export_csv\n\n" +
				"**Transaction types:** in, out\n" +
				"**Account types:** checking, savings, credit, cash, investment\n" +
				"**Goal types:** savings, debt, purchase\n" +
				"Amounts are in the account's currency (default NOK). Use positive numbers — type determines direction.",
		};
	});

	pi.registerTool({
		name: "finance",
		label: "Finance",
		description: "Track personal finances: accounts, transactions, budgets, goals, recurring expenses.",
		parameters: Type.Object({
			action: StringEnum(
				[
					"list_accounts", "add_account", "update_account", "delete_account",
					"list_transactions", "add_transaction", "update_transaction", "delete_transaction", "search_transactions",
					"list_categories", "add_category",
					"list_budgets", "set_budget", "budget_status",
					"list_goals", "add_goal", "update_goal", "goal_progress",
					"list_recurring", "add_recurring", "update_recurring", "delete_recurring", "process_recurring", "upcoming_recurring",
					"list_vendors", "add_vendor", "update_vendor", "delete_vendor",
					"spending_summary", "category_breakdown",
					"insights", "trend_analysis", "auto_categorize",
					"import_bank", "import_bank_directory",
					"import_csv", "export_csv",
				] as const,
				{ description: "Finance action to perform" },
			),

			// IDs
			id: Type.Optional(Type.Number({ description: "Entity ID (for update/delete actions)" })),
			account_id: Type.Optional(Type.Number({ description: "Account ID" })),
			category_id: Type.Optional(Type.Number({ description: "Category ID" })),

			vendor_id: Type.Optional(Type.Number({ description: "Vendor ID (for transactions)" })),

			// Account fields
			name: Type.Optional(Type.String({ description: "Name (account, category, or goal)" })),
			account_type: Type.Optional(
				StringEnum(["checking", "savings", "credit", "cash", "investment"] as const, {
					description: "Account type",
				}),
			),
			currency: Type.Optional(Type.String({ description: "Currency code (e.g. NOK, USD, EUR)" })),
			country: Type.Optional(Type.String({ description: "Country code ISO 3166-1 alpha-2 (e.g. NO, US, SE) — for vendors" })),
			balance: Type.Optional(Type.Number({ description: "Account balance" })),

			// Transaction fields
			amount: Type.Optional(Type.Number({ description: "Amount (always positive)" })),
			transaction_type: Type.Optional(
				StringEnum(["in", "out"] as const, {
					description: "Transaction type",
				}),
			),
			description: Type.Optional(Type.String({ description: "Transaction description" })),
			date: Type.Optional(Type.String({ description: "Date (YYYY-MM-DD)" })),
			tags: Type.Optional(Type.Array(Type.String(), { description: "Tags" })),
			notes: Type.Optional(Type.String({ description: "Notes" })),

			// Category fields
			parent_id: Type.Optional(Type.Number({ description: "Parent category ID" })),
			category_type: Type.Optional(
				StringEnum(["income", "expense", "both"] as const, {
					description: "Category type",
				}),
			),
			icon: Type.Optional(Type.String({ description: "Category icon (emoji)" })),

			// Budget fields
			period: Type.Optional(
				StringEnum(["monthly", "annual"] as const, { description: "Budget period" }),
			),
			month: Type.Optional(Type.Number({ description: "Month (1-12)" })),
			year: Type.Optional(Type.Number({ description: "Year" })),

			// Goal fields
			goal_type: Type.Optional(
				StringEnum(["savings", "debt", "purchase"] as const, {
					description: "Goal type",
				}),
			),
			target_amount: Type.Optional(Type.Number({ description: "Goal target amount" })),
			current_amount: Type.Optional(Type.Number({ description: "Goal current amount" })),
			deadline: Type.Optional(Type.String({ description: "Goal deadline (YYYY-MM-DD)" })),
			status: Type.Optional(
				StringEnum(["active", "completed", "cancelled"] as const, {
					description: "Goal status",
				}),
			),

			// Recurring fields
			frequency: Type.Optional(
				StringEnum(["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"] as const, {
					description: "Recurring frequency",
				}),
			),
			next_date: Type.Optional(Type.String({ description: "Next date for recurring (YYYY-MM-DD)" })),
			active: Type.Optional(Type.Boolean({ description: "Whether recurring is active" })),

			// Vendor fields
			ignore: Type.Optional(Type.Boolean({ description: "Mark vendor as ignored (hidden from default lists)" })),
			include_ignored: Type.Optional(Type.Boolean({ description: "Include ignored vendors in list_vendors (default: false)" })),

			// Filters
			date_from: Type.Optional(Type.String({ description: "Filter: start date (YYYY-MM-DD)" })),
			date_to: Type.Optional(Type.String({ description: "Filter: end date (YYYY-MM-DD)" })),
			query: Type.Optional(Type.String({ description: "Search query" })),
			limit: Type.Optional(Type.Number({ description: "Max results" })),

			// Bank import
			file_path: Type.Optional(Type.String({ description: "File or directory path for bank import" })),
			dry_run: Type.Optional(Type.Boolean({ description: "Preview import without saving" })),

			// CSV
			csv_data: Type.Optional(Type.String({ description: "CSV text to import" })),
		}),
		execute: async (_toolCallId: string, params: any) => {
			try {
				const store = getFinanceStore();

				const action = params.action as string;

				if (!action) {
					log?.("missing_action", { raw: JSON.stringify(params).slice(0, 200) }, "DEBUG");
					return text(
						"❌ Missing required parameter: `action`.\n\n" +
						"**Usage:** `finance({ action: \"list_accounts\" })`\n\n" +
						"**Read-only actions:** list_accounts, list_transactions, search_transactions, spending_summary, " +
						"category_breakdown, budget_status, list_goals, goal_progress, list_recurring, upcoming_recurring, " +
						"insights, trend_analysis\n\n" +
						"**Write actions:** add_account, add_transaction, set_budget, add_goal, add_recurring, auto_categorize\n\n" +
						"**Import/Export:** import_bank, import_bank_directory, import_csv, export_csv",
					);
				}

				switch (action) {
					// ── Accounts ──────────────────────────────

					case "list_accounts": {
						const accounts = await store.getAccounts();
						if (accounts.length === 0) return text("No accounts yet. Use add_account to create one.");
						const lines = accounts.map(
							(a) => `• **${a.name}** (${a.account_type}) — ${formatAmount(a.balance, a.currency)}`,
						);
						// Group totals by currency to avoid summing across different currencies
						const byCurrency = new Map<string, number>();
						for (const a of accounts) {
							const cur = a.currency || "NOK";
							byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + a.balance);
						}
						const totalParts = [...byCurrency.entries()]
							.map(([cur, sum]) => formatAmount(sum, cur))
							.join(", ");
						lines.push(`\n**Total:** ${totalParts}`);
						return text(`📊 **Accounts (${accounts.length})**\n\n${lines.join("\n")}`);
					}

					case "add_account": {
						if (!params.name) return text("❌ name is required");
						if (!params.account_type) return text("❌ account_type is required (checking/savings/credit/cash/investment)");
						const account = await store.createAccount({
							name: params.name,
							account_type: params.account_type,
							currency: params.currency,
							balance: params.balance,
							notes: params.notes,
						});
						return text(`✅ Created account **${account.name}** (${account.account_type}) — ${formatAmount(account.balance, account.currency)}`);
					}

					case "update_account": {
						if (!params.id) return text("❌ id is required");
						const updated = await store.updateAccount(params.id, {
							name: params.name,
							account_type: params.account_type,
							currency: params.currency,
							balance: params.balance,
							notes: params.notes,
						});
						if (!updated) return text("❌ Account not found");
						return text(`✅ Updated account **${updated.name}** — ${formatAmount(updated.balance, updated.currency)}`);
					}

					case "delete_account": {
						if (!params.id) return text("❌ id is required");
						const account = await store.getAccount(params.id);
						if (!account) return text("❌ Account not found");
						await store.deleteAccount(params.id);
						return text(`🗑️ Deleted account **${account.name}**`);
					}

					// ── Transactions ──────────────────────────

					case "list_transactions": {
						const filters: TransactionFilters = {
							account_id: params.account_id,
							category_id: params.category_id,
							transaction_type: params.transaction_type,
							date_from: params.date_from,
							date_to: params.date_to,
							search: params.query,
							limit: params.limit ?? 20,
						};
						const txs = await store.getTransactions(filters);
						if (txs.length === 0) return text("No transactions found.");
						const lines = txs.map((t) => {
							const icon = t.transaction_type === "in" ? "💚" : "🔴";
							return `${icon} ${t.date} | ${formatAmount(t.amount)} | ${t.description}${t.category_name ? ` [${t.category_name}]` : ""}`;
						});
						return text(`💳 **Transactions (${txs.length})**\n\n${lines.join("\n")}`);
					}

					case "add_transaction": {
						if (!params.account_id) return text("❌ account_id is required");
						if (!params.amount) return text("❌ amount is required");
						if (!params.transaction_type) return text("❌ transaction_type is required (in/out)");
						if (!params.description) return text("❌ description is required");
						const tx = await store.createTransaction({
							account_id: params.account_id,
							category_id: params.category_id,
							vendor_id: params.vendor_id,
							amount: params.amount,
							transaction_type: params.transaction_type,
							description: params.description,
							date: params.date,
							tags: params.tags,
							notes: params.notes,
						});
						const icon = tx.transaction_type === "in" ? "💚" : "🔴";
						return text(`${icon} Added: ${formatAmount(tx.amount)} ${tx.transaction_type} — "${tx.description}" on ${tx.date}`);
					}

					case "update_transaction": {
						if (!params.id) return text("❌ id is required");
						const updated = await store.updateTransaction(params.id, {
							account_id: params.account_id,
							category_id: params.category_id,
							vendor_id: params.vendor_id,
							amount: params.amount,
							transaction_type: params.transaction_type,
							description: params.description,
							date: params.date,
							tags: params.tags,
							notes: params.notes,
						});
						if (!updated) return text("❌ Transaction not found");
						return text(`✅ Updated transaction #${updated.id}: ${formatAmount(updated.amount)} ${updated.transaction_type} — "${updated.description}"`);
					}

					case "delete_transaction": {
						if (!params.id) return text("❌ id is required");
						const tx = await store.getTransaction(params.id);
						if (!tx) return text("❌ Transaction not found");
						await store.deleteTransaction(params.id);
						return text(`🗑️ Deleted transaction: ${formatAmount(tx.amount)} ${tx.transaction_type} — "${tx.description}"`);
					}

					case "search_transactions": {
						if (!params.query) return text("❌ query is required");
						const results = await store.searchTransactions(params.query, params.limit);
						if (results.length === 0) return text(`No transactions matching "${params.query}"`);
						const lines = results.map((t) => {
							const icon = t.transaction_type === "in" ? "💚" : "🔴";
							return `${icon} ${t.date} | ${formatAmount(t.amount)} | ${t.description}`;
						});
						return text(`🔍 **Search: "${params.query}" (${results.length} results)**\n\n${lines.join("\n")}`);
					}

					// ── Categories ────────────────────────────

					case "list_categories": {
						const cats = await store.getCategories();
						const topLevel = cats.filter((c) => !c.parent_id);
						const lines: string[] = [];
						for (const cat of topLevel) {
							lines.push(`${cat.icon ?? "📁"} **${cat.name}** (${cat.category_type}) — id:${cat.id}`);
							const children = cats.filter((c) => c.parent_id === cat.id);
							for (const child of children) {
								lines.push(`  ${child.icon ?? "  "} ${child.name} — id:${child.id}`);
							}
						}
						return text(`📁 **Categories (${cats.length})**\n\n${lines.join("\n")}`);
					}

					case "add_category": {
						if (!params.name) return text("❌ name is required");
						const cat = await store.createCategory({
							name: params.name,
							parent_id: params.parent_id,
							icon: params.icon,
							category_type: params.category_type,
						});
						return text(`✅ Created category ${cat.icon ?? ""} **${cat.name}** (id:${cat.id})`);
					}

					// ── Budgets ───────────────────────────────

					case "list_budgets": {
						const budgets = await store.getBudgets(params.year, params.month);
						if (budgets.length === 0) return text("No budgets set. Use set_budget to create one.");
						const lines = budgets.map(
							(b) => `• **${b.category_name}** — ${formatAmount(b.amount)}/${b.period}${b.month ? ` (month ${b.month})` : ""}`,
						);
						return text(`📊 **Budgets (${budgets.length})**\n\n${lines.join("\n")}`);
					}

					case "set_budget": {
						if (!params.category_id) return text("❌ category_id is required");
						if (!params.amount) return text("❌ amount is required");
						const budget = await store.createBudget({
							category_id: params.category_id,
							amount: params.amount,
							period: params.period,
							month: params.month,
							year: params.year,
						});
						return text(`✅ Budget set: **${budget.category_name}** — ${formatAmount(budget.amount)}/${budget.period}`);
					}

					case "budget_status": {
						const now = new Date();
						const y = params.year ?? now.getFullYear();
						const m = params.month ?? now.getMonth() + 1;
						const budgets = await store.getBudgetStatus(y, m);
						if (budgets.length === 0) return text(`No budgets for ${y}-${String(m).padStart(2, "0")}.`);
						const lines = budgets.map((b) => {
							const spent = b.spent ?? 0;
							const pct = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0;
							const bar = progressBar(pct);
							const status = pct > 100 ? "🔴 OVER" : pct > 80 ? "🟡" : "🟢";
							return `${status} **${b.category_name}**: ${formatAmount(spent)} / ${formatAmount(b.amount)} (${pct}%) ${bar}`;
						});
						return text(`📊 **Budget Status — ${y}-${String(m).padStart(2, "0")}**\n\n${lines.join("\n")}`);
					}

					// ── Goals ─────────────────────────────────

					case "list_goals": {
						const goals = await store.getGoals(params.status as GoalStatus | undefined);
						if (goals.length === 0) return text("No goals yet. Use add_goal to create one.");
						const lines = goals.map((g) => {
							const pct = g.target_amount > 0 ? Math.round((g.current_amount / g.target_amount) * 100) : 0;
							const bar = progressBar(pct);
							const statusIcon = g.status === "completed" ? "✅" : g.status === "cancelled" ? "❌" : "🎯";
							return `${statusIcon} **${g.name}** (${g.goal_type}): ${formatAmount(g.current_amount)} / ${formatAmount(g.target_amount)} (${pct}%) ${bar}${g.deadline ? ` — deadline: ${g.deadline}` : ""}`;
						});
						return text(`🎯 **Goals (${goals.length})**\n\n${lines.join("\n")}`);
					}

					case "add_goal": {
						if (!params.name) return text("❌ name is required");
						if (!params.goal_type) return text("❌ goal_type is required (savings/debt/purchase)");
						if (!params.target_amount) return text("❌ target_amount is required");
						const goal = await store.createGoal({
							name: params.name,
							goal_type: params.goal_type,
							target_amount: params.target_amount,
							current_amount: params.current_amount,
							deadline: params.deadline,
							notes: params.notes,
						});
						return text(`🎯 Created goal **${goal.name}**: ${formatAmount(0)} / ${formatAmount(goal.target_amount)}${goal.deadline ? ` — by ${goal.deadline}` : ""}`);
					}

					case "update_goal": {
						if (!params.id) return text("❌ id is required");
						const updated = await store.updateGoal(params.id, {
							name: params.name,
							goal_type: params.goal_type,
							target_amount: params.target_amount,
							current_amount: params.current_amount,
							deadline: params.deadline,
							status: params.status,
							notes: params.notes,
						});
						if (!updated) return text("❌ Goal not found");
						const pct = updated.target_amount > 0 ? Math.round((updated.current_amount / updated.target_amount) * 100) : 0;
						return text(`✅ Updated goal **${updated.name}**: ${formatAmount(updated.current_amount)} / ${formatAmount(updated.target_amount)} (${pct}%)`);
					}

					case "goal_progress": {
						const goals = await store.getGoals("active");
						if (goals.length === 0) return text("No active goals.");
						const lines = goals.map((g) => {
							const pct = g.target_amount > 0 ? Math.round((g.current_amount / g.target_amount) * 100) : 0;
							const remaining = g.target_amount - g.current_amount;
							let projection = "";
							if (g.deadline) {
								const daysLeft = Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000);
								if (daysLeft > 0 && remaining > 0) {
									const perDay = remaining / daysLeft;
									const perMonth = perDay * 30;
									projection = ` — need ${formatAmount(perMonth)}/month to reach by ${g.deadline}`;
								}
							}
							return `🎯 **${g.name}**: ${formatAmount(g.current_amount)} / ${formatAmount(g.target_amount)} (${pct}%) ${progressBar(pct)}${projection}`;
						});
						return text(`🎯 **Goal Progress**\n\n${lines.join("\n")}`);
					}

					// ── Recurring ─────────────────────────────

					case "list_recurring": {
						const items = await store.getRecurring(params.active !== false);
						if (items.length === 0) return text("No recurring transactions.");
						const lines = items.map((r) => {
							const icon = r.transaction_type === "in" ? "💚" : "🔴";
							const activeStr = r.active ? "" : " [PAUSED]";
							return `${icon} **${r.description}** — ${formatAmount(r.amount)} ${r.frequency}, next: ${r.next_date}${activeStr}`;
						});
						return text(`🔁 **Recurring (${items.length})**\n\n${lines.join("\n")}`);
					}

					case "add_recurring": {
						if (!params.account_id) return text("❌ account_id is required");
						if (!params.amount) return text("❌ amount is required");
						if (!params.transaction_type) return text("❌ transaction_type is required");
						if (!params.description) return text("❌ description is required");
						if (!params.frequency) return text("❌ frequency is required");
						if (!params.next_date) return text("❌ next_date is required (YYYY-MM-DD)");
						const rec = await store.createRecurring({
							account_id: params.account_id,
							category_id: params.category_id,
							amount: params.amount,
							transaction_type: params.transaction_type,
							description: params.description,
							frequency: params.frequency,
							next_date: params.next_date,
						});
						return text(`🔁 Created recurring: **${rec.description}** — ${formatAmount(rec.amount)} ${rec.frequency}, next: ${rec.next_date}`);
					}

					case "update_recurring": {
						if (!params.id) return text("❌ id is required");
						const updated = await store.updateRecurring(params.id, {
							account_id: params.account_id,
							category_id: params.category_id,
							amount: params.amount,
							transaction_type: params.transaction_type,
							description: params.description,
							frequency: params.frequency,
							next_date: params.next_date,
							active: params.active,
						});
						if (!updated) return text("❌ Recurring transaction not found");
						return text(`✅ Updated recurring: **${updated.description}** — ${formatAmount(updated.amount)} ${updated.frequency}`);
					}

					case "delete_recurring": {
						if (!params.id) return text("❌ id is required");
						if (!await store.deleteRecurring(params.id)) return text("❌ Recurring transaction not found");
						return text("🗑️ Deleted recurring transaction");
					}

					case "process_recurring": {
						const created = await store.processDueRecurring();
						if (created.length === 0) return text("No recurring transactions due today.");
						const lines = created.map(
							(t) => `• ${t.description} — ${formatAmount(t.amount)} ${t.transaction_type}`,
						);
						return text(`🔁 **Processed ${created.length} recurring transaction(s)**\n\n${lines.join("\n")}`);
					}

					case "upcoming_recurring": {
						const days = params.limit ?? 30;
						const upcoming = await store.getUpcomingRecurring(days);
						if (upcoming.length === 0) return text(`No recurring transactions due in the next ${days} days.`);
						const lines = upcoming.map((r) => {
							const icon = r.transaction_type === "in" ? "💚" : "🔴";
							return `${icon} ${r.next_date} | **${r.description}** — ${formatAmount(r.amount)} (${r.frequency})`;
						});
						return text(`🔁 **Upcoming Recurring (next ${days} days)**\n\n${lines.join("\n")}`);
					}

					// ── Vendors ───────────────────────────────

					case "list_vendors": {
						const vendors = await store.getVendors(params.include_ignored ?? false);
						if (vendors.length === 0) return text("No vendors found. Use `add_vendor` to create one.");
						const lines = vendors.map(
							(v) => `• **${v.name}**${v.country ? ` (${v.country})` : ""}${v.category_name ? ` → ${v.category_name}` : ""}${v.ignore ? " 🚫" : ""} — ${v.transaction_count ?? 0} txs`,
						);
						return text(`🏪 **Vendors** (${vendors.length})\n\n${lines.join("\n")}`);
					}

					case "add_vendor": {
						if (!params.name) return text("❌ `name` is required to add a vendor.");
						const vendor = await store.createVendor({
							name: params.name,
							country: params.country ?? undefined,
							category_id: params.category_id ?? undefined,
							ignore: params.ignore ?? false,
							notes: params.notes ?? undefined,
						});
						return text(`✅ Vendor created: **${vendor.name}** (ID ${vendor.id})`);
					}

					case "update_vendor": {
						if (!params.id) return text("❌ `id` is required to update a vendor.");
						const updated = await store.updateVendor(params.id, {
							name: params.name ?? undefined,
							country: params.country ?? undefined,
							category_id: params.category_id ?? undefined,
							ignore: params.ignore,
							notes: params.notes ?? undefined,
						});
						if (!updated) return text(`❌ Vendor #${params.id} not found.`);
						return text(`✅ Vendor updated: **${updated.name}** (ID ${updated.id})`);
					}

					case "delete_vendor": {
						if (!params.id) return text("❌ `id` is required to delete a vendor.");
						const ok = await store.deleteVendor(params.id);
						return text(ok ? `✅ Vendor #${params.id} deleted.` : `❌ Vendor #${params.id} not found.`);
					}

					// ── Reports ───────────────────────────────

					case "spending_summary": {
						const now = new Date();
						const y = params.year ?? now.getFullYear();
						const m = params.month ?? now.getMonth() + 1;
						const summary = await store.getSpendingSummary(y, m);
						let out = `📊 **Spending Summary — ${summary.period}**\n\n`;
						out += `💚 Income: ${formatAmount(summary.total_income)}\n`;
						out += `🔴 Expenses: ${formatAmount(summary.total_expenses)}\n`;
						out += `${summary.net >= 0 ? "✅" : "⚠️"} Net: ${formatAmount(summary.net)}\n\n`;
						if (summary.by_category.length > 0) {
							out += "**Top expense categories:**\n";
							for (const cat of summary.by_category.slice(0, 10)) {
								out += `  • ${cat.category_name}: ${formatAmount(cat.amount)}\n`;
							}
						}
						return text(out);
					}

					case "category_breakdown": {
						const now = new Date();
						const y = params.year ?? now.getFullYear();
						const m = params.month ?? now.getMonth() + 1;
						const breakdown = await store.getCategoryBreakdown(y, m, params.transaction_type);
						if (breakdown.length === 0) return text("No transactions for this period.");
						const lines = breakdown.map(
							(b) => `• **${b.category_name}**: ${formatAmount(b.amount)} (${b.percentage}%) — ${b.transaction_count} txs`,
						);
						return text(`📊 **Category Breakdown — ${y}-${String(m).padStart(2, "0")}**\n\n${lines.join("\n")}`);
					}

					// ── Insights ──────────────────────────────

					case "insights": {
						const insights = await generateInsights(store);
						let out = "📊 **Financial Insights**\n\n";

						// Anomalies
						if (insights.anomalies.length > 0) {
							out += "🚨 **Unusual Spending**\n";
							for (const a of insights.anomalies) {
								out += `  ⚠️ **${a.category_name}**: ${formatAmount(a.current_amount)} (${a.deviation_pct}% above ${formatAmount(a.average_amount)} avg)\n`;
							}
							out += "\n";
						}

						// Budget risks
						const atRisk = insights.budget_risks.filter((b) => b.status !== "on_track");
						if (atRisk.length > 0) {
							out += "💸 **Budget Alerts**\n";
							for (const b of atRisk) {
								const icon = b.status === "over_budget" ? "🔴" : "🟡";
								out += `  ${icon} **${b.category_name}**: ${formatAmount(b.spent)} / ${formatAmount(b.budget_amount)} (${b.pct_used}%)`;
								if (b.status === "at_risk") out += ` — projected: ${formatAmount(b.projected_total)}`;
								out += "\n";
							}
							out += "\n";
						}

						// Goal projections
						if (insights.goal_projections.length > 0) {
							out += "🎯 **Goal Projections**\n";
							for (const g of insights.goal_projections) {
								const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0;
								out += `  • **${g.name}**: ${pct}% complete`;
								if (g.projected_date) out += ` — on track for ${g.projected_date}`;
								if (g.feasible === false) out += ` ⚠️ need ${formatAmount(g.monthly_needed!)}/mo to hit deadline`;
								if (g.feasible === true) out += " ✅";
								out += "\n";
							}
							out += "\n";
						}

						// Trends
						const notable = insights.trends.filter((t) => t.direction !== "stable").slice(0, 5);
						if (notable.length > 0) {
							out += "📈 **Notable Trends** (vs last month)\n";
							for (const t of notable) {
								const icon = t.direction === "increasing" ? "📈" : "📉";
								out += `  ${icon} **${t.category_name}**: ${t.change_pct > 0 ? "+" : ""}${t.change_pct}% (${formatAmount(t.previous_amount)} → ${formatAmount(t.current_amount)})\n`;
							}
							out += "\n";
						}

						// Uncategorized
						if (insights.uncategorized_count > 0) {
							out += `📝 **${insights.uncategorized_count} uncategorized transactions**`;
							if (insights.auto_categorizable > 0) {
								out += ` (${insights.auto_categorizable} can be auto-categorized — use auto_categorize)`;
							}
							out += "\n";
						}

						if (out === "📊 **Financial Insights**\n\n") {
							out += "Everything looks good! No anomalies, budgets on track. 👍";
						}

						return text(out);
					}

					case "trend_analysis": {
						const trends = await analyzeTrends(store);
						if (trends.length === 0) return text("Not enough data for trend analysis (need at least 2 months).");

						const lines: string[] = [];
						const increasing = trends.filter((t) => t.direction === "increasing");
						const decreasing = trends.filter((t) => t.direction === "decreasing");
						const stable = trends.filter((t) => t.direction === "stable");

						if (increasing.length > 0) {
							lines.push("📈 **Increasing**");
							for (const t of increasing) {
								lines.push(`  • **${t.category_name}**: +${t.change_pct}% (${formatAmount(t.previous_amount)} → ${formatAmount(t.current_amount)})`);
							}
						}
						if (decreasing.length > 0) {
							lines.push("📉 **Decreasing**");
							for (const t of decreasing) {
								lines.push(`  • **${t.category_name}**: ${t.change_pct}% (${formatAmount(t.previous_amount)} → ${formatAmount(t.current_amount)})`);
							}
						}
						if (stable.length > 0) {
							lines.push(`➡️ **Stable**: ${stable.map((t) => t.category_name).join(", ")}`);
						}

						return text(`📊 **Trend Analysis** (this month vs last)\n\n${lines.join("\n")}`);
					}

					case "auto_categorize": {
						const result = await autoCategorize(store);
						if (result.updated === 0) return text("No uncategorized transactions could be auto-matched.");
						const lines = result.matches.slice(0, 20).map(
							(m) => `  • "${m.description}" → **${m.category}**`,
						);
						let msg = `✅ Auto-categorized **${result.updated}** transaction(s):\n\n${lines.join("\n")}`;
						if (result.matches.length > 20) msg += `\n  ... and ${result.matches.length - 20} more`;
						return text(msg);
					}

					// ── Bank Import ───────────────────────────

					case "import_bank": {
						if (!params.file_path) return text("❌ file_path is required");
						if (!params.name) return text("❌ name is required (account name, e.g. 'DNB Brukskonto')");
						const importResult = await importBankFile(store, params.file_path, params.name, {
							dryRun: params.dry_run,
						});
						let msg = `📄 **${params.dry_run ? "DRY RUN — " : ""}Import: ${importResult.account_name}**\n`;
						msg += `✅ Imported: ${importResult.imported}\n`;
						msg += `🏷️ Auto-categorized: ${importResult.categorized}\n`;
						if (importResult.linked > 0) msg += `🔗 Transfers linked: ${importResult.linked}\n`;
						if (importResult.skipped > 0) msg += `⏭️ Skipped (duplicates): ${importResult.skipped}\n`;
						if (importResult.errors.length > 0) {
							msg += `⚠️ Errors: ${importResult.errors.length}\n`;
							for (const e of importResult.errors.slice(0, 5)) msg += `  • ${e}\n`;
						}
						return text(msg);
					}

					case "import_bank_directory": {
						if (!params.file_path) return text("❌ file_path is required (directory containing bank exports)");
						const results = await importBankDirectory(store, params.file_path, {
							dryRun: params.dry_run,
						});
						if (results.length === 0) return text("No importable files found in directory.");
						let totalImported = 0, totalSkipped = 0, totalCategorized = 0, totalLinked = 0, totalErrors = 0;
						const lines: string[] = [];
						for (const r of results) {
							totalImported += r.imported;
							totalSkipped += r.skipped;
							totalCategorized += r.categorized;
							totalLinked += r.linked;
							totalErrors += r.errors.length;
							lines.push(`  📁 **${r.account_name}**: ${r.imported} imported, ${r.categorized} categorized${r.linked > 0 ? `, ${r.linked} linked` : ""}${r.skipped > 0 ? `, ${r.skipped} skipped` : ""}${r.errors.length > 0 ? `, ${r.errors.length} errors` : ""}`);
						}
						let msg = `📄 **${params.dry_run ? "DRY RUN — " : ""}Bank Import Summary**\n\n`;
						msg += lines.join("\n") + "\n\n";
						msg += `**Total:** ${totalImported} imported, ${totalCategorized} categorized, ${totalLinked} linked, ${totalSkipped} skipped, ${totalErrors} errors`;
						return text(msg);
					}

					// ── CSV ───────────────────────────────────

					case "import_csv": {
						if (!params.csv_data) return text("❌ csv_data is required");
						if (!params.account_id) return text("❌ account_id is required");
						const result = await store.importTransactionsCsv(params.csv_data, params.account_id);
						let msg = `📄 Imported ${result.imported} transaction(s)`;
						if (result.errors.length > 0) {
							msg += `\n⚠️ ${result.errors.length} error(s):\n${result.errors.slice(0, 5).join("\n")}`;
						}
						return text(msg);
					}

					case "export_csv": {
						const csv = await store.exportTransactionsCsv({
							account_id: params.account_id,
							date_from: params.date_from,
							date_to: params.date_to,
						});
						const lineCount = csv.split("\n").length - 1;
						return text(`📄 **Exported ${lineCount} transactions**\n\n\`\`\`csv\n${csv}\n\`\`\``);
					}

					default:
						return text(`❌ Unknown action: ${action}`);
				}
			} catch (err: any) {
				return text(`❌ Error: ${err.message}`);
			}
		},
	});
}

// ── Formatting Helpers ──────────────────────────────────────────

function formatAmount(amount: number, currency?: string): string {
	const curr = currency || "NOK";
	return `${amount.toLocaleString("nb-NO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${curr}`;
}

function progressBar(pct: number): string {
	const filled = Math.min(Math.round(pct / 10), 10);
	const empty = 10 - filled;
	return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}
