/**
 * pi-myfinance — Database layer via pi-kysely event bus.
 *
 * Drop-in async replacement for db.ts + store.ts. No direct imports
 * from pi-kysely, no better-sqlite3 dependency. All DB access via events:
 *
 *   - kysely:info   — detect SQL dialect (sqlite/postgres/mysql)
 *   - kysely:schema:register — table creation (portable DDL)
 *   - kysely:query  — raw SQL for reads/writes
 *   - kysely:migration:apply — tracked migrations
 *
 * Requires pi-kysely extension to be loaded.
 */

import type {
	FinanceStore,
	Account, CreateAccountData, UpdateAccountData,
	Category, CreateCategoryData,
	CategoryKeyword, CreateCategoryKeywordData, UpdateCategoryKeywordData,
	Transaction, CreateTransactionData, UpdateTransactionData, TransactionFilters,
	Budget, CreateBudgetData, UpdateBudgetData,
	Goal, CreateGoalData, UpdateGoalData, GoalStatus,
	RecurringTransaction, CreateRecurringData, UpdateRecurringData, RecurringFrequency,
	SpendingSummary, CategoryBreakdown, MonthlyTrend,
	TransactionType,
	Vendor, CreateVendorData, UpdateVendorData,
} from "./types.ts";

const ACTOR = "pi-myfinance";

type Driver = "sqlite" | "postgres" | "mysql";

let events: { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void };
let driver: Driver = "sqlite";

// ── Schema (portable DDL via pi-kysely schema builder) ──────────

const SCHEMA = {
	actor: ACTOR,
	tables: {
		finance_accounts: {
			columns: {
				id:           { type: "integer" as const, primaryKey: true, autoIncrement: true },
				name:         { type: "text" as const, notNull: true },
				account_type: { type: "text" as const, notNull: true },
				currency:     { type: "text" as const, notNull: true, default: "'NOK'" },
				balance:      { type: "real" as const, notNull: true, default: "0" },
				notes:        { type: "text" as const },
				created_at:   { type: "text" as const, notNull: true },
				updated_at:   { type: "text" as const, notNull: true },
			},
		},
		finance_categories: {
			columns: {
				id:            { type: "integer" as const, primaryKey: true, autoIncrement: true },
				name:          { type: "text" as const, notNull: true },
				parent_id:     { type: "integer" as const, references: "finance_categories.id", onDelete: "set null" as const },
				icon:          { type: "text" as const },
				category_type: { type: "text" as const, notNull: true, default: "'expense'" },
				created_at:    { type: "text" as const, notNull: true },
			},
		},
		finance_vendors: {
			columns: {
				id:          { type: "integer" as const, primaryKey: true, autoIncrement: true },
				name:        { type: "text" as const, notNull: true },
				country:     { type: "text" as const },
				category_id: { type: "integer" as const, references: "finance_categories.id", onDelete: "set null" as const },
				ignore:      { type: "integer" as const, notNull: true, default: "0" },
				notes:       { type: "text" as const },
				created_at:  { type: "text" as const, notNull: true },
				updated_at:  { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["name"], name: "idx_fin_vendor_name", unique: true },
			],
		},
		finance_transactions: {
			columns: {
				id:                     { type: "integer" as const, primaryKey: true, autoIncrement: true },
				account_id:             { type: "integer" as const, notNull: true, references: "finance_accounts.id", onDelete: "cascade" as const },
				category_id:            { type: "integer" as const, references: "finance_categories.id", onDelete: "set null" as const },
				amount:                 { type: "real" as const, notNull: true },
				transaction_type:       { type: "text" as const, notNull: true },
				description:            { type: "text" as const, notNull: true },
				date:                   { type: "text" as const, notNull: true },
				tags:                   { type: "text" as const },
				notes:                  { type: "text" as const },
				recurring_id:           { type: "integer" as const, references: "finance_recurring.id", onDelete: "set null" as const },
				linked_transaction_id:  { type: "integer" as const },
				vendor_id:              { type: "integer" as const, references: "finance_vendors.id", onDelete: "set null" as const },
				created_at:             { type: "text" as const, notNull: true },
				updated_at:             { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["date"], name: "idx_fin_tx_date" },
				{ columns: ["account_id"], name: "idx_fin_tx_account" },
				{ columns: ["category_id"], name: "idx_fin_tx_category" },
				{ columns: ["transaction_type"], name: "idx_fin_tx_type" },
				{ columns: ["linked_transaction_id"], name: "idx_fin_tx_linked" },
				{ columns: ["vendor_id"], name: "idx_fin_tx_vendor" },
			],
		},
		finance_budgets: {
			columns: {
				id:          { type: "integer" as const, primaryKey: true, autoIncrement: true },
				category_id: { type: "integer" as const, notNull: true, references: "finance_categories.id", onDelete: "cascade" as const },
				amount:      { type: "real" as const, notNull: true },
				period:      { type: "text" as const, notNull: true, default: "'monthly'" },
				month:       { type: "integer" as const },
				year:        { type: "integer" as const, notNull: true },
				created_at:  { type: "text" as const, notNull: true },
			},
			unique: [["category_id", "period", "month", "year"]],
		},
		finance_goals: {
			columns: {
				id:             { type: "integer" as const, primaryKey: true, autoIncrement: true },
				name:           { type: "text" as const, notNull: true },
				goal_type:      { type: "text" as const, notNull: true },
				target_amount:  { type: "real" as const, notNull: true },
				current_amount: { type: "real" as const, notNull: true, default: "0" },
				deadline:       { type: "text" as const },
				status:         { type: "text" as const, notNull: true, default: "'active'" },
				notes:          { type: "text" as const },
				created_at:     { type: "text" as const, notNull: true },
				updated_at:     { type: "text" as const, notNull: true },
			},
		},
		finance_recurring: {
			columns: {
				id:               { type: "integer" as const, primaryKey: true, autoIncrement: true },
				account_id:       { type: "integer" as const, notNull: true, references: "finance_accounts.id", onDelete: "cascade" as const },
				category_id:      { type: "integer" as const, references: "finance_categories.id", onDelete: "set null" as const },
				amount:           { type: "real" as const, notNull: true },
				transaction_type: { type: "text" as const, notNull: true },
				description:      { type: "text" as const, notNull: true },
				frequency:        { type: "text" as const, notNull: true },
				next_date:        { type: "text" as const, notNull: true },
				active:           { type: "integer" as const, notNull: true, default: "1" },
				created_at:       { type: "text" as const, notNull: true },
			},
		},
		finance_category_keywords: {
			columns: {
				id:             { type: "integer" as const, primaryKey: true, autoIncrement: true },
				category_id:    { type: "integer" as const, notNull: true, references: "finance_categories.id", onDelete: "cascade" as const },
				keyword:        { type: "text" as const, notNull: true },
				match_type:     { type: "text" as const, notNull: true, default: "'contains'" },
				case_sensitive: { type: "integer" as const, notNull: true, default: "0" },
				priority:       { type: "integer" as const, notNull: true, default: "0" },
				created_at:     { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["category_id"], name: "idx_fin_kw_category" },
			],
		},
	},
};

