---
name: pi-myfinance
description: Personal finance tracking extension for pi
---

## Overview

Pi extension for personal finance — accounts, transactions, categories, vendors, budgets, goals, recurring transactions, and AI-powered insights. Dual-backend: SQLite (better-sqlite3) and Kysely (event-bus). Web UI via pi-webserver with 6 tabs: Dashboard, Transactions, Budgets, Goals, Vendors, Reports.

## Quick Start

```bash
npm install
npm run typecheck
npm test
```

## Directory Layout

```
src/
├── index.ts         # Extension entry point
├── types.ts         # TypeScript types — all entities, FinanceStore interface
├── db.ts            # SQLite backend: connection, migrations (v1–v5), seed data
├── db-kysely.ts     # Kysely backend: async store via event bus (pi-kysely)
├── store.ts         # SQLite store factory: CRUD for all entities
├── tool.ts          # Pi tool registration + LLM actions
├── web.ts           # Web UI routes + REST API (pi-webserver mount)
├── insights.ts      # Auto-categorization, anomaly detection, budget/goal analysis
├── import-bank.ts   # Bank file import orchestrator (detects format, dedupes)
├── import-dnb.ts    # DNB .txt/.xlsx parser
├── import-sas.ts    # SAS Mastercard .xlsx parser
├── import-amex.ts   # Amex .xlsx parser
├── import-types.ts  # Import result/transaction types
├── test-db.ts       # Smoke test (49 assertions)
├── test-import.ts   # Bank import tests
├── test-insights.ts # Insights tests
└── test-web.ts      # Web API tests
finance.html         # Single-page web UI (vanilla JS, Chart.js)
```

## Entity Model

| Entity | Table | Key Fields |
|---|---|---|
| Account | finance_accounts | name, account_type, currency, balance |
| Category | finance_categories | name, parent_id, icon, category_type (hierarchical) |
| Category Keyword | finance_category_keywords | keyword, match_type, priority (auto-categorization rules) |
| Transaction | finance_transactions | account_id, category_id, vendor_id, amount, type (in/out), date, linked_transaction_id |
| Vendor | finance_vendors | name (unique, case-insensitive), country, category_id, ignore flag |
| Budget | finance_budgets | category_id, amount, period (monthly/annual) |
| Goal | finance_goals | name, goal_type, target_amount, current_amount, deadline |
| Recurring | finance_recurring | frequency, next_date, auto-creates transactions |

## Conventions

- Follow pi extension patterns (pi-personal-crm, pi-jobs)
- SQLite via better-sqlite3 (sync), Kysely via event bus (async) — both implement FinanceStore interface
- All tool actions return structured data for LLM consumption
- No console.log — use proper error handling
- Migrations are additive (ALTER TABLE ADD COLUMN) — never drop data
- Transaction amounts are always positive; `transaction_type` (in/out) determines direction
- Balance is computed from transaction sum, reconciled via adjustment transactions
- Vendor matching uses longest-name-match against transaction descriptions
- Auto-categorize priority: keyword rules → vendor default category

## API Structure

- Page: `GET /finance/` → serves finance.html
- REST: `GET|POST|PATCH|DELETE /api/finance/{accounts,transactions,categories,keywords,vendors,budgets,goals,recurring}`
- Reports: `GET /api/finance/reports/{summary,trend,breakdown,breakdown-range}`
- Import: `POST /api/finance/transactions/{import,import-file,auto-categorize}`
