# Pi Extensions

All extensions ship with the [pi monorepo](https://github.com/espennilsen/pi). Clone pi, you get everything. Some are also published to npm for consumption outside the monorepo.

| Extension | Description | Published to npm |
|-----------|-------------|:-----------------:|
| `pi-a2a` | A2A protocol — serves Agent Card, JSON-RPC, hub registration | — |
| `pi-brave-search` | Brave Search API — web search for agents | 2026-04-26 |
| `pi-calendar` | Events, reminders, recurrence, web dashboard | 2026-02-17 |
| `pi-channels` | Two-way routing — Telegram, webhooks, custom adapters | 2026-04-26 |
| `pi-cmux` | Terminal multiplexer — notifications, panes, screen read, browser | 2026-04-26 |
| `pi-context` | Context window visualizer — token usage breakdown | 2026-02-17 |
| `pi-cron` | Cron scheduler — recurring prompts as isolated subprocesses | 2026-04-26 |
| `pi-dotenv` | Deprecated .env loader — no-op, backwards compat | — |
| `pi-github` | GitHub integration — PRs, issues, review feedback | 2026-03-07 |
| `pi-gmail` | Gmail API — read, search, compose, send emails | 2026-04-26 |
| `pi-heartbeat` | Periodic health check — heartbeat prompt as subprocess | 2026-04-26 |
| `pi-jobs` | Agent run tracking — job history, cost analysis, telemetry | 2026-04-26 |
| `pi-kysely` | Shared SQL database registry — multi-dialect, table-level RBAC | 2026-04-26 |
| `pi-logger` | Event bus logger — structured JSONL from bus events | 2026-04-26 |
| `pi-mealie` | Mealie recipe manager — recipes, meal plans, shopping lists | — |
| `pi-memory` | Persistent memory — long-term facts, daily logs, search | 2026-02-17 |
| `pi-mobile` | PWA mobile app — mounts on pi-webserver at /mobile | 2026-04-26 |
| `pi-model-router` | LLM-classified model routing — selects model by task complexity | — |
| `pi-myfinance` | Personal finance — accounts, transactions, budgets, reports | 2026-02-17 |
| `pi-npm` | npm workflow — publish, version, and common npm commands | 2026-02-17 |
| `pi-openrouter` | OpenRouter provider — OAuth PKCE, dynamic model filtering | 2026-04-26 |
| `pi-penpot` | Penpot design tool — projects, files, pages, shapes, comments | — |
| `pi-personal-crm` | Personal CRM — contacts, companies, interactions, reminders | 2026-04-26 |
| `pi-prism` | Widget sidebar overlay — operational dashboard in TUI | — |
| `pi-projects` | Project tracking — auto-discovers git repos, health dashboard | 2026-04-26 |
| `pi-subagent` | Parallel task delegation — isolated subagents, chains, pools | 2026-02-17 |
| `pi-supabase` | Supabase integration — read-only queries, subscriptions, channels | 2026-02-17 |
| `pi-td` | Task management — issues, sessions, handoffs, web dashboard | 2026-03-07 |
| `pi-td-hub` | Cross-project task aggregator — reads td DBs across ~/Dev | — |
| `pi-telemetry` | Local telemetry — session events, usage tracking | 2026-04-26 |
| `pi-todoist` | Todoist integration — tasks, projects, sections, labels | — |
| `pi-tts` | Text-to-speech — generates WAV via local TTS server | — |
| `pi-untappd` | Untappd monitoring — venue/user/brewery with RSS polling | — |
| `pi-vault` | Obsidian vault — read, write, search notes, health dashboard | 2026-02-17 |
| `pi-web-dashboard` | Live agent dashboard — SSE streaming, session view, prompt submit | 2026-04-26 |
| `pi-webnav` | Navigation shell for pi-webserver — shared nav layout with iframe routing | 2026-02-17 |
| `pi-webserver` | Shared HTTP server — authenticated host, extension mount points | 2026-04-26 |
| `pi-workon` | Project context switching — switch projects, detect stacks, scaffold AGENTS.md | 2026-04-26 |

**—** = monorepo only (not published to npm)

## Built-in

`web-fetch.ts` — HTTP client (GET, POST, PUT, DELETE, custom headers/body). Always available, not an extension.