// ── Default categories (seeded on first init) ───────────────────

const DEFAULT_CATEGORIES: { name: string; icon: string; type: string; children?: { name: string; icon: string }[] }[] = [
	{
		name: "Housing", icon: "🏠", type: "expense",
		children: [
			{ name: "Rent/Mortgage", icon: "🏠" }, { name: "Utilities", icon: "💡" },
			{ name: "Insurance", icon: "🛡️" }, { name: "Maintenance", icon: "🔧" },
		],
	},
	{
		name: "Food", icon: "🍽️", type: "expense",
		children: [
			{ name: "Groceries", icon: "🛒" }, { name: "Restaurants", icon: "🍕" }, { name: "Coffee", icon: "☕" },
		],
	},
	{
		name: "Transport", icon: "🚗", type: "expense",
		children: [
			{ name: "Public Transit", icon: "🚌" }, { name: "Fuel", icon: "⛽" },
			{ name: "Car Insurance", icon: "🚙" }, { name: "Parking", icon: "🅿️" },
		],
	},
	{
		name: "Entertainment", icon: "🎮", type: "expense",
		children: [
			{ name: "Subscriptions", icon: "📺" }, { name: "Games", icon: "🎮" },
			{ name: "Movies/Events", icon: "🎬" }, { name: "Hobbies", icon: "🎨" },
		],
	},
	{
		name: "Health", icon: "🏥", type: "expense",
		children: [
			{ name: "Doctor", icon: "👨‍⚕️" }, { name: "Pharmacy", icon: "💊" }, { name: "Gym/Fitness", icon: "🏋️" },
		],
	},
	{
		name: "Shopping", icon: "🛍️", type: "expense",
		children: [
			{ name: "Clothing", icon: "👕" }, { name: "Electronics", icon: "📱" }, { name: "Household", icon: "🏡" },
		],
	},
	{
		name: "Education", icon: "📚", type: "expense",
		children: [{ name: "Books", icon: "📖" }, { name: "Courses", icon: "🎓" }],
	},
	{
		name: "Personal", icon: "👤", type: "expense",
		children: [{ name: "Gifts", icon: "🎁" }, { name: "Personal Care", icon: "💈" }],
	},
	{
		name: "Income", icon: "💰", type: "income",
		children: [
			{ name: "Salary", icon: "💵" }, { name: "Freelance", icon: "💻" },
			{ name: "Investments", icon: "📈" }, { name: "Other Income", icon: "💸" },
		],
	},
	{ name: "Savings", icon: "🏦", type: "both" },
	{ name: "Transfers", icon: "🔄", type: "both" },
	{ name: "Uncategorized", icon: "❓", type: "both" },
];

// ── Default keyword rules (seeded on first init) ────────────────
// match_type: "contains" = keyword anywhere in description
//             "regex"    = full regex pattern
//             "exact"    = exact match
//             "starts_with" = description starts with keyword

