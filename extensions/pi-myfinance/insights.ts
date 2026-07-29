/**
 * pi-myfinance — AI insights and smart categorization.
 *
 * All analysis is local (no external API calls).
 * Returns structured data for the LLM to reason about.
 */

import type {
	FinanceStore,
	Transaction,
	CategoryBreakdown,
	MonthlyTrend,
	Budget,
	Goal,
	Category,
} from "./types.ts";

// ── Auto-Categorization ─────────────────────────────────────────

/**
 * Suggest a category for a transaction description using DB keyword rules.
 * Returns the category_id and name, or null if no match.
 */
export async function suggestCategory(store: FinanceStore, description: string): Promise<{ category_id: number; category_name: string } | null> {
	return store.matchKeyword(description);
}

/**
 * Match a description against all vendors by longest-name-match.
 * Uses a pre-fetched vendor list to avoid N+1 queries.
 */
function matchVendorFromList(description: string, vendors: { id: number; name: string; category_id?: number; category_name?: string }[]): typeof vendors[number] | null {
	const descLower = description.toLowerCase();
	let bestMatch: typeof vendors[number] | null = null;
	let bestLen = 0;
	for (const v of vendors) {
		const vLower = v.name.toLowerCase();
		if (descLower.includes(vLower) && vLower.length > bestLen) {
			bestMatch = v;
			bestLen = vLower.length;
		}
	}
	return bestMatch;
}

/**
 * Auto-categorize uncategorized transactions using DB keyword rules and vendor matching.
 * First tries keyword rules, then falls back to vendor-based categorization.
 * Also auto-links vendors to transactions when a match is found.
 * Returns the number of transactions updated.
 */
export async function autoCategorize(store: FinanceStore): Promise<{ updated: number; vendorsLinked: number; matches: { id: number; description: string; category: string; vendor?: string }[] }> {
	const allTxs = await store.getTransactions({ limit: 10000 });
	const uncategorized = allTxs.filter((t) => !t.category_id);

	// Pre-fetch vendors once to avoid N+1 queries
	const vendors = await store.getVendors(false);

	const matches: { id: number; description: string; category: string; vendor?: string }[] = [];
	let vendorsLinked = 0;

	for (const tx of uncategorized) {
		const update: { category_id?: number; vendor_id?: number } = {};

		// 1. Try keyword-based categorization
		const kwMatch = await suggestCategory(store, tx.description);
		if (kwMatch) {
			update.category_id = kwMatch.category_id;
		}

		// 2. Try vendor-based matching (also assigns category from vendor if no keyword match)
		if (!tx.vendor_id) {
			const vendorMatch = matchVendorFromList(tx.description, vendors);
			if (vendorMatch) {
				update.vendor_id = vendorMatch.id;
				vendorsLinked++;
				// If no keyword match but vendor has a default category, use it
				if (!update.category_id && vendorMatch.category_id) {
					update.category_id = vendorMatch.category_id;
				}
			}
		}

		if (update.category_id || update.vendor_id) {
			await store.updateTransaction(tx.id, update);
			if (update.category_id) {
				const vendorMatch = update.vendor_id ? vendors.find(v => v.id === update.vendor_id) : null;
				const catName = kwMatch?.category_name ?? vendorMatch?.category_name ?? '';
				matches.push({
					id: tx.id,
					description: tx.description,
					category: catName,
					vendor: vendorMatch?.name,
				});
			}
		}
	}

	// Also link vendors to already-categorized transactions that lack a vendor
	const withoutVendor = allTxs.filter((t) => !t.vendor_id);
	for (const tx of withoutVendor) {
		const vendorMatch = matchVendorFromList(tx.description, vendors);
		if (vendorMatch) {
			await store.updateTransaction(tx.id, { vendor_id: vendorMatch.id });
			vendorsLinked++;
		}
	}

	return { updated: matches.length, vendorsLinked, matches };
}

// ── Anomaly Detection ───────────────────────────────────────────

