---
name: pi
description: Pi coding agent home directory — extensions, skills, prompts, and runtime config
---

## Overview

Personal Pi agent home directory, symlinked to `~/.pi/agent`. Contains local extensions, custom skills, prompt templates, and agent profiles. Each extension is a self-contained Node.js package in `extensions/` with its own `AGENTS.md` for detailed context.

## Directory Layout

```
├── agents/          # Agent profile prompt overrides (planner, reviewer, scout, worker)
├── extensions/      # Local extensions (each has own package.json + AGENTS.md)
├── skills/          # Shared skills (changelog-generator, git-project-status, etc.)
├── .pi/
│   ├── skills/      # Project-specific skills (code-review, github, td, blog-post, etc.)
│   └── prompts/     # Prompt templates (implement, scout-and-plan, implement-and-review)
├── themes/          # Custom TUI themes
├── db/              # Runtime SQLite databases (gitignored)
├── cache/           # Runtime cache (gitignored)
├── sessions/        # Agent session state (gitignored)
└── telemetry/       # Local telemetry data (gitignored)
```

## Extensions

22 local extensions in `extensions/`. Each has its own `AGENTS.md` with detailed architecture, entity models, and conventions — read those before modifying an extension.

Key extensions:
- **pi-webserver** — shared HTTP server with auth; other extensions mount on it
- **pi-kysely** — shared database registry with table-level RBAC
- **pi-myfinance** — personal finance (accounts, transactions, vendors, budgets, reports)
- **pi-personal-crm** — contacts, companies, interactions
- **pi-channels** — bidirectional messaging (Telegram, webhooks)
- **pi-memory** — persistent long-term memory and daily logs
- **pi-vault** — Obsidian vault integration

## Extension Development Conventions

### Structure
- Default export: `export default function (pi: ExtensionAPI) { ... }`
- Import types from `@mariozechner/pi-coding-agent` (`ExtensionAPI`, `getAgentDir`, `SettingsManager`)
- TypeScript with `strict: true`, target ES2022, module ESNext, `allowImportingTsExtensions`
- Use `.ts` extensions in imports (e.g. `import { foo } from "./bar.ts"`)
- Tool parameter schemas use `@sinclair/typebox` (`Type.Object`, `Type.String`, etc.)
- Tool results return `{ content: [{ type: "text", text: "..." }], details: {} }`

### Lifecycle & Events
- Initialize DB and state in `pi.on("session_start", async (event, ctx) => { ... })`
- Register tools with `pi.registerTool({ ... })`, commands with `pi.registerCommand(name, { ... })`
- Communicate between extensions via `pi.events.emit()` / `pi.events.on()` — never import directly
- Mount web UI via `pi.events.emit("web:mount", { name, prefix, handler })` and API via `"web:mount-api"`
- Listen for `"web:ready"` to re-mount if pi-webserver starts after your extension

### Database
- SQLite via better-sqlite3 (sync) as default backend; optional Kysely via event bus
- DB files go in `db/` directory under agent home (e.g. `db/finance.db`)
- Table names prefixed by extension (e.g. `finance_accounts`, `crm_contacts`)
- Migrations tracked in a `<prefix>_migrations` table with version numbers
- Parameterized queries only — no string interpolation in SQL
- WAL mode enabled (`PRAGMA journal_mode = WAL`)

### Code Style
- No `console.log` — use pi-logger or structured error returns
- Settings via `SettingsManager.create(cwd, agentDir)` for per-project + global config
- Validate with `npm run typecheck` (tsc --noEmit), test with `npm test`
- Keep web UIs as single HTML files (vanilla JS + inline CSS), served from extension root

## Task Management (MANDATORY)

**Every piece of work MUST be tracked with `td`.** No exceptions — no matter how small the change.

Before starting any work:
1. **Check for existing task:** `td status` or `td ready`
2. **Create a task if none exists:** `td create "description" --type task|bug|feature|chore`
3. **Start the task:** `td start <id>`
4. **Log progress as you go:** `td log "what you did"`
5. **Handoff when done:** `td handoff <id> --done "..." `
6. **Submit for review:** `td review <id>`

This applies to bug fixes, features, refactors, doc updates, config changes — everything. If you're changing code, there must be a `td` task for it.

## Other Conventions

- Each extension owns its own DB tables (prefixed by extension name)
- Tools return structured markdown for LLM consumption
