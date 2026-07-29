/**
 * pi-myfinance — Core types and interfaces.
 */

// ── Account ─────────────────────────────────────────────────────

export type AccountType = "checking" | "savings" | "credit" | "cash" | "investment";

export interface Account {
	id: number;
	name: string;
	account_type: AccountType;
	currency: string; // ISO 4217 (NOK, USD, EUR)
	balance: number; // Current balance in minor units (øre/cents)
	notes?: string;
	created_at: string;
	updated_at: string;
}

export interface CreateAccountData {
	name: string;
	account_type: AccountType;
	currency?: string; // Defaults to NOK
	balance?: number; // Defaults to 0
	notes?: string;
}

export interface UpdateAccountData {
	name?: string;
	account_type?: AccountType;
	currency?: string;
	balance?: number;
	notes?: string;
}

// ── Category ────────────────────────────────────────────────────

export type CategoryType = "income" | "expense" | "both";

export interface Category {
	id: number;
	name: string;
	parent_id?: number;
	icon?: string; // Emoji
	category_type: CategoryType;
	created_at: string;
}

export interface CreateCategoryData {
	name: string;
	parent_id?: number;
	icon?: string;
	category_type?: CategoryType; // Defaults to "expense"
}

// ── Transaction ─────────────────────────────────────────────────

export type TransactionType = "in" | "out";

export interface Transaction {
	id: number;
	account_id: number;
	category_id?: number;
	vendor_id?: number;
	amount: number; // Always positive, type determines direction
	transaction_type: TransactionType;
	description: string;
	date: string; // YYYY-MM-DD
	tags?: string; // JSON array
	notes?: string;
	recurring_id?: number;
	linked_transaction_id?: number;
	created_at: string;
	updated_at: string;
	// Denormalized for display
	account_name?: string;
	category_name?: string;
	vendor_name?: string;
	// Denormalized from linked transaction (for transfers)
	linked_account_id?: number;
	linked_account_name?: string;
}

export interface CreateTransactionData {
	account_id: number;
	category_id?: number;
	vendor_id?: number;
	amount: number;
	transaction_type: TransactionType;
	description: string;
	date?: string; // Defaults to today
	tags?: string[];
	notes?: string;
	recurring_id?: number;
}

export interface UpdateTransactionData {
	account_id?: number;
	category_id?: number;
	vendor_id?: number;
	amount?: number;
	transaction_type?: TransactionType;
	description?: string;
	date?: string;
	tags?: string[];
	notes?: string;
}

export interface TransactionFilters {
	account_id?: number;
	category_id?: number;
	category_ids?: number[];
	transaction_type?: TransactionType;
	date_from?: string; // YYYY-MM-DD
	date_to?: string; // YYYY-MM-DD
	search?: string; // Text search on description/notes
	limit?: number;
	offset?: number;
}

// ── Budget ──────────────────────────────────────────────────────

export type BudgetPeriod = "monthly" | "annual";

export interface Budget {
	id: number;
	category_id: number;
	amount: number; // Budgeted amount
	period: BudgetPeriod;
	month?: number; // 1-12 (for monthly)
	year: number;
	created_at: string;
	// Denormalized
	category_name?: string;
	spent?: number; // Calculated: total expenses in this category for the period
}

export interface CreateBudgetData {
	category_id: number;
	amount: number;
	period?: BudgetPeriod; // Defaults to "monthly"
	month?: number;
	year?: number; // Defaults to current year
}

export interface UpdateBudgetData {
	amount?: number;
	period?: BudgetPeriod;
	month?: number;
	year?: number;
}

// ── Goal ────────────────────────────────────────────────────────

export type GoalType = "savings" | "debt" | "purchase";
export type GoalStatus = "active" | "completed" | "cancelled";

export interface Goal {
	id: number;
	name: string;
	goal_type: GoalType;
	target_amount: number;
	current_amount: number;
	deadline?: string; // YYYY-MM-DD
	status: GoalStatus;
	notes?: string;
	created_at: string;
	updated_at: string;
}

