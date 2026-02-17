# @e9n/pi-myfinance

Personal finance tracking extension for [pi](https://github.com/mariozechner/pi-coding-agent). Track accounts, transactions, budgets, goals, and recurring expenses — all from your terminal or Telegram.

## Features

- **Accounts** — checking, savings, credit, cash, and investment account types
- **Transactions** — income/expense tracking with categories, vendors, and tags
- **Budgets** — monthly or annual envelope budgets per category
- **Goals** — savings targets, debt paydown, and purchase goals with progress tracking
- **Recurring** — subscriptions and regular payments with automatic daily processing
- **Reports** — spending summaries, monthly trends, and category breakdowns
- **Insights** — anomaly detection and budget risk alerts
- **Import** — bank statement import (DNB, SAS Mastercard, Amex); CSV import/export
- **Notifications** — sends a message via pi-channels when recurring transactions are auto-processed
- **Web dashboard** — full finance UI via pi-webserver (`finance.html`)

## Setup

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-myfinance": {
    "dbPath": "db/finance.db"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `"db/finance.db"` | SQLite file path (relative to agent dir, or absolute) |
| `useKysely` | `false` | Use shared pi-kysely DB instead of local SQLite |

## Tool: `finance`

Manages all finance entities. Pass `action` plus the relevant fields.

### Actions

| Group | Actions |
|-------|---------|
| **Accounts** | `list_accounts`, `add_account`, `update_account`, `delete_account` |
| **Transactions** | `list_transactions`, `add_transaction`, `update_transaction`, `delete_transaction`, `search_transactions` |
| **Categories** | `list_categories`, `add_category` |
| **Budgets** | `list_budgets`, `set_budget`, `budget_status` |
| **Goals** | `list_goals`, `add_goal`, `update_goal`, `goal_progress` |
| **Recurring** | `list_recurring`, `add_recurring`, `update_recurring`, `delete_recurring`, `process_recurring`, `upcoming_recurring` |
| **Vendors** | `list_vendors`, `add_vendor`, `update_vendor`, `delete_vendor` |
| **Reports** | `spending_summary`, `category_breakdown`, `trend_analysis` |
| **Insights** | `insights`, `auto_categorize` |
| **Import/Export** | `import_bank`, `import_bank_directory`, `import_csv`, `export_csv` |

### Key Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | Action to perform (required) |
| `id` | number | Entity ID for update/delete |
| `account_type` | string | `checking`, `savings`, `credit`, `cash`, `investment` |
| `transaction_type` | string | `in` (income) or `out` (expense) |
| `amount` | number | Transaction or budget amount |
| `date` | string | ISO date (`YYYY-MM-DD`) |
| `description` | string | Transaction or entity description |
| `category_id` | number | Category for a transaction or budget |
| `frequency` | string | `daily`, `weekly`, `biweekly`, `monthly`, `quarterly`, `yearly` |
| `query` | string | Search query (for `search_transactions`) |
| `limit` | number | Max results to return |
| `year` / `month` | number | Period for reports |

## Commands

| Command | Description |
|---------|-------------|
| `/finance-accounts` | List all accounts with balances |
| `/finance-recent [n]` | Show last N transactions (default 20) |
| `/finance-search <query>` | Search transactions by text |
| `/finance-summary` | Monthly income/expense summary with budget alerts |
| `/finance-budgets` | Budget status for current month |
| `/finance-goals` | All goals with progress |
| `/finance-recurring` | Upcoming recurring transactions (next 30 days) |
| `/finance-trend [months]` | Monthly income/expense trend (default 6 months) |
| `/finance-categories` | Spending by category for current month |
| `/finance-process` | Process due recurring transactions now |
| `/finance-import <path> <account_id>` | Import transactions from CSV |
| `/finance-import-bank <path> <account-name>` | Import bank statement (auto-detects format) |
| `/finance-export` | Export all transactions to `finance-transactions.csv` |
| `/finance-web [port]` | Start standalone web UI (default port 4200) |
| `/finance-web stop` | Stop the standalone server |
| `/finance-web status` | Show web UI status |

## Web UI

The dashboard (`finance.html`) auto-mounts at `/finance` when [pi-webserver](https://github.com/espennilsen/pi) is installed. Use `/finance-web` to start a standalone server on port 4200.

## Install

```bash
pi install npm:@e9n/pi-myfinance
```

## License

MIT