const DEFAULT_KEYWORDS: { categoryName: string; keyword: string; match_type: string; priority?: number }[] = [
	// Groceries
	{ categoryName: "Groceries", keyword: "rema", match_type: "contains" },
	{ categoryName: "Groceries", keyword: "kiwi", match_type: "contains" },
	{ categoryName: "Groceries", keyword: "meny", match_type: "contains" },
	{ categoryName: "Groceries", keyword: "coop", match_type: "contains" },
	{ categoryName: "Groceries", keyword: "extra", match_type: "contains" },
	{ categoryName: "Groceries", keyword: "bunnpris", match_type: "contains" },
	{ categoryName: "Groceries", keyword: "spar", match_type: "contains" },
	{ categoryName: "Groceries", keyword: "oda.com", match_type: "contains" },
	{ categoryName: "Groceries", keyword: "colonial", match_type: "contains" },

	// Restaurants
	{ categoryName: "Restaurants", keyword: "restaurant", match_type: "contains" },
	{ categoryName: "Restaurants", keyword: "pizza", match_type: "contains" },
	{ categoryName: "Restaurants", keyword: "sushi", match_type: "contains" },
	{ categoryName: "Restaurants", keyword: "mcdonald", match_type: "contains" },
	{ categoryName: "Restaurants", keyword: "burger king", match_type: "contains" },
	{ categoryName: "Restaurants", keyword: "subway", match_type: "contains" },
	{ categoryName: "Restaurants", keyword: "wolt", match_type: "contains" },
	{ categoryName: "Restaurants", keyword: "foodora", match_type: "contains" },
	{ categoryName: "Restaurants", keyword: "just eat", match_type: "contains" },

	// Coffee
	{ categoryName: "Coffee", keyword: "café", match_type: "contains" },
	{ categoryName: "Coffee", keyword: "cafe", match_type: "contains" },
	{ categoryName: "Coffee", keyword: "starbucks", match_type: "contains" },
	{ categoryName: "Coffee", keyword: "tim horton", match_type: "contains" },
	{ categoryName: "Coffee", keyword: "espresso", match_type: "contains" },

	// Public Transit
	{ categoryName: "Public Transit", keyword: "ruter", match_type: "contains" },
	{ categoryName: "Public Transit", keyword: "vy ", match_type: "contains" },
	{ categoryName: "Public Transit", keyword: "taxi", match_type: "contains" },
	{ categoryName: "Public Transit", keyword: "uber", match_type: "contains" },

	// Fuel
	{ categoryName: "Fuel", keyword: "circle k", match_type: "contains" },
	{ categoryName: "Fuel", keyword: "shell", match_type: "contains" },
	{ categoryName: "Fuel", keyword: "esso", match_type: "contains" },
	{ categoryName: "Fuel", keyword: "uno-x", match_type: "contains" },
	{ categoryName: "Fuel", keyword: "unox", match_type: "contains" },

	// Parking
	{ categoryName: "Parking", keyword: "parker", match_type: "contains" },
	{ categoryName: "Parking", keyword: "easypark", match_type: "contains" },

	// Subscriptions
	{ categoryName: "Subscriptions", keyword: "netflix", match_type: "contains" },
	{ categoryName: "Subscriptions", keyword: "spotify", match_type: "contains" },
	{ categoryName: "Subscriptions", keyword: "hbo", match_type: "contains" },
	{ categoryName: "Subscriptions", keyword: "disney", match_type: "contains" },
	{ categoryName: "Subscriptions", keyword: "apple.com", match_type: "contains" },
	{ categoryName: "Subscriptions", keyword: "viaplay", match_type: "contains" },

	// Clothing
	{ categoryName: "Clothing", keyword: "h&m", match_type: "contains" },
	{ categoryName: "Clothing", keyword: "zara", match_type: "contains" },

	// Household
	{ categoryName: "Household", keyword: "ikea", match_type: "contains" },
	{ categoryName: "Household", keyword: "jysk", match_type: "contains" },
	{ categoryName: "Household", keyword: "clas ohlson", match_type: "contains" },
	{ categoryName: "Household", keyword: "biltema", match_type: "contains" },

	// Shopping (generic)
	{ categoryName: "Shopping", keyword: "amazon", match_type: "contains", priority: -1 },

	// Electronics
	{ categoryName: "Electronics", keyword: "komplett", match_type: "contains" },
	{ categoryName: "Electronics", keyword: "elkjøp", match_type: "contains" },
	{ categoryName: "Electronics", keyword: "elkjop", match_type: "contains" },
	{ categoryName: "Electronics", keyword: "power", match_type: "contains" },

	// Pharmacy
	{ categoryName: "Pharmacy", keyword: "apotek", match_type: "contains" },
	{ categoryName: "Pharmacy", keyword: "vitus", match_type: "contains" },

	// Doctor
	{ categoryName: "Doctor", keyword: "lege", match_type: "contains" },
	{ categoryName: "Doctor", keyword: "tannlege", match_type: "contains" },

	// Gym/Fitness
	{ categoryName: "Gym/Fitness", keyword: "sats", match_type: "contains" },
	{ categoryName: "Gym/Fitness", keyword: "elixia", match_type: "contains" },

	// Courses
	{ categoryName: "Courses", keyword: "udemy", match_type: "contains" },
	{ categoryName: "Courses", keyword: "coursera", match_type: "contains" },

	// Books
	{ categoryName: "Books", keyword: "adlibris", match_type: "contains" },
	{ categoryName: "Books", keyword: "kindle", match_type: "contains" },

	// Housing
	{ categoryName: "Rent/Mortgage", keyword: "husleie", match_type: "contains" },
	{ categoryName: "Rent/Mortgage", keyword: "leilighet", match_type: "contains" },
	{ categoryName: "Insurance", keyword: "forsikring", match_type: "contains" },
	{ categoryName: "Insurance", keyword: "gjensidige", match_type: "contains" },
	{ categoryName: "Utilities", keyword: "strøm", match_type: "contains" },
	{ categoryName: "Utilities", keyword: "strom", match_type: "contains" },
	{ categoryName: "Utilities", keyword: "tibber", match_type: "contains" },
	{ categoryName: "Utilities", keyword: "hafslund", match_type: "contains" },
	{ categoryName: "Utilities", keyword: "telenor", match_type: "contains" },
	{ categoryName: "Utilities", keyword: "telia", match_type: "contains" },
	{ categoryName: "Utilities", keyword: "ice.net", match_type: "contains" },

	// Transfers
	{ categoryName: "Transfers", keyword: "overføring", match_type: "contains" },
	{ categoryName: "Transfers", keyword: "overforing", match_type: "contains" },

	// Income
	{ categoryName: "Salary", keyword: "lønn", match_type: "contains" },
	{ categoryName: "Salary", keyword: "lonn", match_type: "contains" },
	{ categoryName: "Salary", keyword: "salary", match_type: "contains" },
];

// ── Init ────────────────────────────────────────────────────────

export async function initDb(eventBus: typeof events): Promise<void> {
	events = eventBus;

	// Detect SQL dialect from pi-kysely
	events.emit("kysely:info", {
		reply: (info: { defaultDriver?: string }) => {
			if (info.defaultDriver === "postgres" || info.defaultDriver === "mysql") {
				driver = info.defaultDriver;
			}
		},
	});

	// Schema:register — creates tables if they don't exist
	await new Promise<void>((resolve, reject) => {
		events.emit("kysely:schema:register", {
			...SCHEMA,
			reply: (result: { ok: boolean; errors: string[] }) => {
				if (result.ok) resolve();
				else reject(new Error(`Schema register failed: ${result.errors.join("; ")}`));
			},
		});
	});

	// Seed categories if empty
	const catResult = await q("SELECT COUNT(*) as cnt FROM finance_categories");
	const catCount = Number(catResult.rows[0]?.cnt ?? 0);
	if (catCount === 0) {
		await seedCategories();
	}

	// Seed keywords if empty
	const kwResult = await q("SELECT COUNT(*) as cnt FROM finance_category_keywords");
	const kwCount = Number(kwResult.rows[0]?.cnt ?? 0);
	if (kwCount === 0) {
		await seedKeywords();
	}
}

async function seedCategories(): Promise<void> {
	const ts = now();
	for (const cat of DEFAULT_CATEGORIES) {
		const result = await q(
			"INSERT INTO finance_categories (name, parent_id, icon, category_type, created_at) VALUES (?, ?, ?, ?, ?)",
			[cat.name, null, cat.icon, cat.type, ts],
		);
		const parentId = result.insertId;
		if (cat.children) {
			for (const child of cat.children) {
				await q(
					"INSERT INTO finance_categories (name, parent_id, icon, category_type, created_at) VALUES (?, ?, ?, ?, ?)",
					[child.name, parentId, child.icon, cat.type, ts],
				);
			}
		}
	}
}

async function seedKeywords(): Promise<void> {
	const ts = now();
	// Build name→id lookup from existing categories
	const catResult = await q("SELECT id, name FROM finance_categories");
	const catByName = new Map(catResult.rows.map((r: any) => [r.name, Number(r.id)]));

	for (const kw of DEFAULT_KEYWORDS) {
		const catId = catByName.get(kw.categoryName);
		if (!catId) continue; // Category doesn't exist, skip
		await q(
			"INSERT INTO finance_category_keywords (category_id, keyword, match_type, case_sensitive, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			[catId, kw.keyword, kw.match_type, 0, kw.priority ?? 0, ts],
		);
	}
}

// ── Query helper ────────────────────────────────────────────────

interface QueryResult {
	rows: Record<string, unknown>[];
	numAffectedRows?: number;
	insertId?: number | bigint;
}

