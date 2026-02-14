# Finance Tool — Usage Examples

## Accounts

"Show my accounts"
→ `finance.list_accounts`

"Create a checking account called DNB Brukskonto with 50000 NOK"
→ `finance.add_account { name: "DNB Brukskonto", account_type: "checking", currency: "NOK", balance: 50000 }`

"Update my savings account balance to 200000"
→ `finance.update_account { id: 2, balance: 200000 }`

## Transactions

"I spent 850 NOK at REMA 1000 today"
→ `finance.add_transaction { account_id: 1, amount: 850, transaction_type: "expense", description: "REMA 1000", category_id: 5 }`

"I got paid 45000 NOK on Feb 1"
→ `finance.add_transaction { account_id: 1, amount: 45000, transaction_type: "income", description: "Monthly salary", date: "2026-02-01", category_id: 32 }`

"Show my transactions from this month"
→ `finance.list_transactions { date_from: "2026-02-01", date_to: "2026-02-28" }`

"Search for Netflix transactions"
→ `finance.search_transactions { query: "Netflix" }`

## Categories

"Show all categories"
→ `finance.list_categories`

"Add a 'Side Projects' expense category"
→ `finance.add_category { name: "Side Projects", category_type: "expense", icon: "🚀" }`

## Budgets

"Set a 5000 NOK monthly budget for groceries"
→ `finance.set_budget { category_id: 5, amount: 5000, period: "monthly", month: 2, year: 2026 }`

"Am I on budget this month?"
→ `finance.budget_status`

## Goals

"I want to save 100000 NOK for an emergency fund by end of year"
→ `finance.add_goal { name: "Emergency Fund", goal_type: "savings", target_amount: 100000, deadline: "2026-12-31" }`

"I saved 5000 more toward my emergency fund"
→ `finance.update_goal { id: 1, current_amount: 30000 }`

"How are my goals coming along?"
→ `finance.goal_progress`

## Recurring

"I pay 199 NOK monthly for Netflix"
→ `finance.add_recurring { account_id: 1, amount: 199, transaction_type: "expense", description: "Netflix", frequency: "monthly", next_date: "2026-03-01", category_id: 17 }`

"Process any recurring transactions that are due"
→ `finance.process_recurring`

## Reports

"How much did I spend this month?"
→ `finance.spending_summary`

"Break down my expenses by category"
→ `finance.category_breakdown`

## CSV

"Import this CSV of bank transactions"
→ `finance.import_csv { csv_data: "date,amount,description\n2026-01-15,-500,REMA 1000\n...", account_id: 1 }`

"Export all my transactions"
→ `finance.export_csv`