export interface CreateGoalData {
	name: string;
	goal_type: GoalType;
	target_amount: number;
	current_amount?: number; // Defaults to 0
	deadline?: string;
	notes?: string;
}

export interface UpdateGoalData {
	name?: string;
	goal_type?: GoalType;
	target_amount?: number;
	current_amount?: number;
	deadline?: string;
	status?: GoalStatus;
	notes?: string;
}

// ── Recurring Transaction ───────────────────────────────────────

export type RecurringFrequency = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export interface RecurringTransaction {
	id: number;
	account_id: number;
	category_id?: number;
	amount: number;
	transaction_type: TransactionType;
	description: string;
	frequency: RecurringFrequency;
	next_date: string; // YYYY-MM-DD
	active: boolean;
	created_at: string;
	// Denormalized
	account_name?: string;
	category_name?: string;
}

export interface CreateRecurringData {
	account_id: number;
	category_id?: number;
	amount: number;
	transaction_type: TransactionType;
	description: string;
	frequency: RecurringFrequency;
	next_date: string; // YYYY-MM-DD
}

export interface UpdateRecurringData {
	account_id?: number;
	category_id?: number;
	amount?: number;
	transaction_type?: TransactionType;
	description?: string;
	frequency?: RecurringFrequency;
	next_date?: string;
	active?: boolean;
}

// ── Category Keyword (auto-categorization rules) ────────────────

export type KeywordMatchType = "contains" | "exact" | "starts_with" | "regex";

export interface CategoryKeyword {
	id: number;
	category_id: number;
	keyword: string;
	match_type: KeywordMatchType;
	case_sensitive: boolean;
	priority: number; // Higher = checked first
	created_at: string;
	// Denormalized
	category_name?: string;
}

export interface CreateCategoryKeywordData {
	category_id: number;
	keyword: string;
	match_type?: KeywordMatchType; // Defaults to "contains"
	case_sensitive?: boolean; // Defaults to false
	priority?: number; // Defaults to 0
}

export interface UpdateCategoryKeywordData {
	category_id?: number;
	keyword?: string;
	match_type?: KeywordMatchType;
	case_sensitive?: boolean;
	priority?: number;
}

// ── Vendor ──────────────────────────────────────────────────────

export interface Vendor {
	id: number;
	name: string;
	country?: string; // ISO 3166-1 alpha-2 (NO, US, SE, etc.)
	category_id?: number;
	ignore: boolean; // If true, vendor is hidden from lists
	notes?: string;
	created_at: string;
	updated_at: string;
	// Denormalized
	category_name?: string;
	transaction_count?: number;
}

export interface CreateVendorData {
	name: string;
	country?: string;
	category_id?: number;
	ignore?: boolean;
	notes?: string;
}

export interface UpdateVendorData {
	name?: string;
	country?: string;
	category_id?: number;
	ignore?: boolean;
	notes?: string;
}

// ── Report Types ────────────────────────────────────────────────

export interface SpendingSummary {
	period: string; // "2026-02" or "2026"
	total_income: number;
	total_expenses: number;
	net: number;
	by_category: { category_id: number; category_name: string; amount: number }[];
}

export interface CategoryBreakdown {
	category_id: number;
	category_name: string;
	amount: number;
	percentage: number;
	transaction_count: number;
}

export interface MonthlyTrend {
	month: string; // "YYYY-MM"
	income: number;
	expenses: number;
	net: number;
}

// ── Finance Store Interface ─────────────────────────────────────

/**
 * Finance store — unified async interface over multiple backends.
 *
 * All methods return Promises so both sync (SQLite) and async (Kysely)
 * backends can satisfy the same contract.
 */
export interface FinanceStore {
	// Accounts
	getAccounts(): Promise<Account[]>;
	getAccount(id: number): Promise<Account | null>;
	createAccount(data: CreateAccountData): Promise<Account>;
	updateAccount(id: number, data: UpdateAccountData): Promise<Account | null>;
	deleteAccount(id: number): Promise<boolean>;