function q(sql: string, params: unknown[] = []): Promise<QueryResult> {
	return new Promise((resolve, reject) => {
		events.emit("kysely:query", {
			actor: ACTOR,
			input: { sql, params },
			reply: (result: QueryResult) => resolve(result),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});
}

// ── Helpers ─────────────────────────────────────────────────────

function now(): string {
	return new Date().toISOString();
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Descriptions excluded from all report/summary queries (e.g. balance adjustments). */
const REPORT_EXCLUSIONS = ["Opening Balance Adjustment", "Balance Adjustment", "Opening Balance"];
const REPORT_EXCLUDE_SQL = REPORT_EXCLUSIONS.map(() => "t.description != ?").join(" AND ");
const REPORT_EXCLUDE_PARAMS = REPORT_EXCLUSIONS;

function first<T>(rows: Record<string, unknown>[]): T | null {
	return (rows[0] as T) ?? null;
}

function advanceDate(dateStr: string, frequency: RecurringFrequency): string {
	const d = new Date(dateStr + "T12:00:00Z");
	switch (frequency) {
		case "daily": d.setUTCDate(d.getUTCDate() + 1); break;
		case "weekly": d.setUTCDate(d.getUTCDate() + 7); break;
		case "biweekly": d.setUTCDate(d.getUTCDate() + 14); break;
		case "monthly": d.setUTCMonth(d.getUTCMonth() + 1); break;
		case "quarterly": d.setUTCMonth(d.getUTCMonth() + 3); break;
		case "yearly": d.setUTCFullYear(d.getUTCFullYear() + 1); break;
	}
	return d.toISOString().slice(0, 10);
}

function normalizeDate(input: string): string | null {
	// DD.MM.YYYY
	const dotMatch = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
	if (dotMatch) return `${dotMatch[3]}-${dotMatch[2].padStart(2, "0")}-${dotMatch[1].padStart(2, "0")}`;
	// YYYY-MM-DD
	if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
	// MM/DD/YYYY
	const slashMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (slashMatch) return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
	return null;
}

function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
				else inQuotes = false;
			} else current += ch;
		} else {
			if (ch === '"') inQuotes = true;
			else if (ch === ",") { fields.push(current); current = ""; }
			else current += ch;
		}
	}
	fields.push(current);
	return fields;
}

