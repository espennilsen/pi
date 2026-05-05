# Pi Extensions

All extensions ship with the [pi monorepo](https://github.com/espennilsen/pi). Clone pi, you get everything. Some are also published to npm for consumption outside the monorepo.

| Extension | Description | npm | Published |
|-----------|-------------|-----|:---------:|
| `pi-a2a` | A2A protocol — serves Agent Card, JSON-RPC, hub registration | — | — |
| `pi-brave-search` | Brave Search API — web search for agents | `npm i @e9n/pi-brave-search` | 2026-04-26 |
| `pi-calendar` | Events, reminders, recurrence, web dashboard | `npm i @e9n/pi-calendar` | 2026-02-17 |
| `pi-channels` | Two-way routing — Telegram, webhooks, custom adapters | `npm i @e9n/pi-channels` | 2026-04-26 |
| `pi-cmux` | Terminal multiplexer — notifications, panes, screen read, browser | `npm i @e9n/pi-cmux` | 2026-04-26 |
| `pi-context` | Context window visualizer — token usage breakdown | `npm i @e9n/pi-context` | 2026-02-17 |
| `pi-cron` | Cron scheduler — recurring prompts as isolated subprocesses | `npm i @e9n/pi-cron` | 2026-04-26 |
| `pi-dotenv` | Deprecated .env loader — no-op, backwards compat | — | — |
| `pi-github` | GitHub integration — PRs, issues, review feedback | `npm i @e9n/pi-github` | 2026-03-07 |
| `pi-gmail` | Gmail API — read, search, compose, send emails | `npm i @e9n/pi-gmail` | 2026-04-26 |
| `pi-heartbeat` | Periodic health check — heartbeat prompt as subprocess | `npm i @e9n/pi-heartbeat` | 2026-04-26 |
| `pi-jobs` | Agent run tracking — job history, cost analysis, telemetry | `npm i @e9n/pi-jobs` | 2026-04-26 |
| `pi-kysely` | Shared SQL database registry — multi-dialect, table-level RBAC | `npm i @e9n/pi-kysely` | 2026-04-26 |
| `pi-logger` | Event bus logger — structured JSONL from bus events | `npm i @e9n/pi-logger` | 2026-04-26 |
| `pi-mealie` | Mealie recipe manager — recipes, meal plans, shopping lists | — | — |
| `pi-memory` | Persistent memory — long-term facts, daily logs, search | `npm i @e9n/pi-memory` | 2026-02-17 |
| `pi-mobile` | PWA mobile app — mounts on pi-webserver at /mobile | `npm i @e9n/pi-mobile` | 2026-04-26 |
| `pi-model-router` | LLM-classified model routing — selects model by task complexity | — | — |
| `pi-myfinance` | Personal finance — accounts, transactions, budgets, reports | `npm i @e9n/pi-myfinance` | 2026-02-17 |
| `pi-npm` | npm workflow — publish, version, and common npm commands | `npm i @e9n/pi-npm` | 2026-02-17 |
| `pi-openrouter` | OpenRouter provider — OAuth PKCE, dynamic model filtering | `npm i @e9n/pi-openrouter` | 2026-04-26 |
| `pi-penpot` | Penpot design tool — projects, files, pages, shapes, comments | — | — |
| `pi-personal-crm` | Personal CRM — contacts, companies, interactions, reminders | `npm i @e9n/pi-personal-crm` | 2026-04-26 |
| `pi-prism` | Widget sidebar overlay — operational dashboard in TUI | — | — |
| `pi-projects` | Project tracking — auto-discovers git repos, health dashboard | `npm i @e9n/pi-projects` | 2026-04-26 |
| `pi-subagent` | Parallel task delegation — isolated subagents, chains, pools | `npm i @e9n/pi-subagent` | 2026-02-17 |
| `pi-supabase` | Supabase integration — read-only queries, subscriptions, channels | `npm i @e9n/pi-supabase` | 2026-02-17 |
| `pi-td` | Task management — issues, sessions, handoffs, web dashboard | `npm i @e9n/pi-td` | 2026-03-07 |
| `pi-td-hub` | Cross-project task aggregator — reads td DBs across ~/Dev | — | — |
| `pi-telemetry` | Local telemetry — session events, usage tracking | `npm i @e9n/pi-telemetry` | 2026-04-26 |
| `pi-todoist` | Todoist integration — tasks, projects, sections, labels | — | — |
| `pi-tts` | Text-to-speech — generates WAV via local TTS server | — | — |
| `pi-untappd` | Untappd monitoring — venue/user/brewery with RSS polling | — | — |
| `pi-vault` | Obsidian vault — read, write, search notes, health dashboard | `npm i @e9n/pi-vault` | 2026-02-17 |
| `pi-web-dashboard` | Live agent dashboard — SSE streaming, session view, prompt submit | `npm i @e9n/pi-web-dashboard` | 2026-04-26 |
| `pi-webnav` | Navigation shell for pi-webserver — shared nav layout with iframe routing | `npm i @e9n/pi-webnav` | 2026-02-17 |
| `pi-webserver` | Shared HTTP server — authenticated host, extension mount points | `npm i @e9n/pi-webserver` | 2026-04-26 |
| `pi-workon` | Project context switching — switch projects, detect stacks, scaffold AGENTS.md | `npm i @e9n/pi-workon` | 2026-04-26 |

**—** = monorepo only (not published to npm)

## Built-in

`web-fetch.ts` — HTTP client (GET, POST, PUT, DELETE, custom headers/body). Always available, not an extension.