export interface SpendingAnomaly {
	category_name: string;
	current_amount: number;
	average_amount: number;
	deviation_pct: number; // How far above average (percentage)
}

/**
 * Detect categories where current month spending is significantly
 * above the 3-month rolling average (>50% above).
 */
export async function detectAnomalies(store: FinanceStore): Promise<SpendingAnomaly[]> {
	const trend = await store.getMonthlyTrend(4); // Current + 3 prior months
	if (trend.length < 2) return [];

	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

	// Get per-category spending for current month
	const currentBreakdown = await store.getCategoryBreakdown(now.getFullYear(), now.getMonth() + 1);

	// Get per-category spending for prior 3 months (average)
	const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
	const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
	const priorBreakdown = await store.getCategoryBreakdownByRange(
		threeMonthsAgo.toISOString().slice(0, 10),
		lastMonthEnd.toISOString().slice(0, 10),
	);

	const priorAvg = new Map<string, number>();
	for (const b of priorBreakdown) {
		priorAvg.set(b.category_name, b.amount / 3);
	}

	const anomalies: SpendingAnomaly[] = [];
	for (const b of currentBreakdown) {
		const avg = priorAvg.get(b.category_name) ?? 0;
		if (avg > 0 && b.amount > avg * 1.5) {
			anomalies.push({
				category_name: b.category_name,
				current_amount: b.amount,
				average_amount: Math.round(avg),
				deviation_pct: Math.round(((b.amount - avg) / avg) * 100),
			});
		}
	}

	return anomalies.sort((a, b) => b.deviation_pct - a.deviation_pct);
}

// ── Budget Adherence ────────────────────────────────────────────

export interface BudgetRisk {
	category_name: string;
	budget_amount: number;
	spent: number;
	pct_used: number;
	days_left: number;
	projected_total: number;
	status: "on_track" | "at_risk" | "over_budget";
}

/**
 * Analyze budget adherence for the current month.
 * Projects end-of-month spending based on current pace.
 */
export async function analyzeBudgetRisk(store: FinanceStore): Promise<BudgetRisk[]> {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const dayOfMonth = now.getDate();
	const daysInMonth = new Date(year, month, 0).getDate();
	const daysLeft = daysInMonth - dayOfMonth;
	const pctMonthElapsed = dayOfMonth / daysInMonth;

	const budgets = await store.getBudgetStatus(year, month);

	return budgets.map((b) => {
		const spent = b.spent ?? 0;
		const pctUsed = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0;
		const projectedTotal = pctMonthElapsed > 0 ? Math.round(spent / pctMonthElapsed) : spent;

		let status: "on_track" | "at_risk" | "over_budget";
		if (spent > b.amount) {
			status = "over_budget";
		} else if (projectedTotal > b.amount) {
			status = "at_risk";
		} else {
			status = "on_track";
		}

		return {
			category_name: b.category_name ?? "Unknown",
			budget_amount: b.amount,
			spent,
			pct_used: pctUsed,
			days_left: daysLeft,
			projected_total: projectedTotal,
			status,
		};
	});
}

// ── Goal Feasibility ────────────────────────────────────────────

export interface GoalProjection {
	name: string;
	goal_type: string;
	current: number;
	target: number;
	remaining: number;
	deadline: string | null;
	days_left: number | null;
	monthly_needed: number | null; // Amount per month to hit target
	projected_date: string | null; // At current savings rate
	feasible: boolean | null; // Can we hit the deadline?
}

/**
 * Analyze goal feasibility based on recent savings rate.
 */