function csvEscape(s: string): string {
	if (s.includes(",") || s.includes('"') || s.includes("\n")) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

// ── Store implementation (async, queries via events) ─────────────

// Transaction query builder
const TX_SELECT = `SELECT t.*, a.name as account_name, c.name as category_name,
	lt.account_id as linked_account_id, la.name as linked_account_name
	FROM finance_transactions t
	LEFT JOIN finance_accounts a ON t.account_id = a.id
	LEFT JOIN finance_categories c ON t.category_id = c.id
	LEFT JOIN finance_transactions lt ON t.linked_transaction_id = lt.id
	LEFT JOIN finance_accounts la ON lt.account_id = la.id`;

const RECURRING_SELECT = `SELECT r.*, a.name as account_name, c.name as category_name
	FROM finance_recurring r
	LEFT JOIN finance_accounts a ON r.account_id = a.id
	LEFT JOIN finance_categories c ON r.category_id = c.id`;

export const store: FinanceStore = {
	// ── Accounts ─────────────────────────────────────────────

	async getAccounts(): Promise<Account[]> {
		const r = await q("SELECT * FROM finance_accounts ORDER BY name");
		return r.rows as unknown as Account[];
	},

	async getAccount(id: number): Promise<Account | null> {
		const r = await q("SELECT * FROM finance_accounts WHERE id = ?", [id]);
		return first<Account>(r.rows);
	},

	async createAccount(data: CreateAccountData): Promise<Account> {
		const ts = now();
		const r = await q(
			`INSERT INTO finance_accounts (name, account_type, currency, balance, notes, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[data.name, data.account_type, data.currency ?? "NOK", data.balance ?? 0, data.notes ?? null, ts, ts],
		);
		return (await this.getAccount(Number(r.insertId)))!;
	},

	async updateAccount(id: number, data: UpdateAccountData): Promise<Account | null> {
		const existing = await this.getAccount(id);
		if (!existing) return null;
		const ts = now();
		await q(
			`UPDATE finance_accounts
			 SET name = ?, account_type = ?, currency = ?, balance = ?, notes = ?, updated_at = ?
			 WHERE id = ?`,
			[
				data.name ?? existing.name,
				data.account_type ?? existing.account_type,
				data.currency ?? existing.currency,
				data.balance ?? existing.balance,
				data.notes !== undefined ? data.notes : existing.notes,
				ts, id,
			],
		);
		return this.getAccount(id);
	},

	async deleteAccount(id: number): Promise<boolean> {
		const r = await q("DELETE FROM finance_accounts WHERE id = ?", [id]);
		return (r.numAffectedRows ?? 0) > 0;
	},

	// ── Categories ───────────────────────────────────────────

	async getCategories(): Promise<Category[]> {
		const r = await q("SELECT * FROM finance_categories ORDER BY parent_id IS NOT NULL, parent_id, name");
		return r.rows as unknown as Category[];
	},

	async getCategory(id: number): Promise<Category | null> {
		const r = await q("SELECT * FROM finance_categories WHERE id = ?", [id]);
		return first<Category>(r.rows);
	},

	async createCategory(data: CreateCategoryData): Promise<Category> {
		const ts = now();
		const r = await q(
			"INSERT INTO finance_categories (name, parent_id, icon, category_type, created_at) VALUES (?, ?, ?, ?, ?)",
			[data.name, data.parent_id ?? null, data.icon ?? null, data.category_type ?? "expense", ts],
		);
		return (await this.getCategory(Number(r.insertId)))!;
	},

	// ── Category Keywords ────────────────────────────────────

	async getCategoryKeywords(categoryId?: number): Promise<CategoryKeyword[]> {
		if (categoryId) {
			const r = await q(
				`SELECT k.*, c.name as category_name FROM finance_category_keywords k
				 LEFT JOIN finance_categories c ON k.category_id = c.id
				 WHERE k.category_id = ? ORDER BY k.priority DESC, k.keyword`,
				[categoryId],
			);
			return r.rows as unknown as CategoryKeyword[];
		}
		const r = await q(
			`SELECT k.*, c.name as category_name FROM finance_category_keywords k
			 LEFT JOIN finance_categories c ON k.category_id = c.id
			 ORDER BY k.priority DESC, c.name, k.keyword`,
		);
		return r.rows as unknown as CategoryKeyword[];
	},

	async getCategoryKeyword(id: number): Promise<CategoryKeyword | null> {
		const r = await q(
			`SELECT k.*, c.name as category_name FROM finance_category_keywords k
			 LEFT JOIN finance_categories c ON k.category_id = c.id WHERE k.id = ?`, [id],
		);
		return first<CategoryKeyword>(r.rows);
	},

	async createCategoryKeyword(data: CreateCategoryKeywordData): Promise<CategoryKeyword> {
		const ts = now();
		const r = await q(
			`INSERT INTO finance_category_keywords (category_id, keyword, match_type, case_sensitive, priority, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[data.category_id, data.keyword, data.match_type ?? "contains", data.case_sensitive ? 1 : 0, data.priority ?? 0, ts],
		);
		return (await this.getCategoryKeyword(Number(r.insertId)))!;
	},

	async updateCategoryKeyword(id: number, data: UpdateCategoryKeywordData): Promise<CategoryKeyword | null> {
		const existing = await this.getCategoryKeyword(id);
		if (!existing) return null;
		await q(
			`UPDATE finance_category_keywords
			 SET category_id = ?, keyword = ?, match_type = ?, case_sensitive = ?, priority = ?
			 WHERE id = ?`,
			[
				data.category_id ?? existing.category_id,
				data.keyword ?? existing.keyword,
				data.match_type ?? existing.match_type,
				data.case_sensitive !== undefined ? (data.case_sensitive ? 1 : 0) : (existing.case_sensitive ? 1 : 0),
				data.priority ?? existing.priority,
				id,
			],
		);
		return this.getCategoryKeyword(id);
	},

	async deleteCategoryKeyword(id: number): Promise<boolean> {
		const r = await q("DELETE FROM finance_category_keywords WHERE id = ?", [id]);
		return (r.numAffectedRows ?? 0) > 0;
	},

	async matchKeyword(description: string): Promise<{ category_id: number; category_name: string } | null> {
		const r = await q(
			`SELECT k.*, c.name as category_name FROM finance_category_keywords k
			 LEFT JOIN finance_categories c ON k.category_id = c.id
			 ORDER BY k.priority DESC, k.id ASC`,
		);
		const keywords = r.rows as unknown as CategoryKeyword[];
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
						matched = new RegExp(kw.keyword, flags).test(description);
					} catch { /* invalid regex, skip */ }
					break;
			}

			if (matched) {
				return { category_id: kw.category_id, category_name: kw.category_name ?? "Unknown" };
			}
		}
		return null;
	},

	// ── Transactions ─────────────────────────────────────────

	async getTransactions(filters?: TransactionFilters): Promise<Transaction[]> {
		const conditions: string[] = [];
		const params: any[] = [];

		if (filters?.account_id) { conditions.push("t.account_id = ?"); params.push(filters.account_id); }
		if (filters?.category_ids && filters.category_ids.length > 0) {
			const ph = filters.category_ids.map(() => "?").join(",");
			conditions.push(`t.category_id IN (${ph})`);
			params.push(...filters.category_ids);
		} else if (filters?.category_id) { conditions.push("t.category_id = ?"); params.push(filters.category_id); }
		if (filters?.transaction_type) { conditions.push("t.transaction_type = ?"); params.push(filters.transaction_type); }
		if (filters?.date_from) { conditions.push("t.date >= ?"); params.push(filters.date_from); }
		if (filters?.date_to) { conditions.push("t.date <= ?"); params.push(filters.date_to); }
		if (filters?.search) {
			conditions.push("(t.description LIKE ? OR t.notes LIKE ?)");
			params.push(`%${filters.search}%`, `%${filters.search}%`);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = filters?.limit ?? 100;
		const offset = filters?.offset ?? 0;

		const r = await q(
			`${TX_SELECT} ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
			[...params, limit, offset],
		);
		return r.rows as unknown as Transaction[];
	},

	async getTransaction(id: number): Promise<Transaction | null> {
		const r = await q(`${TX_SELECT} WHERE t.id = ?`, [id]);
		return first<Transaction>(r.rows);
	},

	async createTransaction(data: CreateTransactionData): Promise<Transaction> {
		const ts = now();
		const r = await q(
			`INSERT INTO finance_transactions
			 (account_id, category_id, vendor_id, amount, transaction_type, description, date, tags, notes, recurring_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				data.account_id, data.category_id ?? null, data.vendor_id ?? null, data.amount, data.transaction_type,
				data.description, data.date ?? today(),
				data.tags ? JSON.stringify(data.tags) : null,
				data.notes ?? null, data.recurring_id ?? null, ts, ts,
			],
		);

		// Update account balance
		const sign = data.transaction_type === "in" ? 1 : -1;
		await q("UPDATE finance_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?", [
			sign * data.amount, ts, data.account_id,
		]);

		return (await this.getTransaction(Number(r.insertId)))!;
	},

	async updateTransaction(id: number, data: UpdateTransactionData): Promise<Transaction | null> {
		const existing = await this.getTransaction(id);
		if (!existing) return null;
		const ts = now();

		// Reverse old balance effect
		const oldSign = existing.transaction_type === "in" ? 1 : -1;
		await q("UPDATE finance_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?", [
			oldSign * existing.amount, ts, existing.account_id,
		]);

		const newType = data.transaction_type ?? existing.transaction_type;
		const newAmount = data.amount ?? existing.amount;
		const newAccountId = data.account_id ?? existing.account_id;

		await q(
			`UPDATE finance_transactions
			 SET account_id = ?, category_id = ?, vendor_id = ?, amount = ?, transaction_type = ?,
			     description = ?, date = ?, tags = ?, notes = ?, updated_at = ?
			 WHERE id = ?`,
			[
				newAccountId,
				data.category_id !== undefined ? data.category_id : existing.category_id,
				data.vendor_id !== undefined ? data.vendor_id : existing.vendor_id,
				newAmount, newType,
				data.description ?? existing.description,
				data.date ?? existing.date,
				data.tags ? JSON.stringify(data.tags) : existing.tags,
				data.notes !== undefined ? data.notes : existing.notes,
				ts, id,
			],
		);

		// Apply new balance effect
		const newSign = newType === "in" ? 1 : -1;
		await q("UPDATE finance_accounts SET balance = balance + ?, updated_at = ? WHERE id = ?", [
			newSign * newAmount, ts, newAccountId,
		]);

		return this.getTransaction(id);
	},

	async deleteTransaction(id: number): Promise<boolean> {
		const existing = await this.getTransaction(id);
		if (!existing) return false;
		const ts = now();

		// Reverse balance effect
		const sign = existing.transaction_type === "in" ? 1 : -1;
		await q("UPDATE finance_accounts SET balance = balance - ?, updated_at = ? WHERE id = ?", [
			sign * existing.amount, ts, existing.account_id,
		]);

		const r = await q("DELETE FROM finance_transactions WHERE id = ?", [id]);
		return (r.numAffectedRows ?? 0) > 0;
	},

	async searchTransactions(query: string, limit: number = 50): Promise<Transaction[]> {
		return this.getTransactions({ search: query, limit });
	},

	async linkTransactions(id1: number, id2: number): Promise<boolean> {
		const tx1 = await this.getTransaction(id1);
		const tx2 = await this.getTransaction(id2);
		if (!tx1 || !tx2 || tx1.account_id === tx2.account_id) return false;
		const ts = now();
		await q("UPDATE finance_transactions SET linked_transaction_id = ?, updated_at = ? WHERE id = ?", [id2, ts, id1]);
		await q("UPDATE finance_transactions SET linked_transaction_id = ?, updated_at = ? WHERE id = ?", [id1, ts, id2]);
		return true;
	},

	async unlinkTransaction(id: number): Promise<boolean> {
		const tx = await this.getTransaction(id);
		if (!tx || !tx.linked_transaction_id) return false;
		const ts = now();
		await q("UPDATE finance_transactions SET linked_transaction_id = NULL, updated_at = ? WHERE id = ?", [ts, id]);
		await q("UPDATE finance_transactions SET linked_transaction_id = NULL, updated_at = ? WHERE id = ?", [ts, tx.linked_transaction_id]);
		return true;
	},

	async findTransferMatches(id: number, limit: number = 10): Promise<Transaction[]> {
		const tx = await this.getTransaction(id);
		if (!tx) return [];
		const r = await q(
			`${TX_SELECT}
			 WHERE t.id != ?
			   AND t.account_id != ?
			   AND t.linked_transaction_id IS NULL
			   AND ABS(t.amount - ?) < 0.01
			   AND ABS(julianday(t.date) - julianday(?)) <= 3
			 ORDER BY ABS(julianday(t.date) - julianday(?)) ASC
			 LIMIT ?`,
			[id, tx.account_id, tx.amount, tx.date, tx.date, limit],
		);
		return r.rows as unknown as Transaction[];
	},

	// ── Budgets ──────────────────────────────────────────────

	async getBudgets(year?: number, month?: number): Promise<Budget[]> {
		const y = year ?? new Date().getFullYear();
		const conditions = ["b.year = ?"];
		const params: any[] = [y];
		if (month !== undefined) { conditions.push("(b.month = ? OR b.month IS NULL)"); params.push(month); }
		const r = await q(
			`SELECT b.*, c.name as category_name
			 FROM finance_budgets b
			 LEFT JOIN finance_categories c ON b.category_id = c.id
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY c.name`,
			params,
		);
		return r.rows as unknown as Budget[];
	},

	async getBudget(id: number): Promise<Budget | null> {
		const r = await q(
			`SELECT b.*, c.name as category_name FROM finance_budgets b
			 LEFT JOIN finance_categories c ON b.category_id = c.id WHERE b.id = ?`, [id],
		);
		return first<Budget>(r.rows);
	},

	async createBudget(data: CreateBudgetData): Promise<Budget> {
		const ts = now();
		const r = await q(
			`INSERT INTO finance_budgets (category_id, amount, period, month, year, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			[data.category_id, data.amount, data.period ?? "monthly", data.month ?? null, data.year ?? new Date().getFullYear(), ts],
		);
		return (await this.getBudget(Number(r.insertId)))!;
	},

	async updateBudget(id: number, data: UpdateBudgetData): Promise<Budget | null> {
		const existing = await this.getBudget(id);
		if (!existing) return null;
		await q(
			"UPDATE finance_budgets SET amount = ?, period = ?, month = ?, year = ? WHERE id = ?",
			[data.amount ?? existing.amount, data.period ?? existing.period, data.month !== undefined ? data.month : existing.month, data.year ?? existing.year, id],
		);
		return this.getBudget(id);
	},

	async deleteBudget(id: number): Promise<boolean> {
		const r = await q("DELETE FROM finance_budgets WHERE id = ?", [id]);
		return (r.numAffectedRows ?? 0) > 0;
	},

	async getBudgetStatus(year: number, month: number): Promise<Budget[]> {
		const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
		const dateTo = `${year}-${String(month).padStart(2, "0")}-31`;
		const r = await q(
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
			[dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS, year, month],
		);
		return r.rows as unknown as Budget[];
	},

	// ── Goals ────────────────────────────────────────────────

	async getGoals(status?: GoalStatus): Promise<Goal[]> {
		if (status) {
			const r = await q("SELECT * FROM finance_goals WHERE status = ? ORDER BY deadline, name", [status]);
			return r.rows as unknown as Goal[];
		}
		const r = await q("SELECT * FROM finance_goals ORDER BY status, deadline, name");
		return r.rows as unknown as Goal[];
	},

	async getGoal(id: number): Promise<Goal | null> {
		const r = await q("SELECT * FROM finance_goals WHERE id = ?", [id]);
		return first<Goal>(r.rows);
	},

	async createGoal(data: CreateGoalData): Promise<Goal> {
		const ts = now();
		const r = await q(
			`INSERT INTO finance_goals (name, goal_type, target_amount, current_amount, deadline, notes, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[data.name, data.goal_type, data.target_amount, data.current_amount ?? 0, data.deadline ?? null, data.notes ?? null, ts, ts],
		);
		return (await this.getGoal(Number(r.insertId)))!;
	},

	async updateGoal(id: number, data: UpdateGoalData): Promise<Goal | null> {
		const existing = await this.getGoal(id);
		if (!existing) return null;
		const ts = now();
		await q(
			`UPDATE finance_goals
			 SET name = ?, goal_type = ?, target_amount = ?, current_amount = ?,
			     deadline = ?, status = ?, notes = ?, updated_at = ?
			 WHERE id = ?`,
			[
				data.name ?? existing.name, data.goal_type ?? existing.goal_type,
				data.target_amount ?? existing.target_amount, data.current_amount ?? existing.current_amount,
				data.deadline !== undefined ? data.deadline : existing.deadline,
				data.status ?? existing.status,
				data.notes !== undefined ? data.notes : existing.notes,
				ts, id,
			],
		);
		return this.getGoal(id);
	},

	async deleteGoal(id: number): Promise<boolean> {
		const r = await q("DELETE FROM finance_goals WHERE id = ?", [id]);
		return (r.numAffectedRows ?? 0) > 0;
	},

	// ── Recurring ────────────────────────────────────────────

	async getRecurring(activeOnly: boolean = true): Promise<RecurringTransaction[]> {
		const where = activeOnly ? "WHERE r.active = 1" : "";
		const r = await q(`${RECURRING_SELECT} ${where} ORDER BY r.next_date`);
		return r.rows as unknown as RecurringTransaction[];
	},

	async getRecurringById(id: number): Promise<RecurringTransaction | null> {
		const r = await q(`${RECURRING_SELECT} WHERE r.id = ?`, [id]);
		return first<RecurringTransaction>(r.rows);
	},

	async createRecurring(data: CreateRecurringData): Promise<RecurringTransaction> {
		const ts = now();
		const r = await q(
			`INSERT INTO finance_recurring (account_id, category_id, amount, transaction_type, description, frequency, next_date, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[data.account_id, data.category_id ?? null, data.amount, data.transaction_type, data.description, data.frequency, data.next_date, ts],
		);
		return (await this.getRecurringById(Number(r.insertId)))!;
	},

	async updateRecurring(id: number, data: UpdateRecurringData): Promise<RecurringTransaction | null> {
		const existing = await this.getRecurringById(id);
		if (!existing) return null;
		await q(
			`UPDATE finance_recurring
			 SET account_id = ?, category_id = ?, amount = ?, transaction_type = ?,
			     description = ?, frequency = ?, next_date = ?, active = ?
			 WHERE id = ?`,
			[
				data.account_id ?? existing.account_id,
				data.category_id !== undefined ? data.category_id : existing.category_id,
				data.amount ?? existing.amount,
				data.transaction_type ?? existing.transaction_type,
				data.description ?? existing.description,
				data.frequency ?? existing.frequency,
				data.next_date ?? existing.next_date,
				data.active !== undefined ? (data.active ? 1 : 0) : (existing.active ? 1 : 0),
				id,
			],
		);
		return this.getRecurringById(id);
	},

	async deleteRecurring(id: number): Promise<boolean> {
		const r = await q("DELETE FROM finance_recurring WHERE id = ?", [id]);
		return (r.numAffectedRows ?? 0) > 0;
	},

	async processDueRecurring(): Promise<Transaction[]> {
		const todayStr = today();
		const r = await q(`${RECURRING_SELECT} WHERE r.active = 1 AND r.next_date <= ?`, [todayStr]);
		const due = r.rows as unknown as RecurringTransaction[];

		const created: Transaction[] = [];
		for (const rec of due) {
			const tx = await this.createTransaction({
				account_id: rec.account_id,
				category_id: rec.category_id ?? undefined,
				amount: rec.amount,
				transaction_type: rec.transaction_type,
				description: rec.description,
				date: rec.next_date,
				recurring_id: rec.id,
			});
			created.push(tx);
			const nextDate = advanceDate(rec.next_date, rec.frequency as RecurringFrequency);
			await q("UPDATE finance_recurring SET next_date = ? WHERE id = ?", [nextDate, rec.id]);
		}
		return created;
	},

	async getUpcomingRecurring(days: number = 30): Promise<RecurringTransaction[]> {
		const todayStr = today();
		const futureDate = (() => {
			const d = new Date(todayStr + "T12:00:00Z");
			d.setUTCDate(d.getUTCDate() + days);
			return d.toISOString().slice(0, 10);
		})();
		const r = await q(`${RECURRING_SELECT} WHERE r.active = 1 AND r.next_date <= ? ORDER BY r.next_date`, [futureDate]);
		return r.rows as unknown as RecurringTransaction[];
	},

	// ── Vendors ──────────────────────────────────────────────

	async getVendors(includeIgnored: boolean = false): Promise<Vendor[]> {
		const where = includeIgnored ? "" : "WHERE v.ignore = 0";
		const r = await q(
			`SELECT v.*, c.name as category_name,
			        (SELECT COUNT(*) FROM finance_transactions t WHERE t.vendor_id = v.id) as transaction_count
			 FROM finance_vendors v
			 LEFT JOIN finance_categories c ON v.category_id = c.id
			 ${where}
			 ORDER BY v.name`,
		);
		return r.rows as unknown as Vendor[];
	},

	async getVendor(id: number): Promise<Vendor | null> {
		const r = await q(
			`SELECT v.*, c.name as category_name,
			        (SELECT COUNT(*) FROM finance_transactions t WHERE t.vendor_id = v.id) as transaction_count
			 FROM finance_vendors v
			 LEFT JOIN finance_categories c ON v.category_id = c.id
			 WHERE v.id = ?`,
			[id],
		);
		return first<Vendor>(r.rows);
	},

	async createVendor(data: CreateVendorData): Promise<Vendor> {
		const ts = now();
		const r = await q(
			`INSERT INTO finance_vendors (name, country, category_id, ignore, notes, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[data.name, data.country ?? null, data.category_id ?? null, data.ignore ? 1 : 0, data.notes ?? null, ts, ts],
		);
		return (await this.getVendor(Number(r.insertId)))!;
	},

	async updateVendor(id: number, data: UpdateVendorData): Promise<Vendor | null> {
		const existing = await this.getVendor(id);
		if (!existing) return null;
		const ts = now();
		await q(
			`UPDATE finance_vendors
			 SET name = ?, country = ?, category_id = ?, ignore = ?, notes = ?, updated_at = ?
			 WHERE id = ?`,
			[
				data.name ?? existing.name,
				data.country !== undefined ? data.country : existing.country,
				data.category_id !== undefined ? data.category_id : existing.category_id,
				data.ignore !== undefined ? (data.ignore ? 1 : 0) : (existing.ignore ? 1 : 0),
				data.notes !== undefined ? data.notes : existing.notes,
				ts,
				id,
			],
		);
		return this.getVendor(id);
	},

	async deleteVendor(id: number): Promise<boolean> {
		await q("UPDATE finance_transactions SET vendor_id = NULL WHERE vendor_id = ?", [id]);
		const r = await q("DELETE FROM finance_vendors WHERE id = ?", [id]);
		return (r.numAffectedRows ?? 0) > 0;
	},

	async findVendorByName(name: string): Promise<Vendor | null> {
		const r = await q(
			`SELECT v.*, c.name as category_name,
			        (SELECT COUNT(*) FROM finance_transactions t WHERE t.vendor_id = v.id) as transaction_count
			 FROM finance_vendors v
			 LEFT JOIN finance_categories c ON v.category_id = c.id
			 WHERE LOWER(v.name) = LOWER(?)`,
			[name],
		);
		return first<Vendor>(r.rows);
	},

	async matchVendor(description: string): Promise<Vendor | null> {
		const vendors = await this.getVendors(false);
		const descLower = description.toLowerCase();
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

	// ── Reports ──────────────────────────────────────────────

	async getSpendingSummary(year: number, month?: number): Promise<SpendingSummary> {
		let dateFrom: string, dateTo: string, period: string;
		if (month !== undefined) {
			dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
			dateTo = `${year}-${String(month).padStart(2, "0")}-31`;
			period = `${year}-${String(month).padStart(2, "0")}`;
		} else {
			dateFrom = `${year}-01-01`;
			dateTo = `${year}-12-31`;
			period = `${year}`;
		}

		const incR = await q(
			`SELECT COALESCE(SUM(amount), 0) as total FROM finance_transactions t WHERE transaction_type = 'in' AND date >= ? AND date <= ? AND ${REPORT_EXCLUDE_SQL}`,
			[dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS],
		);
		const expR = await q(
			`SELECT COALESCE(SUM(amount), 0) as total FROM finance_transactions t WHERE transaction_type = 'out' AND date >= ? AND date <= ? AND ${REPORT_EXCLUDE_SQL}`,
			[dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS],
		);
		const catR = await q(
			`SELECT t.category_id, COALESCE(c.name, 'Uncategorized') as category_name, SUM(t.amount) as amount
			 FROM finance_transactions t
			 LEFT JOIN finance_categories c ON t.category_id = c.id
			 WHERE t.transaction_type = 'out' AND t.date >= ? AND t.date <= ? AND ${REPORT_EXCLUDE_SQL}
			 GROUP BY t.category_id ORDER BY amount DESC`,
			[dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS],
		);

		const totalIncome = Number(incR.rows[0]?.total ?? 0);
		const totalExpenses = Number(expR.rows[0]?.total ?? 0);

		return {
			period,
			total_income: totalIncome,
			total_expenses: totalExpenses,
			net: totalIncome - totalExpenses,
			by_category: catR.rows as any,
		};
	},

	async getCategoryBreakdown(year: number, month?: number, type?: TransactionType): Promise<CategoryBreakdown[]> {
		let dateFrom: string, dateTo: string;
		if (month !== undefined) {
			dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
			dateTo = `${year}-${String(month).padStart(2, "0")}-31`;
		} else {
			dateFrom = `${year}-01-01`;
			dateTo = `${year}-12-31`;
		}
		const txType = type ?? "out";

		const r = await q(
			`SELECT t.category_id, COALESCE(c.name, 'Uncategorized') as category_name,
			        SUM(t.amount) as amount, COUNT(*) as transaction_count
			 FROM finance_transactions t
			 LEFT JOIN finance_categories c ON t.category_id = c.id
			 WHERE t.transaction_type = ? AND t.date >= ? AND t.date <= ? AND ${REPORT_EXCLUDE_SQL}
			 GROUP BY t.category_id ORDER BY amount DESC`,
			[txType, dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS],
		);

		const rows = r.rows as any[];
		const total = rows.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
		return rows.map((row: any) => ({
			category_id: row.category_id,
			category_name: row.category_name,
			amount: Number(row.amount),
			percentage: total > 0 ? Math.round((Number(row.amount) / total) * 10000) / 100 : 0,
			transaction_count: Number(row.transaction_count),
		}));
	},

	async getCategoryBreakdownByRange(dateFrom: string, dateTo: string, type?: TransactionType): Promise<CategoryBreakdown[]> {
		const txType = type ?? "out";

		const r = await q(
			`SELECT t.category_id, COALESCE(c.name, 'Uncategorized') as category_name,
			        SUM(t.amount) as amount, COUNT(*) as transaction_count
			 FROM finance_transactions t
			 LEFT JOIN finance_categories c ON t.category_id = c.id
			 WHERE t.transaction_type = ? AND t.date >= ? AND t.date <= ? AND ${REPORT_EXCLUDE_SQL}
			 GROUP BY t.category_id ORDER BY amount DESC`,
			[txType, dateFrom, dateTo, ...REPORT_EXCLUDE_PARAMS],
		);

		const rows = r.rows as any[];
		const total = rows.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
		return rows.map((row: any) => ({
			category_id: row.category_id,
			category_name: row.category_name,
			amount: Number(row.amount),
			percentage: total > 0 ? Math.round((Number(row.amount) / total) * 10000) / 100 : 0,
			transaction_count: Number(row.transaction_count),
		}));
	},

	async getMonthlyTrend(months: number = 12): Promise<MonthlyTrend[]> {
		const d = new Date();
		d.setUTCDate(1);
		d.setUTCMonth(d.getUTCMonth() - months + 1);
		const startMonth = d.toISOString().slice(0, 7);

		const r = await q(
			`SELECT
				substr(t.date, 1, 7) as month,
				SUM(CASE WHEN t.transaction_type = 'in' THEN t.amount ELSE 0 END) as income,
				SUM(CASE WHEN t.transaction_type = 'out' THEN t.amount ELSE 0 END) as expenses
			 FROM finance_transactions t
			 WHERE substr(t.date, 1, 7) >= ? AND ${REPORT_EXCLUDE_SQL}
			 GROUP BY substr(t.date, 1, 7)
			 ORDER BY month`,
			[startMonth, ...REPORT_EXCLUDE_PARAMS],
		);

		return (r.rows as any[]).map((row) => ({
			month: row.month,
			income: Number(row.income),
			expenses: Number(row.expenses),
			net: Number(row.income) - Number(row.expenses),
		}));
	},

	// ── Import/Export ─────────────────────────────────────────

	async importTransactionsCsv(csv: string, accountId: number): Promise<{ imported: number; errors: string[] }> {
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
			const fields = parseCsvLine(line);

			try {
				const date = fields[dateIdx]?.trim();
				const amountStr = fields[amountIdx]?.trim().replace(/\s/g, "").replace(",", ".");
				const amount = parseFloat(amountStr);
				const description = fields[descIdx]?.trim() ?? `Import row ${i}`;

				if (!date || isNaN(amount)) { errors.push(`Row ${i + 1}: invalid date or amount`); continue; }

				const normalizedDate = normalizeDate(date);
				if (!normalizedDate) { errors.push(`Row ${i + 1}: unparseable date "${date}"`); continue; }

				await this.createTransaction({
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

	async exportTransactionsCsv(filters?: TransactionFilters): Promise<string> {
		const transactions = await this.getTransactions({ ...filters, limit: 100000 });
		const header = "date,type,amount,description,category,account,notes,tags";
		const rows = transactions.map((t) => {
			const tags = t.tags ? JSON.parse(t.tags).join(";") : "";
			return [
				t.date, t.transaction_type, t.amount,
				csvEscape(t.description), csvEscape(t.category_name ?? ""),
				csvEscape(t.account_name ?? ""), csvEscape(t.notes ?? ""),
				csvEscape(tags),
			].join(",");
		});
		return [header, ...rows].join("\n");
	},
};
