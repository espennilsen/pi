/**
 * pi-myfinance — Store: CRUD for all entities.
 *
 * All functions are synchronous (better-sqlite3 is sync).
 * Implements the FinanceStore interface from types.ts.
 */

import { getDb } from "./db.ts";
import type {
	FinanceStore,
	Account,
	CreateAccountData,
	UpdateAccountData,
	Category,
	CreateCategoryData,
	CategoryKeyword,
	CreateCategoryKeywordData,
	UpdateCategoryKeywordData,
	Transaction,
	CreateTransactionData,
	UpdateTransactionData,
	TransactionFilters,
	Budget,
	CreateBudgetData,
	UpdateBudgetData,
	Goal,
	CreateGoalData,
	UpdateGoalData,
	GoalStatus,
	RecurringTransaction,
	CreateRecurringData,
	UpdateRecurringData,
	SpendingSummary,
	CategoryBreakdown,
	MonthlyTrend,
	TransactionType,
	Vendor,
	CreateVendorData,
	UpdateVendorData,
} from "./types.ts";

// ── Helpers ─────────────────────────────────────────────────────

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function now(): string {
	return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function advanceDate(date: string, frequency: string): string {
	const d = new Date(date + "T12:00:00Z"); // Noon UTC avoids timezone edge cases
	switch (frequency) {
		case "daily":
			d.setUTCDate(d.getUTCDate() + 1);
			break;
		case "weekly":
			d.setUTCDate(d.getUTCDate() + 7);
			break;
		case "biweekly":
			d.setUTCDate(d.getUTCDate() + 14);
			break;
		case "monthly":
			d.setUTCMonth(d.getUTCMonth() + 1);
			break;
		case "quarterly":
			d.setUTCMonth(d.getUTCMonth() + 3);
			break;
		case "yearly":
			d.setUTCFullYear(d.getUTCFullYear() + 1);
			break;
	}
	return d.toISOString().slice(0, 10);
}

// ── Store Singleton ──────────────────────────────────────────────
// Owned here (not in index.ts) to avoid circular dependencies.
// web.ts and tool.ts import getFinanceStore() from here.

let activeStore: FinanceStore | null = null;

export function getFinanceStore(): FinanceStore {
	if (!activeStore) throw new Error("Finance store not initialized");
	return activeStore;
}

export function setFinanceStore(store: FinanceStore | null): void {
	activeStore = store;
}

export function isStoreReady(): boolean {
	return activeStore !== null;
}

// ── SQLite Store Factory ─────────────────────────────────────────

/**
 * Create a store backed by the local SQLite file via better-sqlite3.
 * Wraps sync calls in Promise.resolve to satisfy the async FinanceStore interface.
 */
export async function createSqliteStore(dbPath: string): Promise<FinanceStore> {
	const db = await import("./db.ts");
	db.initDb(dbPath);
	const raw = createRawStore();

	// Wrap every method in Promise.resolve
	const store = {} as FinanceStore;
	for (const key of Object.keys(raw) as (keyof FinanceStore)[]) {
		(store as any)[key] = (...args: any[]) => {
			try {
				return Promise.resolve((raw as any)[key](...args));
			} catch (err) {
				return Promise.reject(err);
			}
		};
	}
	return store;
}

// ── Kysely Store Factory ────────────────────────────────────────

interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

/**
 * Create a store backed by pi-kysely's shared database.
 */
export async function createKyselyStore(eventBus: EventBus): Promise<FinanceStore> {
	const db = await import("./db-kysely.ts");
	await db.initDb(eventBus);
	return db.store;
}

// ── Raw Sync Store (SQLite) ─────────────────────────────────────

/** Descriptions excluded from all report/summary queries. */
const REPORT_EXCLUSIONS = ["Opening Balance Adjustment", "Balance Adjustment", "Opening Balance"];
const REPORT_EXCLUDE_SQL = REPORT_EXCLUSIONS.map(() => "t.description != ?").join(" AND ");
const REPORT_EXCLUDE_PARAMS = REPORT_EXCLUSIONS;

/** @internal Raw synchronous store used by createSqliteStore */
function createRawStore() {
	return {
		// ── Accounts ──────────────────────────────────────────

		getAccounts(): Account[] {
			return getDb().prepare("SELECT * FROM finance_accounts ORDER BY name").all() as Account[];
		},

		getAccount(id: number): Account | null {
			return (getDb().prepare("SELECT * FROM finance_accounts WHERE id = ?").get(id) as Account) ?? null;
		},

		createAccount(data: CreateAccountData): Account {
			const db = getDb();
			const ts = now();
			const result = db
				.prepare(
					`INSERT INTO finance_accounts (name, account_type, currency, balance, notes, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					data.name,
					data.account_type,
					data.currency ?? "NOK",
					data.balance ?? 0,
					data.notes ?? null,
					ts,
					ts,
				);
			return this.getAccount(Number(result.lastInsertRowid))!;
		},

		updateAccount(id: number, data: UpdateAccountData): Account | null {
			const existing = this.getAccount(id);
			if (!existing) return null;
			const db = getDb();
			const ts = now();
			db.prepare(
				`UPDATE finance_accounts
				 SET name = ?, account_type = ?, currency = ?, balance = ?, notes = ?, updated_at = ?
				 WHERE id = ?`,
			).run(
				data.name ?? existing.name,
				data.account_type ?? existing.account_type,
				data.currency ?? existing.currency,
				data.balance !== undefined ? data.balance : existing.balance,
				data.notes !== undefined ? data.notes : existing.notes,
				ts,
				id,
			);
			return this.getAccount(id);
		},

		deleteAccount(id: number): boolean {
			const result = getDb().prepare("DELETE FROM finance_accounts WHERE id = ?").run(id);
			return result.changes > 0;
		},

		// ── Categories ────────────────────────────────────────

		getCategories(): Category[] {
			return getDb()
				.prepare("SELECT * FROM finance_categories ORDER BY parent_id IS NOT NULL, parent_id, name")
				.all() as Category[];
		},

		getCategory(id: number): Category | null {
			return (
				(getDb().prepare("SELECT * FROM finance_categories WHERE id = ?").get(id) as Category) ?? null
			);
		},

		createCategory(data: CreateCategoryData): Category {
			const db = getDb();
			const result = db
				.prepare(
					`INSERT INTO finance_categories (name, parent_id, icon, category_type)
					 VALUES (?, ?, ?, ?)`,
				)
				.run(data.name, data.parent_id ?? null, data.icon ?? null, data.category_type ?? "expense");
			return this.getCategory(Number(result.lastInsertRowid))!;
		},

		// ── Category Keywords ─────────────────────────────────

		getCategoryKeywords(categoryId?: number): CategoryKeyword[] {
			const db = getDb();
			if (categoryId) {
				return db.prepare(
					`SELECT k.*, c.name as category_name FROM finance_category_keywords k
					 LEFT JOIN finance_categories c ON k.category_id = c.id
					 WHERE k.category_id = ? ORDER BY k.priority DESC, k.keyword`,
				).all(categoryId) as CategoryKeyword[];
			}
			return db.prepare(
				`SELECT k.*, c.name as category_name FROM finance_category_keywords k
				 LEFT JOIN finance_categories c ON k.category_id = c.id
				 ORDER BY k.priority DESC, c.name, k.keyword`,
			).all() as CategoryKeyword[];
		},

		getCategoryKeyword(id: number): CategoryKeyword | null {
			return (getDb().prepare(
				`SELECT k.*, c.name as category_name FROM finance_category_keywords k
				 LEFT JOIN finance_categories c ON k.category_id = c.id WHERE k.id = ?`,
			).get(id) as CategoryKeyword) ?? null;
		},

		createCategoryKeyword(data: CreateCategoryKeywordData): CategoryKeyword {
			const db = getDb();
			const result = db.prepare(
				`INSERT INTO finance_category_keywords (category_id, keyword, match_type, case_sensitive, priority, created_at)
				 VALUES (?, ?, ?, ?, ?, datetime('now'))`,
			).run(data.category_id, data.keyword, data.match_type ?? "contains", data.case_sensitive ? 1 : 0, data.priority ?? 0);
			return this.getCategoryKeyword(Number(result.lastInsertRowid))!;
		},

		updateCategoryKeyword(id: number, data: UpdateCategoryKeywordData): CategoryKeyword | null {
			const existing = this.getCategoryKeyword(id);
			if (!existing) return null;
			getDb().prepare(
				`UPDATE finance_category_keywords
				 SET category_id = ?, keyword = ?, match_type = ?, case_sensitive = ?, priority = ?
				 WHERE id = ?`,
			).run(
				data.category_id ?? existing.category_id,
				data.keyword ?? existing.keyword,
				data.match_type ?? existing.match_type,
				data.case_sensitive !== undefined ? (data.case_sensitive ? 1 : 0) : (existing.case_sensitive ? 1 : 0),
				data.priority ?? existing.priority,
				id,
			);
			return this.getCategoryKeyword(id);
		},

		deleteCategoryKeyword(id: number): boolean {
			return getDb().prepare("DELETE FROM finance_category_keywords WHERE id = ?").run(id).changes > 0;
		},

		matchKeyword(description: string): { category_id: number; category_name: string } | null {
			const keywords = this.getCategoryKeywords() as CategoryKeyword[];
			const descLower = description.toLowerCase();

			for (const kw of keywords) {
				const kwText = kw.case_sensitive ? kw.keyword : kw.keyword.toLowerCase();
				const desc = kw.case_sensitive ? description : descLower;
				let matched = false;

				switch (kw.match_type) {
					case "contains":
						matched = desc.includes(kwText);
						break;
					case "exact":
						matched = desc === kwText;
						break;
					case "starts_with":
						matched = desc.startsWith(kwText);
						break;
					case "regex":
						try {
							const flags = kw.case_sensitive ? "" : "i";
							const re = new RegExp(kw.keyword, flags);
							// Guard against ReDoS: enforce a timeout via limiting input length
							if (description.length <= 10_000) {
								matched = re.test(description);
							}
						} catch { /* invalid regex, skip */ }
						break;
				}

				if (matched) {
					return { category_id: kw.category_id, category_name: kw.category_name ?? "Unknown" };
				}
			}
			return null;
		},

		// ── Transactions ──────────────────────────────────────

		getTransactions(filters?: TransactionFilters): Transaction[] {
			const conditions: string[] = [];
			const params: any[] = [];

			if (filters?.account_id) {
				conditions.push("t.account_id = ?");
				params.push(filters.account_id);
			}
			if (filters?.category_ids && filters.category_ids.length > 0) {
				const placeholders = filters.category_ids.map(() => "?").join(",");
				conditions.push(`t.category_id IN (${placeholders})`);
				params.push(...filters.category_ids);
			} else if (filters?.category_id) {
				conditions.push("t.category_id = ?");
				params.push(filters.category_id);
			}
			if (filters?.transaction_type) {
				conditions.push("t.transaction_type = ?");
				params.push(filters.transaction_type);
			}
			if (filters?.date_from) {
				conditions.push("t.date >= ?");
				params.push(filters.date_from);
			}
			if (filters?.date_to) {
				conditions.push("t.date <= ?");
				params.push(filters.date_to);
			}
			if (filters?.search) {
				conditions.push("(t.description LIKE ? OR t.notes LIKE ?)");
				params.push(`%${filters.search}%`, `%${filters.search}%`);
			}

			const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
			const limit = filters?.limit ?? 100;
			const offset = filters?.offset ?? 0;

			return getDb()
				.prepare(
					`SELECT t.*, a.name as account_name, c.name as category_name,
					        v.name as vendor_name,
					        lt.account_id as linked_account_id, la.name as linked_account_name
					 FROM finance_transactions t
					 LEFT JOIN finance_accounts a ON t.account_id = a.id
					 LEFT JOIN finance_categories c ON t.category_id = c.id
					 LEFT JOIN finance_vendors v ON t.vendor_id = v.id
					 LEFT JOIN finance_transactions lt ON t.linked_transaction_id = lt.id
					 LEFT JOIN finance_accounts la ON lt.account_id = la.id
					 ${where}
					 ORDER BY t.date DESC, t.id DESC
					 LIMIT ? OFFSET ?`,
				)
				.all(...params, limit, offset) as Transaction[];
		},

		getTransaction(id: number): Transaction | null {
			return (
				(getDb()
					.prepare(
						`SELECT t.*, a.name as account_name, c.name as category_name,
						        v.name as vendor_name,
						        lt.account_id as linked_account_id, la.name as linked_account_name
						 FROM finance_transactions t
						 LEFT JOIN finance_accounts a ON t.account_id = a.id
						 LEFT JOIN finance_categories c ON t.category_id = c.id
						 LEFT JOIN finance_vendors v ON t.vendor_id = v.id
						 LEFT JOIN finance_transactions lt ON t.linked_transaction_id = lt.id
						 LEFT JOIN finance_accounts la ON lt.account_id = la.id
						 WHERE t.id = ?`,
					)
					.get(id) as Transaction) ?? null
			);
		},

		createTransaction(data: CreateTransactionData): Transaction {
			const db = getDb();
			const ts = now();
			let insertedId: number;

			const run = db.transaction(() => {
				const result = db
					.prepare(
						`INSERT INTO finance_transactions
						 (account_id, category_id, vendor_id, amount, transaction_type, description, date, tags, notes, recurring_id, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.run(
						data.account_id,
						data.category_id ?? null,
						data.vendor_id ?? null,
						data.amount,
						data.transaction_type,
						data.description,
						data.date ?? today(),
						data.tags ? JSON.stringify(data.tags) : null,
						data.notes ?? null,
						data.recurring_id ?? null,
						ts,
						ts,
					);
				insertedId = Number(result.lastInsertRowid);

				// Update account balance
				const sign = data.transaction_type === "in" ? 1 : -1;
				db.prepare("UPDATE finance_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?").run(
					sign * data.amount,
					ts,
					data.account_id,
				);
			});
			run();

			return this.getTransaction(insertedId!)!;
		},

		updateTransaction(id: number, data: UpdateTransactionData): Transaction | null {
			const existing = this.getTransaction(id);
			if (!existing) return null;
			const db = getDb();
			const ts = now();

			const newType = data.transaction_type ?? existing.transaction_type;
			const newAmount = data.amount ?? existing.amount;
			const newAccountId = data.account_id ?? existing.account_id;

			const run = db.transaction(() => {
				// Reverse old balance effect on the original account
				const oldSign = existing.transaction_type === "in" ? 1 : -1;
				db.prepare("UPDATE finance_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?").run(
					oldSign * existing.amount,
					ts,
					existing.account_id,
				);

				db.prepare(
					`UPDATE finance_transactions
					 SET account_id = ?, category_id = ?, vendor_id = ?, amount = ?, transaction_type = ?,
					     description = ?, date = ?, tags = ?, notes = ?, updated_at = ?
					 WHERE id = ?`,
				).run(
					newAccountId,
					data.category_id !== undefined ? data.category_id : existing.category_id,
					data.vendor_id !== undefined ? data.vendor_id : existing.vendor_id,
					newAmount,
					newType,
					data.description ?? existing.description,
					data.date ?? existing.date,
					data.tags ? JSON.stringify(data.tags) : existing.tags,
					data.notes !== undefined ? data.notes : existing.notes,
					ts,
					id,
				);

				// Apply new balance effect on the (possibly different) account
				const newSign = newType === "in" ? 1 : -1;
				db.prepare("UPDATE finance_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?").run(
					newSign * newAmount,
					ts,
					newAccountId,
				);
			});
			run();

			return this.getTransaction(id);
		},

		deleteTransaction(id: number): boolean {
			const existing = this.getTransaction(id);
			if (!existing) return false;
			const db = getDb();
			const ts = now();
			let deleted = false;

			const run = db.transaction(() => {
				// Reverse balance effect
				const sign = existing.transaction_type === "in" ? 1 : -1;
				db.prepare("UPDATE finance_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?").run(
					sign * existing.amount,
					ts,
					existing.account_id,
				);

				const result = db.prepare("DELETE FROM finance_transactions WHERE id = ?").run(id);
				deleted = result.changes > 0;
			});
			run();

			return deleted;
		},

		searchTransactions(query: string, limit: number = 50): Transaction[] {
			return this.getTransactions({ search: query, limit });
		},

		linkTransactions(id1: number, id2: number): boolean {
			const tx1 = this.getTransaction(id1);
			const tx2 = this.getTransaction(id2);
			if (!tx1 || !tx2) return false;
			if (tx1.account_id === tx2.account_id) return false; // same account makes no sense
			const db = getDb();
			const ts = now();
			const run = db.transaction(() => {
				db.prepare("UPDATE finance_transactions SET linked_transaction_id = ?, updated_at = ? WHERE id = ?").run(id2, ts, id1);
				db.prepare("UPDATE finance_transactions SET linked_transaction_id = ?, updated_at = ? WHERE id = ?").run(id1, ts, id2);
			});
			run();
			return true;
		},

		unlinkTransaction(id: number): boolean {
			const tx = this.getTransaction(id);
			if (!tx || !tx.linked_transaction_id) return false;
			const db = getDb();
			const ts = now();
			const linkedId = tx.linked_transaction_id;
			const run = db.transaction(() => {
				db.prepare("UPDATE finance_transactions SET linked_transaction_id = NULL, updated_at = ? WHERE id = ?").run(ts, id);
				db.prepare("UPDATE finance_transactions SET linked_transaction_id = NULL, updated_at = ? WHERE id = ?").run(ts, linkedId);
			});
			run();
			return true;
		},

		findTransferMatches(id: number, limit: number = 10): Transaction[] {
			const tx = this.getTransaction(id);
			if (!tx) return [];
			// Find unlinked transactions on different accounts with matching amount and close dates
			return getDb()
				.prepare(
					`SELECT t.*, a.name as account_name, c.name as category_name
					 FROM finance_transactions t
					 LEFT JOIN finance_accounts a ON t.account_id = a.id
					 LEFT JOIN finance_categories c ON t.category_id = c.id
					 WHERE t.id != ?
					   AND t.account_id != ?
					   AND t.linked_transaction_id IS NULL
					   AND ABS(t.amount - ?) < 0.01
					   AND ABS(julianday(t.date) - julianday(?)) <= 3
					 ORDER BY ABS(julianday(t.date) - julianday(?)) ASC
					 LIMIT ?`,
				)
				.all(id, tx.account_id, tx.amount, tx.date, tx.date, limit) as Transaction[];
		},

		// ── Budgets ───────────────────────────────────────────

		getBudgets(year?: number, month?: number): Budget[] {
			const y = year ?? new Date().getFullYear();
			const conditions = ["b.year = ?"];
			const params: any[] = [y];
			if (month !== undefined) {
				conditions.push("(b.month = ? OR b.month IS NULL)");
				params.push(month);
			}
			return getDb()
				.prepare(
					`SELECT b.*, c.name as category_name
					 FROM finance_budgets b
					 LEFT JOIN finance_categories c ON b.category_id = c.id
					 WHERE ${conditions.join(" AND ")}
					 ORDER BY c.name`,
				)
				.all(...params) as Budget[];
		},

		getBudget(id: number): Budget | null {
			return (
				(getDb()
					.prepare(
						`SELECT b.*, c.name as category_name
						 FROM finance_budgets b
						 LEFT JOIN finance_categories c ON b.category_id = c.id
						 WHERE b.id = ?`,
					)
					.get(id) as Budget) ?? null
			);
		},

		createBudget(data: CreateBudgetData): Budget {
			const db = getDb();
			const result = db
				.prepare(
					`INSERT INTO finance_budgets (category_id, amount, period, month, year)
					 VALUES (?, ?, ?, ?, ?)`,
				)
				.run(
					data.category_id,
					data.amount,
					data.period ?? "monthly",
					data.month ?? null,
					data.year ?? new Date().getFullYear(),
				);
			return this.getBudget(Number(result.lastInsertRowid))!;
		},

		updateBudget(id: number, data: UpdateBudgetData): Budget | null {
			const existing = this.getBudget(id);
			if (!existing) return null;
			getDb()
				.prepare(
					`UPDATE finance_budgets SET amount = ?, period = ?, month = ?, year = ? WHERE id = ?`,
				)
				.run(
					data.amount ?? existing.amount,
					data.period ?? existing.period,
					data.month !== undefined ? data.month : existing.month,
					data.year ?? existing.year,
					id,
				);
			return this.getBudget(id);
		},

		deleteBudget(id: number): boolean {
			return getDb().prepare("DELETE FROM finance_budgets WHERE id = ?").run(id).changes > 0;
		},

		getBudgetStatus(year: number, month: number): Budget[] {
			const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
			const dateTo = `${year}-${String(month).padStart(2, "0")}-31`;

			return getDb()
				.prepare(
					`SELECT b.*, c.name as category_name,
					        COALESCE((
								SELECT SUM(t.amount) FROM finance_transactions t
								WHERE t.category_id = b.category_id
								  AND t.transaction_type = 'out'
								  AND t.date >= ? AND t.date <= ?
								  AND ${REPORT_EXCLUDE_SQL}
							), 0) as spent
					 FROM finance_budgets b
					 LEFT JOIN finance_categories c ON b.category_id = c.id
					 WHERE b.year = ? AND (b.month = ? OR b.month IS NULL)
					 ORDER BY c.name`,
				)
				.all(dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS, year, month) as Budget[];
		},

		// ── Goals ─────────────────────────────────────────────

		getGoals(status?: GoalStatus): Goal[] {
			if (status) {
				return getDb()
					.prepare("SELECT * FROM finance_goals WHERE status = ? ORDER BY deadline, name")
					.all(status) as Goal[];
			}
			return getDb().prepare("SELECT * FROM finance_goals ORDER BY status, deadline, name").all() as Goal[];
		},

		getGoal(id: number): Goal | null {
			return (getDb().prepare("SELECT * FROM finance_goals WHERE id = ?").get(id) as Goal) ?? null;
		},

		createGoal(data: CreateGoalData): Goal {
			const db = getDb();
			const ts = now();
			const result = db
				.prepare(
					`INSERT INTO finance_goals (name, goal_type, target_amount, current_amount, deadline, notes, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(data.name, data.goal_type, data.target_amount, data.current_amount ?? 0, data.deadline ?? null, data.notes ?? null, ts, ts);
			return this.getGoal(Number(result.lastInsertRowid))!;
		},

		updateGoal(id: number, data: UpdateGoalData): Goal | null {
			const existing = this.getGoal(id);
			if (!existing) return null;
			const ts = now();
			getDb()
				.prepare(
					`UPDATE finance_goals
					 SET name = ?, goal_type = ?, target_amount = ?, current_amount = ?,
					     deadline = ?, status = ?, notes = ?, updated_at = ?
					 WHERE id = ?`,
				)
				.run(
					data.name ?? existing.name,
					data.goal_type ?? existing.goal_type,
					data.target_amount ?? existing.target_amount,
					data.current_amount ?? existing.current_amount,
					data.deadline !== undefined ? data.deadline : existing.deadline,
					data.status ?? existing.status,
					data.notes !== undefined ? data.notes : existing.notes,
					ts,
					id,
				);
			return this.getGoal(id);
		},

		deleteGoal(id: number): boolean {
			return getDb().prepare("DELETE FROM finance_goals WHERE id = ?").run(id).changes > 0;
		},

		// ── Recurring ─────────────────────────────────────────

		getRecurring(activeOnly: boolean = true): RecurringTransaction[] {
			const where = activeOnly ? "WHERE r.active = 1" : "";
			return getDb()
				.prepare(
					`SELECT r.*, a.name as account_name, c.name as category_name
					 FROM finance_recurring r
					 LEFT JOIN finance_accounts a ON r.account_id = a.id
					 LEFT JOIN finance_categories c ON r.category_id = c.id
					 ${where}
					 ORDER BY r.next_date`,
				)
				.all() as RecurringTransaction[];
		},

		getRecurringById(id: number): RecurringTransaction | null {
			return (
				(getDb()
					.prepare(
						`SELECT r.*, a.name as account_name, c.name as category_name
						 FROM finance_recurring r
						 LEFT JOIN finance_accounts a ON r.account_id = a.id
						 LEFT JOIN finance_categories c ON r.category_id = c.id
						 WHERE r.id = ?`,
					)
					.get(id) as RecurringTransaction) ?? null
			);
		},

		createRecurring(data: CreateRecurringData): RecurringTransaction {
			const db = getDb();
			const result = db
				.prepare(
					`INSERT INTO finance_recurring (account_id, category_id, amount, transaction_type, description, frequency, next_date)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					data.account_id,
					data.category_id ?? null,
					data.amount,
					data.transaction_type,
					data.description,
					data.frequency,
					data.next_date,
				);
			return this.getRecurringById(Number(result.lastInsertRowid))!;
		},

		updateRecurring(id: number, data: UpdateRecurringData): RecurringTransaction | null {
			const existing = this.getRecurringById(id);
			if (!existing) return null;
			getDb()
				.prepare(
					`UPDATE finance_recurring
					 SET account_id = ?, category_id = ?, amount = ?, transaction_type = ?,
					     description = ?, frequency = ?, next_date = ?, active = ?
					 WHERE id = ?`,
				)
				.run(
					data.account_id ?? existing.account_id,
					data.category_id !== undefined ? data.category_id : existing.category_id,
					data.amount ?? existing.amount,
					data.transaction_type ?? existing.transaction_type,
					data.description ?? existing.description,
					data.frequency ?? existing.frequency,
					data.next_date ?? existing.next_date,
					data.active !== undefined ? (data.active ? 1 : 0) : (existing.active ? 1 : 0),
					id,
				);
			return this.getRecurringById(id);
		},

		deleteRecurring(id: number): boolean {
			return getDb().prepare("DELETE FROM finance_recurring WHERE id = ?").run(id).changes > 0;
		},

		processDueRecurring(): Transaction[] {
			const todayStr = today();
			const due = getDb()
				.prepare(
					`SELECT r.*, a.name as account_name, c.name as category_name
					 FROM finance_recurring r
					 LEFT JOIN finance_accounts a ON r.account_id = a.id
					 LEFT JOIN finance_categories c ON r.category_id = c.id
					 WHERE r.active = 1 AND r.next_date <= ?`,
				)
				.all(todayStr) as RecurringTransaction[];

			const created: Transaction[] = [];
			for (const r of due) {
				// Create the transaction
				const tx = this.createTransaction({
					account_id: r.account_id,
					category_id: r.category_id ?? undefined,
					amount: r.amount,
					transaction_type: r.transaction_type,
					description: r.description,
					date: r.next_date,
					recurring_id: r.id,
				});
				created.push(tx);

				// Advance next_date
				const nextDate = advanceDate(r.next_date, r.frequency);
				getDb()
					.prepare("UPDATE finance_recurring SET next_date = ? WHERE id = ?")
					.run(nextDate, r.id);
			}
			return created;
		},

		getUpcomingRecurring(days: number = 30): RecurringTransaction[] {
			const todayStr = today();
			const futureDate = (() => {
				const d = new Date(todayStr + "T12:00:00Z");
				d.setUTCDate(d.getUTCDate() + days);
				return d.toISOString().slice(0, 10);
			})();

			return getDb()
				.prepare(
					`SELECT r.*, a.name as account_name, c.name as category_name
					 FROM finance_recurring r
					 LEFT JOIN finance_accounts a ON r.account_id = a.id
					 LEFT JOIN finance_categories c ON r.category_id = c.id
					 WHERE r.active = 1 AND r.next_date <= ?
					 ORDER BY r.next_date`,
				)
				.all(futureDate) as RecurringTransaction[];
		},

		// ── Vendors ───────────────────────────────────────────

		getVendors(includeIgnored: boolean = false): Vendor[] {
			const where = includeIgnored ? "" : "WHERE v.ignore = 0";
			return getDb()
				.prepare(
					`SELECT v.*, c.name as category_name,
					        (SELECT COUNT(*) FROM finance_transactions t WHERE t.vendor_id = v.id) as transaction_count
					 FROM finance_vendors v
					 LEFT JOIN finance_categories c ON v.category_id = c.id
					 ${where}
					 ORDER BY v.name`,
				)
				.all() as Vendor[];
		},

		getVendor(id: number): Vendor | null {
			return (
				(getDb()
					.prepare(
						`SELECT v.*, c.name as category_name,
						        (SELECT COUNT(*) FROM finance_transactions t WHERE t.vendor_id = v.id) as transaction_count
						 FROM finance_vendors v
						 LEFT JOIN finance_categories c ON v.category_id = c.id
						 WHERE v.id = ?`,
					)
					.get(id) as Vendor) ?? null
			);
		},

		createVendor(data: CreateVendorData): Vendor {
			const db = getDb();
			const ts = now();
			const result = db
				.prepare(
					`INSERT INTO finance_vendors (name, country, category_id, ignore, notes, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					data.name,
					data.country ?? null,
					data.category_id ?? null,
					data.ignore ? 1 : 0,
					data.notes ?? null,
					ts,
					ts,
				);
			return this.getVendor(Number(result.lastInsertRowid))!;
		},

		updateVendor(id: number, data: UpdateVendorData): Vendor | null {
			const existing = this.getVendor(id);
			if (!existing) return null;
			const ts = now();
			getDb()
				.prepare(
					`UPDATE finance_vendors
					 SET name = ?, country = ?, category_id = ?, ignore = ?, notes = ?, updated_at = ?
					 WHERE id = ?`,
				)
				.run(
					data.name ?? existing.name,
					data.country !== undefined ? data.country : existing.country,
					data.category_id !== undefined ? data.category_id : existing.category_id,
					data.ignore !== undefined ? (data.ignore ? 1 : 0) : (existing.ignore ? 1 : 0),
					data.notes !== undefined ? data.notes : existing.notes,
					ts,
					id,
				);
			return this.getVendor(id);
		},

		deleteVendor(id: number): boolean {
			// Clear vendor_id from transactions before deleting
			getDb().prepare("UPDATE finance_transactions SET vendor_id = NULL WHERE vendor_id = ?").run(id);
			const result = getDb().prepare("DELETE FROM finance_vendors WHERE id = ?").run(id);
			return result.changes > 0;
		},

		findVendorByName(name: string): Vendor | null {
			return (
				(getDb()
					.prepare(
						`SELECT v.*, c.name as category_name,
						        (SELECT COUNT(*) FROM finance_transactions t WHERE t.vendor_id = v.id) as transaction_count
						 FROM finance_vendors v
						 LEFT JOIN finance_categories c ON v.category_id = c.id
						 WHERE LOWER(v.name) = LOWER(?)`,
					)
					.get(name) as Vendor) ?? null
			);
		},

		matchVendor(description: string): Vendor | null {
			const vendors = this.getVendors(false);
			const descLower = description.toLowerCase();
			// Find best match — longest vendor name that appears in the description
			let bestMatch: Vendor | null = null;
			let bestLen = 0;
			for (const v of vendors) {
				const vLower = v.name.toLowerCase();
				if (descLower.includes(vLower) && vLower.length > bestLen) {
					bestMatch = v;
					bestLen = vLower.length;
				}
			}
			return bestMatch;
		},

		// ── Reports ───────────────────────────────────────────

		getSpendingSummary(year: number, month?: number): SpendingSummary {
			let dateFrom: string;
			let dateTo: string;
			let period: string;

			if (month !== undefined) {
				dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
				dateTo = `${year}-${String(month).padStart(2, "0")}-31`;
				period = `${year}-${String(month).padStart(2, "0")}`;
			} else {
				dateFrom = `${year}-01-01`;
				dateTo = `${year}-12-31`;
				period = `${year}`;
			}

			const incomeRow = getDb()
				.prepare(
					`SELECT COALESCE(SUM(t.amount), 0) as total FROM finance_transactions t
					 WHERE t.transaction_type = 'in' AND t.date >= ? AND t.date <= ? AND ${REPORT_EXCLUDE_SQL}`,
				)
				.get(dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS) as any;

			const expenseRow = getDb()
				.prepare(
					`SELECT COALESCE(SUM(t.amount), 0) as total FROM finance_transactions t
					 WHERE t.transaction_type = 'out' AND t.date >= ? AND t.date <= ? AND ${REPORT_EXCLUDE_SQL}`,
				)
				.get(dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS) as any;

			const byCategory = getDb()
				.prepare(
					`SELECT t.category_id, COALESCE(c.name, 'Uncategorized') as category_name, SUM(t.amount) as amount
					 FROM finance_transactions t
					 LEFT JOIN finance_categories c ON t.category_id = c.id
					 WHERE t.transaction_type = 'out' AND t.date >= ? AND t.date <= ? AND ${REPORT_EXCLUDE_SQL}
					 GROUP BY t.category_id
					 ORDER BY amount DESC`,
				)
				.all(dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS) as any[];

			return {
				period,
				total_income: incomeRow.total,
				total_expenses: expenseRow.total,
				net: incomeRow.total - expenseRow.total,
				by_category: byCategory,
			};
		},

		getCategoryBreakdown(year: number, month?: number, type?: TransactionType): CategoryBreakdown[] {
			let dateFrom: string;
			let dateTo: string;

			if (month !== undefined) {
				dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
				dateTo = `${year}-${String(month).padStart(2, "0")}-31`;
			} else {
				dateFrom = `${year}-01-01`;
				dateTo = `${year}-12-31`;
			}

			const txType = type ?? "out";

			const rows = getDb()
				.prepare(
					`SELECT t.category_id, COALESCE(c.name, 'Uncategorized') as category_name,
					        SUM(t.amount) as amount, COUNT(*) as transaction_count
					 FROM finance_transactions t
					 LEFT JOIN finance_categories c ON t.category_id = c.id
					 WHERE t.transaction_type = ? AND t.date >= ? AND t.date <= ? AND ${REPORT_EXCLUDE_SQL}
					 GROUP BY t.category_id
					 ORDER BY amount DESC`,
				)
				.all(txType, dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS) as any[];

			const total = rows.reduce((sum: number, r: any) => sum + r.amount, 0);

			return rows.map((r: any) => ({
				category_id: r.category_id,
				category_name: r.category_name,
				amount: r.amount,
				percentage: total > 0 ? Math.round((r.amount / total) * 10000) / 100 : 0,
				transaction_count: r.transaction_count,
			}));
		},

		getCategoryBreakdownByRange(dateFrom: string, dateTo: string, type?: TransactionType): CategoryBreakdown[] {
			const txType = type ?? "out";

			const rows = getDb()
				.prepare(
					`SELECT t.category_id, COALESCE(c.name, 'Uncategorized') as category_name,
					        SUM(t.amount) as amount, COUNT(*) as transaction_count
					 FROM finance_transactions t
					 LEFT JOIN finance_categories c ON t.category_id = c.id
					 WHERE t.transaction_type = ? AND t.date >= ? AND t.date <= ? AND ${REPORT_EXCLUDE_SQL}
					 GROUP BY t.category_id
					 ORDER BY amount DESC`,
				)
				.all(txType, dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS) as any[];

			const total = rows.reduce((sum: number, r: any) => sum + r.amount, 0);

			return rows.map((r: any) => ({
				category_id: r.category_id,
				category_name: r.category_name,
				amount: r.amount,
				percentage: total > 0 ? Math.round((r.amount / total) * 10000) / 100 : 0,
				transaction_count: r.transaction_count,
			}));
		},

		getMonthlyTrend(months: number = 12, dateFrom?: string, dateTo?: string): MonthlyTrend[] {
			let startMonth: string;
			let endMonth: string | undefined;

			if (dateFrom) {
				startMonth = dateFrom.slice(0, 7); // "YYYY-MM"
			} else {
				const d = new Date();
				d.setUTCDate(1);
				d.setUTCMonth(d.getUTCMonth() - months + 1);
				startMonth = d.toISOString().slice(0, 7);
			}

			if (dateTo) {
				endMonth = dateTo.slice(0, 7);
			}

			const whereClauses = [`substr(t.date, 1, 7) >= ?`, REPORT_EXCLUDE_SQL];
			const params: unknown[] = [startMonth, ...REPORT_EXCLUDE_PARAMS];

			if (endMonth) {
				whereClauses.push(`substr(t.date, 1, 7) <= ?`);
				params.push(endMonth);
			}

			const rows = getDb()
				.prepare(
					`SELECT
						substr(t.date, 1, 7) as month,
						SUM(CASE WHEN t.transaction_type = 'in' THEN t.amount ELSE 0 END) as income,
						SUM(CASE WHEN t.transaction_type = 'out' THEN t.amount ELSE 0 END) as expenses
					 FROM finance_transactions t
					 WHERE ${whereClauses.join(' AND ')}
					 GROUP BY substr(t.date, 1, 7)
					 ORDER BY month`,
				)
				.all(...params) as { month: string; income: number; expenses: number }[];

			return rows.map((r) => ({
				month: r.month,
				income: r.income,
				expenses: r.expenses,
				net: r.income - r.expenses,
			}));
		},

		// ── Import/Export ─────────────────────────────────────

		importTransactionsCsv(csv: string, accountId: number): { imported: number; errors: string[] } {
			const lines = csv.trim().split("\n");
			if (lines.length < 2) return { imported: 0, errors: ["CSV must have a header row and at least one data row"] };

			const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
			const dateIdx = header.findIndex((h) => h === "date" || h === "dato");
			const amountIdx = header.findIndex((h) => h === "amount" || h === "beløp" || h === "belop");
			const descIdx = header.findIndex((h) => h === "description" || h === "beskrivelse" || h === "text" || h === "tekst");

			if (dateIdx === -1 || amountIdx === -1) {
				return { imported: 0, errors: ["CSV must have 'date' and 'amount' columns"] };
			}

			let imported = 0;
			const errors: string[] = [];

			for (let i = 1; i < lines.length; i++) {
				const line = lines[i].trim();
				if (!line) continue;

				// Simple CSV parsing (handles quoted fields)
				const fields = parseCsvLine(line);

				try {
					const date = fields[dateIdx]?.trim();
					const amountStr = fields[amountIdx]?.trim().replace(/\s/g, "").replace(",", ".");
					const amount = parseFloat(amountStr);
					const description = fields[descIdx]?.trim() ?? `Import row ${i}`;

					if (!date || isNaN(amount)) {
						errors.push(`Row ${i + 1}: invalid date or amount`);
						continue;
					}

					// Normalize date to YYYY-MM-DD
					const normalizedDate = normalizeDate(date);
					if (!normalizedDate) {
						errors.push(`Row ${i + 1}: unparseable date "${date}"`);
						continue;
					}

					this.createTransaction({
						account_id: accountId,
						amount: Math.abs(amount),
						transaction_type: amount >= 0 ? "in" : "out",
						description,
						date: normalizedDate,
					});
					imported++;
				} catch (err: any) {
					errors.push(`Row ${i + 1}: ${err.message}`);
				}
			}

			return { imported, errors };
		},

		exportTransactionsCsv(filters?: TransactionFilters): string {
			const transactions = this.getTransactions({ ...filters, limit: 100000 });
			const header = "date,type,amount,description,category,account,notes,tags";
			const rows = transactions.map((t) => {
				const tags = t.tags ? JSON.parse(t.tags).join(";") : "";
				return [
					t.date,
					t.transaction_type,
					t.amount,
					csvEscape(t.description),
					csvEscape(t.category_name ?? ""),
					csvEscape(t.account_name ?? ""),
					csvEscape(t.notes ?? ""),
					csvEscape(tags),
				].join(",");
			});
			return [header, ...rows].join("\n");
		},
	};
}

// ── CSV Helpers ─────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else {
			if (ch === '"') {
				inQuotes = true;
			} else if (ch === ",") {
				fields.push(current);
				current = "";
			} else {
				current += ch;
			}
		}
	}
	fields.push(current);
	return fields;
}

function csvEscape(value: string): string {
	if (value.includes(",") || value.includes('"') || value.includes("\n")) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function normalizeDate(input: string): string | null {
	// Try YYYY-MM-DD
	if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;

	// Try DD.MM.YYYY (Norwegian)
	const dotMatch = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
	if (dotMatch) return `${dotMatch[3]}-${dotMatch[2].padStart(2, "0")}-${dotMatch[1].padStart(2, "0")}`;

	// Try DD/MM/YYYY — assume day-first for slash-separated dates
	// (Norwegian/European convention; US MM/DD/YYYY is ambiguous with the same regex)
	const slashMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (slashMatch) return `${slashMatch[3]}-${slashMatch[2].padStart(2, "0")}-${slashMatch[1].padStart(2, "0")}`;

	return null;
}
