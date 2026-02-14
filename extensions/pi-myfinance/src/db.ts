/**
 * pi-myfinance — Database layer.
 *
 * SQLite via better-sqlite3. Owns migrations and schema.
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

let db: DatabaseType;

// ── Schema ──────────────────────────────────────────────────────

const MIGRATIONS: { version: number; sql: string }[] = [
	{
		version: 1,
		sql: `
			-- v1 NOTE: linked_transaction_id added in v2
			CREATE TABLE IF NOT EXISTS finance_accounts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				account_type TEXT NOT NULL CHECK(account_type IN ('checking','savings','credit','cash','investment')),
				currency TEXT NOT NULL DEFAULT 'NOK',
				balance REAL NOT NULL DEFAULT 0,
				notes TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS finance_categories (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				parent_id INTEGER REFERENCES finance_categories(id) ON DELETE SET NULL,
				icon TEXT,
				category_type TEXT NOT NULL DEFAULT 'expense' CHECK(category_type IN ('income','expense','both')),
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS finance_transactions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				account_id INTEGER NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
				category_id INTEGER REFERENCES finance_categories(id) ON DELETE SET NULL,
				amount REAL NOT NULL,
				transaction_type TEXT NOT NULL CHECK(transaction_type IN ('income','expense','transfer')),
				description TEXT NOT NULL,
				date TEXT NOT NULL,
				tags TEXT,
				notes TEXT,
				recurring_id INTEGER REFERENCES finance_recurring(id) ON DELETE SET NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE INDEX IF NOT EXISTS idx_transactions_date ON finance_transactions(date);
			CREATE INDEX IF NOT EXISTS idx_transactions_account ON finance_transactions(account_id);
			CREATE INDEX IF NOT EXISTS idx_transactions_category ON finance_transactions(category_id);
			CREATE INDEX IF NOT EXISTS idx_transactions_type ON finance_transactions(transaction_type);

			CREATE TABLE IF NOT EXISTS finance_budgets (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				category_id INTEGER NOT NULL REFERENCES finance_categories(id) ON DELETE CASCADE,
				amount REAL NOT NULL,
				period TEXT NOT NULL DEFAULT 'monthly' CHECK(period IN ('monthly','annual')),
				month INTEGER,
				year INTEGER NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				UNIQUE(category_id, period, month, year)
			);

			CREATE TABLE IF NOT EXISTS finance_goals (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				goal_type TEXT NOT NULL CHECK(goal_type IN ('savings','debt','purchase')),
				target_amount REAL NOT NULL,
				current_amount REAL NOT NULL DEFAULT 0,
				deadline TEXT,
				status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
				notes TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);

			CREATE TABLE IF NOT EXISTS finance_recurring (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				account_id INTEGER NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
				category_id INTEGER REFERENCES finance_categories(id) ON DELETE SET NULL,
				amount REAL NOT NULL,
				transaction_type TEXT NOT NULL CHECK(transaction_type IN ('income','expense','transfer')),
				description TEXT NOT NULL,
				frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','biweekly','monthly','quarterly','yearly')),
				next_date TEXT NOT NULL,
				active INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
		`,
	},
	{
		version: 2,
		sql: `
			ALTER TABLE finance_transactions ADD COLUMN linked_transaction_id INTEGER REFERENCES finance_transactions(id) ON DELETE SET NULL;
			CREATE INDEX IF NOT EXISTS idx_transactions_linked ON finance_transactions(linked_transaction_id);
		`,
	},
	{
		version: 3,
		sql: `
			-- Rename transaction types: income→in, expense→out, transfer→out
			-- Must recreate tables because SQLite can't alter CHECK constraints

			-- 1. Transactions
			CREATE TABLE finance_transactions_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				account_id INTEGER NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
				category_id INTEGER REFERENCES finance_categories(id) ON DELETE SET NULL,
				amount REAL NOT NULL,
				transaction_type TEXT NOT NULL CHECK(transaction_type IN ('in','out')),
				description TEXT NOT NULL,
				date TEXT NOT NULL,
				tags TEXT,
				notes TEXT,
				recurring_id INTEGER REFERENCES finance_recurring(id) ON DELETE SET NULL,
				linked_transaction_id INTEGER,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			INSERT INTO finance_transactions_new
				SELECT id, account_id, category_id, amount,
					CASE transaction_type WHEN 'income' THEN 'in' WHEN 'expense' THEN 'out' ELSE 'out' END,
					description, date, tags, notes, recurring_id, linked_transaction_id, created_at, updated_at
				FROM finance_transactions;
			DROP TABLE finance_transactions;
			ALTER TABLE finance_transactions_new RENAME TO finance_transactions;
			CREATE INDEX idx_transactions_date ON finance_transactions(date);
			CREATE INDEX idx_transactions_account ON finance_transactions(account_id);
			CREATE INDEX idx_transactions_category ON finance_transactions(category_id);
			CREATE INDEX idx_transactions_type ON finance_transactions(transaction_type);
			CREATE INDEX idx_transactions_linked ON finance_transactions(linked_transaction_id);

			-- 2. Recurring
			CREATE TABLE finance_recurring_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				account_id INTEGER NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
				category_id INTEGER REFERENCES finance_categories(id) ON DELETE SET NULL,
				amount REAL NOT NULL,
				transaction_type TEXT NOT NULL CHECK(transaction_type IN ('in','out')),
				description TEXT NOT NULL,
				frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','biweekly','monthly','quarterly','yearly')),
				next_date TEXT NOT NULL,
				active INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			INSERT INTO finance_recurring_new
				SELECT id, account_id, category_id, amount,
					CASE transaction_type WHEN 'income' THEN 'in' WHEN 'expense' THEN 'out' ELSE 'out' END,
					description, frequency, next_date, active, created_at
				FROM finance_recurring;
			DROP TABLE finance_recurring;
			ALTER TABLE finance_recurring_new RENAME TO finance_recurring;

			-- 3. Recalculate all account balances (transfers previously had sign=0, now they're 'out' with sign=-1)
			UPDATE finance_accounts SET balance = COALESCE(
				(SELECT SUM(CASE WHEN transaction_type = 'in' THEN amount ELSE -amount END)
				 FROM finance_transactions WHERE account_id = finance_accounts.id), 0
			);
		`,
	},
	{
		version: 4,
		sql: `
			CREATE TABLE IF NOT EXISTS finance_category_keywords (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				category_id INTEGER NOT NULL REFERENCES finance_categories(id) ON DELETE CASCADE,
				keyword TEXT NOT NULL,
				match_type TEXT NOT NULL DEFAULT 'contains' CHECK(match_type IN ('contains','exact','starts_with','regex')),
				case_sensitive INTEGER NOT NULL DEFAULT 0,
				priority INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE INDEX IF NOT EXISTS idx_fin_kw_category ON finance_category_keywords(category_id);
		`,
	},

	{
		version: 5,
		sql: `
			CREATE TABLE IF NOT EXISTS finance_vendors (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				country TEXT,
				category_id INTEGER REFERENCES finance_categories(id) ON DELETE SET NULL,
				ignore INTEGER NOT NULL DEFAULT 0,
				notes TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_name ON finance_vendors(name COLLATE NOCASE);

			ALTER TABLE finance_transactions ADD COLUMN vendor_id INTEGER REFERENCES finance_vendors(id) ON DELETE SET NULL;
			CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON finance_transactions(vendor_id);
		`,
	},
];

const DEFAULT_CATEGORIES: { name: string; icon: string; type: string; children?: { name: string; icon: string }[] }[] = [
	{
		name: "Housing", icon: "🏠", type: "expense",
		children: [
			{ name: "Rent/Mortgage", icon: "🏠" },
			{ name: "Utilities", icon: "💡" },
			{ name: "Insurance", icon: "🛡️" },
			{ name: "Maintenance", icon: "🔧" },
		],
	},
	{
		name: "Food", icon: "🍽️", type: "expense",
		children: [
			{ name: "Groceries", icon: "🛒" },
			{ name: "Restaurants", icon: "🍕" },
			{ name: "Coffee", icon: "☕" },
		],
	},
	{
		name: "Transport", icon: "🚗", type: "expense",
		children: [
			{ name: "Public Transit", icon: "🚌" },
			{ name: "Fuel", icon: "⛽" },
			{ name: "Car Insurance", icon: "🚙" },
			{ name: "Parking", icon: "🅿️" },
		],
	},
	{
		name: "Entertainment", icon: "🎮", type: "expense",
		children: [
			{ name: "Subscriptions", icon: "📺" },
			{ name: "Games", icon: "🎮" },
			{ name: "Movies/Events", icon: "🎬" },
			{ name: "Hobbies", icon: "🎨" },
		],
	},
	{
		name: "Health", icon: "🏥", type: "expense",
		children: [
			{ name: "Doctor", icon: "👨‍⚕️" },
			{ name: "Pharmacy", icon: "💊" },
			{ name: "Gym/Fitness", icon: "🏋️" },
		],
	},
	{
		name: "Shopping", icon: "🛍️", type: "expense",
		children: [
			{ name: "Clothing", icon: "👕" },
			{ name: "Electronics", icon: "📱" },
			{ name: "Household", icon: "🏡" },
		],
	},
	{
		name: "Education", icon: "📚", type: "expense",
		children: [
			{ name: "Books", icon: "📖" },
			{ name: "Courses", icon: "🎓" },
		],
	},
	{
		name: "Personal", icon: "👤", type: "expense",
		children: [
			{ name: "Gifts", icon: "🎁" },
			{ name: "Personal Care", icon: "💈" },
		],
	},
	{
		name: "Income", icon: "💰", type: "income",
		children: [
			{ name: "Salary", icon: "💵" },
			{ name: "Freelance", icon: "💻" },
			{ name: "Investments", icon: "📈" },
			{ name: "Other Income", icon: "💸" },
		],
	},
	{ name: "Savings", icon: "🏦", type: "both" },
	{ name: "Transfers", icon: "🔄", type: "both" },
	{ name: "Uncategorized", icon: "❓", type: "both" },
];

// ── Init ────────────────────────────────────────────────────────

export function initDb(dbPath: string): DatabaseType {
	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	// Migration tracking
	db.exec(`
		CREATE TABLE IF NOT EXISTS finance_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)
	`);

	const applied = new Set(
		db
			.prepare("SELECT version FROM finance_migrations")
			.all()
			.map((r: any) => r.version),
	);

	for (const migration of MIGRATIONS) {
		if (!applied.has(migration.version)) {
			db.exec(migration.sql);
			db.prepare("INSERT INTO finance_migrations (version) VALUES (?)").run(migration.version);
		}
	}

	// Seed default categories if empty
	const catCount = db.prepare("SELECT COUNT(*) as cnt FROM finance_categories").get() as any;
	if (catCount.cnt === 0) {
		seedCategories();
	}

	// Seed default keywords if empty
	const kwCount = db.prepare("SELECT COUNT(*) as cnt FROM finance_category_keywords").get() as any;
	if (kwCount.cnt === 0) {
		seedKeywords();
	}

	return db;
}

function seedCategories() {
	const insertCat = db.prepare(
		"INSERT INTO finance_categories (name, parent_id, icon, category_type) VALUES (?, ?, ?, ?)",
	);

	const seedTransaction = db.transaction(() => {
		for (const cat of DEFAULT_CATEGORIES) {
			const result = insertCat.run(cat.name, null, cat.icon, cat.type);
			const parentId = result.lastInsertRowid;
			if (cat.children) {
				for (const child of cat.children) {
					insertCat.run(child.name, parentId, child.icon, cat.type);
				}
			}
		}
	});

	seedTransaction();
}

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
	// Shopping (generic, low priority)
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

function seedKeywords() {
	const cats = db.prepare("SELECT id, name FROM finance_categories").all() as { id: number; name: string }[];
	const catByName = new Map(cats.map((c) => [c.name, c.id]));

	const insertKw = db.prepare(
		"INSERT INTO finance_category_keywords (category_id, keyword, match_type, case_sensitive, priority) VALUES (?, ?, ?, 0, ?)",
	);

	const seedTransaction = db.transaction(() => {
		for (const kw of DEFAULT_KEYWORDS) {
			const catId = catByName.get(kw.categoryName);
			if (!catId) continue;
			insertKw.run(catId, kw.keyword, kw.match_type, kw.priority ?? 0);
		}
	});

	seedTransaction();
}

export function getDb(): DatabaseType {
	if (!db) throw new Error("Database not initialized — call initDb() first");
	return db;
}

export function closeDb() {
	if (db) db.close();
}