	// Categories
	getCategories(): Promise<Category[]>;
	getCategory(id: number): Promise<Category | null>;
	createCategory(data: CreateCategoryData): Promise<Category>;

	// Category Keywords (auto-categorization rules)
	getCategoryKeywords(categoryId?: number): Promise<CategoryKeyword[]>;
	getCategoryKeyword(id: number): Promise<CategoryKeyword | null>;
	createCategoryKeyword(data: CreateCategoryKeywordData): Promise<CategoryKeyword>;
	updateCategoryKeyword(id: number, data: UpdateCategoryKeywordData): Promise<CategoryKeyword | null>;
	deleteCategoryKeyword(id: number): Promise<boolean>;
	matchKeyword(description: string): Promise<{ category_id: number; category_name: string } | null>;

	// Transactions
	getTransactions(filters?: TransactionFilters): Promise<Transaction[]>;
	getTransaction(id: number): Promise<Transaction | null>;
	createTransaction(data: CreateTransactionData): Promise<Transaction>;
	updateTransaction(id: number, data: UpdateTransactionData): Promise<Transaction | null>;
	deleteTransaction(id: number): Promise<boolean>;
	searchTransactions(query: string, limit?: number): Promise<Transaction[]>;
	linkTransactions(id1: number, id2: number): Promise<boolean>;
	unlinkTransaction(id: number): Promise<boolean>;
	findTransferMatches(id: number, limit?: number): Promise<Transaction[]>;

	// Budgets
	getBudgets(year?: number, month?: number): Promise<Budget[]>;
	getBudget(id: number): Promise<Budget | null>;
	createBudget(data: CreateBudgetData): Promise<Budget>;
	updateBudget(id: number, data: UpdateBudgetData): Promise<Budget | null>;
	deleteBudget(id: number): Promise<boolean>;
	getBudgetStatus(year: number, month: number): Promise<Budget[]>;

	// Goals
	getGoals(status?: GoalStatus): Promise<Goal[]>;
	getGoal(id: number): Promise<Goal | null>;
	createGoal(data: CreateGoalData): Promise<Goal>;
	updateGoal(id: number, data: UpdateGoalData): Promise<Goal | null>;
	deleteGoal(id: number): Promise<boolean>;

	// Recurring
	getRecurring(activeOnly?: boolean): Promise<RecurringTransaction[]>;
	getRecurringById(id: number): Promise<RecurringTransaction | null>;
	createRecurring(data: CreateRecurringData): Promise<RecurringTransaction>;
	updateRecurring(id: number, data: UpdateRecurringData): Promise<RecurringTransaction | null>;
	deleteRecurring(id: number): Promise<boolean>;
	processDueRecurring(): Promise<Transaction[]>;
	getUpcomingRecurring(days?: number): Promise<RecurringTransaction[]>;

	// Vendors
	getVendors(includeIgnored?: boolean): Promise<Vendor[]>;
	getVendor(id: number): Promise<Vendor | null>;
	createVendor(data: CreateVendorData): Promise<Vendor>;
	updateVendor(id: number, data: UpdateVendorData): Promise<Vendor | null>;
	deleteVendor(id: number): Promise<boolean>;
	findVendorByName(name: string): Promise<Vendor | null>;
	matchVendor(description: string): Promise<Vendor | null>;

	// Reports
	getSpendingSummary(year: number, month?: number): Promise<SpendingSummary>;
	getCategoryBreakdown(year: number, month?: number, type?: TransactionType): Promise<CategoryBreakdown[]>;
	getCategoryBreakdownByRange(dateFrom: string, dateTo: string, type?: TransactionType): Promise<CategoryBreakdown[]>;
	getMonthlyTrend(months?: number, dateFrom?: string, dateTo?: string): Promise<MonthlyTrend[]>;

	// Import/Export
	importTransactionsCsv(csv: string, accountId: number): Promise<{ imported: number; errors: string[] }>;
	exportTransactionsCsv(filters?: TransactionFilters): Promise<string>;
}
