/**
 * pi-myfinance — Smoke test for database + store.
 *
 * Run: npx tsx src/test-db.ts
 */

import { closeDb } from "./db.ts";
import { createSqliteStore } from "./store.ts";
import * as fs from "node:fs";

const TEST_DB = "/tmp/pi-myfinance-test.db";

// Clean up
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log("=== pi-myfinance Smoke Test ===\n");

// Init
const store = await createSqliteStore(TEST_DB);

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
	if (condition) {
		console.log(`  ✅ ${msg}`);
		passed++;
	} else {
		console.log(`  ❌ ${msg}`);
		failed++;
	}
}

// ── Categories ──────────────────────────────────────────────────

console.log("\n📁 Categories (seeded)");
const cats = await store.getCategories();
assert(cats.length > 0, `Seeded ${cats.length} categories`);
const groceries = cats.find((c) => c.name === "Groceries");
assert(groceries !== undefined, "Groceries category exists");
assert(groceries?.parent_id !== null, "Groceries has parent_id (Food)");

const custom = await store.createCategory({ name: "Test Cat", icon: "🧪", category_type: "expense" });
assert(custom.id > 0, `Created custom category: id=${custom.id}`);

// ── Accounts ────────────────────────────────────────────────────

console.log("\n🏦 Accounts");
const checking = await store.createAccount({ name: "DNB Checking", account_type: "checking", currency: "NOK", balance: 50000 });
assert(checking.id > 0, `Created checking account: id=${checking.id}`);
assert(checking.balance === 50000, `Balance is 50000`);
assert(checking.currency === "NOK", `Currency is NOK`);

const savings = await store.createAccount({ name: "Savings", account_type: "savings", balance: 200000 });
assert(savings.id > 0, `Created savings account: id=${savings.id}`);

const accounts = await store.getAccounts();
assert(accounts.length === 2, `Two accounts in DB`);

const updated = await store.updateAccount(checking.id, { name: "DNB Brukskonto" });
assert(updated?.name === "DNB Brukskonto", `Updated account name`);

// ── Transactions ────────────────────────────────────────────────

console.log("\n💳 Transactions");
const salary = await store.createTransaction({
	account_id: checking.id,
	category_id: cats.find((c) => c.name === "Salary")!.id,
	amount: 45000,
	transaction_type: "in",
	description: "Monthly salary",
	date: "2026-02-01",
});
assert(salary.id > 0, `Created income transaction: id=${salary.id}`);

// Check balance updated
const afterSalary = ( await store.getAccount(checking.id) )!;
assert(afterSalary.balance === 95000, `Balance after salary: ${afterSalary.balance} (expected 95000)`);

const groceryTx = await store.createTransaction({
	account_id: checking.id,
	category_id: groceries!.id,
	amount: 850,
	transaction_type: "out",
	description: "REMA 1000 Grünerløkka",
	date: "2026-02-05",
	tags: ["groceries", "weekly"],
});
assert(groceryTx.id > 0, `Created expense transaction: id=${groceryTx.id}`);

const afterGrocery = ( await store.getAccount(checking.id) )!;
assert(afterGrocery.balance === 94150, `Balance after grocery: ${afterGrocery.balance} (expected 94150)`);

// Filtered query
const expenses = await store.getTransactions({ transaction_type: "out" });
assert(expenses.length === 1, `Found ${expenses.length} expense(s)`);
assert(expenses[0].category_name === "Groceries", `Category name denormalized: ${expenses[0].category_name}`);

// Search
const searchResults = await store.searchTransactions("REMA");
assert(searchResults.length === 1, `Search 'REMA' found ${searchResults.length} result(s)`);

// Date range filter
const febTx = await store.getTransactions({ date_from: "2026-02-01", date_to: "2026-02-28" });
assert(febTx.length === 2, `Feb transactions: ${febTx.length}`);

// Delete transaction (reverses balance)
const deleted = await store.deleteTransaction(groceryTx.id);
assert(deleted, "Deleted grocery transaction");
const afterDelete = ( await store.getAccount(checking.id) )!;
assert(afterDelete.balance === 95000, `Balance restored after delete: ${afterDelete.balance}`);

// ── Budgets ─────────────────────────────────────────────────────

console.log("\n📊 Budgets");
const budget = await store.createBudget({
	category_id: groceries!.id,
	amount: 5000,
	period: "monthly",
	month: 2,
	year: 2026,
});
assert(budget.id > 0, `Created budget: id=${budget.id}`);
assert(budget.category_name === "Groceries", `Budget category: ${budget.category_name}`);

// Re-create grocery transaction for budget test
await store.createTransaction({
	account_id: checking.id,
	category_id: groceries!.id,
	amount: 850,
	transaction_type: "out",
	description: "REMA 1000",
	date: "2026-02-05",
});
await store.createTransaction({
	account_id: checking.id,
	category_id: groceries!.id,
	amount: 1200,
	transaction_type: "out",
	description: "Meny Majorstuen",
	date: "2026-02-10",
});