export async function analyzeGoals(store: FinanceStore): Promise<GoalProjection[]> {
	const goals = await store.getGoals("active");
	if (goals.length === 0) return [];

	// Calculate average monthly savings from last 3 months
	const trend = await store.getMonthlyTrend(3);
	const avgMonthlySavings = trend.length > 0
		? trend.reduce((s, t) => s + t.net, 0) / trend.length
		: 0;

	return goals.map((g) => {
		const remaining = g.target_amount - g.current_amount;
		let daysLeft: number | null = null;
		let monthlyNeeded: number | null = null;
		let projectedDate: string | null = null;
		let feasible: boolean | null = null;

		if (g.deadline) {
			daysLeft = Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000);
			const monthsLeft = daysLeft / 30;
			monthlyNeeded = monthsLeft > 0 ? Math.round(remaining / monthsLeft) : null;
			feasible = avgMonthlySavings > 0 && monthlyNeeded !== null ? avgMonthlySavings >= monthlyNeeded : null;
		}

		if (avgMonthlySavings > 0 && remaining > 0) {
			const monthsToGoal = remaining / avgMonthlySavings;
			const projDate = new Date();
			projDate.setMonth(projDate.getMonth() + Math.ceil(monthsToGoal));
			projectedDate = projDate.toISOString().slice(0, 10);
		}

		return {
			name: g.name,
			goal_type: g.goal_type,
			current: g.current_amount,
			target: g.target_amount,
			remaining,
			deadline: g.deadline ?? null,
			days_left: daysLeft,
			monthly_needed: monthlyNeeded,
			projected_date: projectedDate,
			feasible,
		};
	});
}

// ── Trend Analysis ──────────────────────────────────────────────

export interface CategoryTrend {
	category_name: string;
	current_amount: number;
	previous_amount: number;
	change_pct: number;
	direction: "increasing" | "decreasing" | "stable";
}

/**
 * Compare spending between two periods to identify trends.
 * Default: current month vs previous month.
 */
export async function analyzeTrends(store: FinanceStore): Promise<CategoryTrend[]> {
	const now = new Date();
	const currentYear = now.getFullYear();
	const currentMonth = now.getMonth() + 1;

	const prevDate = new Date(currentYear, currentMonth - 2, 1); // Previous month
	const prevYear = prevDate.getFullYear();
	const prevMonth = prevDate.getMonth() + 1;

	const current = await store.getCategoryBreakdown(currentYear, currentMonth);
	const previous = await store.getCategoryBreakdown(prevYear, prevMonth);

	const prevMap = new Map(previous.map((b) => [b.category_name, b.amount]));

	const trends: CategoryTrend[] = [];

	// Categories in current month
	for (const b of current) {
		const prev = prevMap.get(b.category_name) ?? 0;
		const changePct = prev > 0 ? Math.round(((b.amount - prev) / prev) * 100) : (b.amount > 0 ? 100 : 0);
		trends.push({
			category_name: b.category_name,
			current_amount: b.amount,
			previous_amount: prev,
			change_pct: changePct,
			direction: changePct > 10 ? "increasing" : changePct < -10 ? "decreasing" : "stable",
		});
		prevMap.delete(b.category_name);
	}

	// Categories only in previous month (spending stopped)
	for (const [name, amount] of prevMap) {
		trends.push({
			category_name: name,
			current_amount: 0,
			previous_amount: amount,
			change_pct: -100,
			direction: "decreasing",
		});
	}

	return trends.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
}

// ── Full Insights Report ────────────────────────────────────────

export interface FinancialInsights {
	anomalies: SpendingAnomaly[];
	budget_risks: BudgetRisk[];
	goal_projections: GoalProjection[];
	trends: CategoryTrend[];
	uncategorized_count: number;
	auto_categorizable: number;
}

/**
 * Generate a complete financial insights report.
 */
export async function generateInsights(store: FinanceStore): Promise<FinancialInsights> {
	const allTxs = await store.getTransactions({ limit: 10000 });
	const uncategorized = allTxs.filter((t) => !t.category_id);
	let autoCategorizable = 0;
	for (const tx of uncategorized) {
		if (await suggestCategory(store, tx.description)) autoCategorizable++;
	}

	return {
		anomalies: await detectAnomalies(store),
		budget_risks: await analyzeBudgetRisk(store),
		goal_projections: await analyzeGoals(store),
		trends: await analyzeTrends(store),
		uncategorized_count: uncategorized.length,
		auto_categorizable: autoCategorizable,
	};
}
