/**
 * pi-myfinance — Insights module test.
 *
 * Run: npx tsx src/test-insights.ts
 */

import { closeDb } from "./db.ts";
import { createSqliteStore } from "./store.ts";
import { suggestCategory, autoCategorize, detectAnomalies, analyzeBudgetRisk, analyzeGoals, analyzeTrends, generateInsights } from "./insights.ts";
import * as fs from "node:fs";

const TEST_DB = "/tmp/pi-myfinance-test-insights.db";
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const store = await createSqliteStore(TEST_DB);

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
	if (cond) { console.log(`  ✅ ${msg}`); passed++; }
	else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log("=== pi-myfinance Insights Test ===\n");

// ── suggestCategory (now async, uses DB keywords) ──────────────

console.log("🏷️ Smart Categorization");
async function sc(desc: string): Promise<string | null> {
	const m = await suggestCategory(store, desc);
	return m?.category_name ?? null;
}
assert(await sc("REMA 1000 Grünerløkka") === "Groceries", "REMA → Groceries");
assert(await sc("Meny Majorstuen") === "Groceries", "Meny → Groceries");
assert(await sc("Netflix") === "Subscriptions", "Netflix → Subscriptions");
assert(await sc("Spotify Premium") === "Subscriptions", "Spotify → Subscriptions");
assert(await sc("Ruter billett") === "Public Transit", "Ruter → Public Transit");
assert(await sc("Circle K Skøyen") === "Fuel", "Circle K → Fuel");
assert(await sc("ELKJØP ASA") === "Electronics", "Elkjøp → Electronics");
assert(await sc("IKEA Furuset") === "Household", "IKEA → Household");
assert(await sc("Apotek 1") === "Pharmacy", "Apotek → Pharmacy");
assert(await sc("SATS treningssenter") === "Gym/Fitness", "SATS → Gym/Fitness");
assert(await sc("Random Unknown Store") === null, "Unknown → null");
assert(await sc("Gjensidige forsikring") === "Insurance", "Gjensidige → Insurance");
assert(await sc("Tibber strøm") === "Utilities", "Tibber → Utilities");
assert(await sc("Udemy course") === "Courses", "Udemy → Courses");
assert(await sc("Wolt delivery") === "Restaurants", "Wolt → Restaurants");

// ── autoCategorize ──────────────────────────────────────────────

console.log("\n🤖 Auto-Categorization");
const acct = await store.createAccount({ name: "Test", account_type: "checking" });

// Create uncategorized transactions
await store.createTransaction({ account_id: acct.id, amount: 500, transaction_type: "out", description: "REMA 1000 Torshov", date: "2026-02-01" });
await store.createTransaction({ account_id: acct.id, amount: 199, transaction_type: "out", description: "Netflix monthly", date: "2026-02-01" });
await store.createTransaction({ account_id: acct.id, amount: 999, transaction_type: "out", description: "Random purchase", date: "2026-02-01" });

const result = await autoCategorize(store);
assert(result.updated === 2, `Auto-categorized ${result.updated} of 3`);
assert(result.matches.some((m: any) => m.category === "Groceries"), "Matched REMA → Groceries");
assert(result.matches.some((m: any) => m.category === "Subscriptions"), "Matched Netflix → Subscriptions");

// ── Budget & Goal analysis (smoke test with data) ───────────────

console.log("\n📊 Analysis Functions");

// Add some realistic data
const allCats = await store.getCategories();
const groceryCat = allCats.find((c: any) => c.name === "Groceries")!;

// Create budget
await store.createBudget({ category_id: groceryCat.id, amount: 5000, month: 2, year: 2026 });

// Create income + more expenses (for current month)
await store.createTransaction({ account_id: acct.id, amount: 45000, transaction_type: "in", description: "Salary", date: "2026-02-01" });

// Create a goal
await store.createGoal({ name: "Emergency Fund", goal_type: "savings", target_amount: 100000, current_amount: 20000, deadline: "2026-12-31" });

const budgetRisks = await analyzeBudgetRisk(store);
assert(Array.isArray(budgetRisks), `Budget risk analysis: ${budgetRisks.length} items`);

const goalProjections = await analyzeGoals(store);
assert(goalProjections.length === 1, `Goal projections: ${goalProjections.length}`);
assert(goalProjections[0].name === "Emergency Fund", `Goal: ${goalProjections[0].name}`);
assert(goalProjections[0].remaining === 80000, `Remaining: ${goalProjections[0].remaining}`);

const trends = await analyzeTrends(store);
assert(Array.isArray(trends), `Trends: ${trends.length} categories`);

// ── Full insights ───────────────────────────────────────────────

console.log("\n🧠 Full Insights");
const insights = await generateInsights(store);
assert(insights.uncategorized_count >= 0, `Uncategorized: ${insights.uncategorized_count}`);
assert(Array.isArray(insights.anomalies), `Anomalies: ${insights.anomalies.length}`);
assert(Array.isArray(insights.budget_risks), `Budget risks: ${insights.budget_risks.length}`);
assert(Array.isArray(insights.goal_projections), `Goals: ${insights.goal_projections.length}`);
assert(Array.isArray(insights.trends), `Trends: ${insights.trends.length}`);

console.log(`\n${"═".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(40)}`);

closeDb();
fs.unlinkSync(TEST_DB);
process.exit(failed > 0 ? 1 : 0);