const budgetStatus = await store.getBudgetStatus(2026, 2);
assert(budgetStatus.length === 1, `Budget status entries: ${budgetStatus.length}`);
assert(budgetStatus[0].spent === 2050, `Spent on groceries: ${budgetStatus[0].spent} (expected 2050)`);

// ── Goals ───────────────────────────────────────────────────────

console.log("\n🎯 Goals");
const goal = await store.createGoal({
	name: "Emergency Fund",
	goal_type: "savings",
	target_amount: 100000,
	current_amount: 25000,
	deadline: "2026-12-31",
});
assert(goal.id > 0, `Created goal: id=${goal.id}`);
assert(goal.status === "active", `Goal status: ${goal.status}`);

const updatedGoal = await store.updateGoal(goal.id, { current_amount: 30000 });
assert(updatedGoal?.current_amount === 30000, `Updated goal amount: ${updatedGoal?.current_amount}`);

const completedGoal = await store.updateGoal(goal.id, { status: "completed" });
assert(completedGoal?.status === "completed", `Goal completed`);

const activeGoals = await store.getGoals("active");
assert(activeGoals.length === 0, `Active goals after completion: ${activeGoals.length}`);

// ── Recurring ───────────────────────────────────────────────────

console.log("\n🔁 Recurring Transactions");
const recurring = await store.createRecurring({
	account_id: checking.id,
	category_id: cats.find((c) => c.name === "Subscriptions")!.id,
	amount: 199,
	transaction_type: "out",
	description: "Netflix",
	frequency: "monthly",
	next_date: "2026-02-13",
});
assert(recurring.id > 0, `Created recurring: id=${recurring.id}`);

// Upcoming recurring
const upcoming = await store.getUpcomingRecurring(60);
assert(upcoming.length === 1, `Upcoming recurring (60 days): ${upcoming.length}`);
assert(upcoming[0].description === "Netflix", `Upcoming: ${upcoming[0].description}`);

// Process due recurring
const processed = await store.processDueRecurring();
assert(processed.length === 1, `Processed ${processed.length} due recurring`);
assert(processed[0].description === "Netflix", `Processed: ${processed[0].description}`);

// Verify next_date advanced
const afterProcess = ( await store.getRecurringById(recurring.id) )!;
assert(afterProcess.next_date === "2026-03-13", `Next date advanced to: ${afterProcess.next_date}`);

// Process again — should be 0 (not due yet)
const processed2 = await store.processDueRecurring();
assert(processed2.length === 0, `No more due: ${processed2.length}`);

// ── Reports ─────────────────────────────────────────────────────

console.log("\n📈 Reports");
const summary = await store.getSpendingSummary(2026, 2);
assert(summary.total_income === 45000, `Income: ${summary.total_income}`);
assert(summary.total_expenses > 0, `Expenses: ${summary.total_expenses}`);
assert(summary.net > 0, `Net positive: ${summary.net}`);
assert(summary.by_category.length > 0, `Categories in summary: ${summary.by_category.length}`);

const breakdown = await store.getCategoryBreakdown(2026, 2);
assert(breakdown.length > 0, `Category breakdown entries: ${breakdown.length}`);
assert(breakdown[0].percentage > 0, `First category percentage: ${breakdown[0].percentage}%`);

// ── CSV Export/Import ───────────────────────────────────────────

console.log("\n📄 CSV Export/Import");
const csv = await store.exportTransactionsCsv();
const csvLines = csv.split("\n");
assert(csvLines[0] === "date,type,amount,description,category,account,notes,tags", "CSV header correct");
assert(csvLines.length > 2, `Exported ${csvLines.length - 1} rows`);

// Import test
const importCsv = `date,amount,description
2026-01-15,-500,Test import expense
2026-01-20,1000,Test import income
invalid,,broken row`;

const importResult = await store.importTransactionsCsv(importCsv, checking.id);
assert(importResult.imported === 2, `Imported: ${importResult.imported}`);
assert(importResult.errors.length === 1, `Import errors: ${importResult.errors.length}`);

// Norwegian date format
const noCsv = `date,amount,description
15.01.2026,-300,Norwegian format test`;
const noResult = await store.importTransactionsCsv(noCsv, checking.id);
assert(noResult.imported === 1, `Norwegian date import: ${noResult.imported}`);

// ── Delete account (cascades) ───────────────────────────────────

console.log("\n🗑️ Cascade delete");
const delAccount = await store.deleteAccount(savings.id);
assert(delAccount, "Deleted savings account");
assert((await store.getAccounts()).length === 1, "One account remaining");

// ── Summary ─────────────────────────────────────────────────────

console.log(`\n${"═".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(40)}`);

// Cleanup
closeDb();
fs.unlinkSync(TEST_DB);

process.exit(failed > 0 ? 1 : 0);
