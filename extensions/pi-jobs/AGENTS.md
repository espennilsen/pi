---
name: pi-jobs
description: Agent run telemetry and cost tracking for pi — auto-records every agent invocation with token usage, cost, duration, and tool call stats
---

## Overview

Self-contained pi extension that auto-tracks all agent runs via lifecycle hooks. Stores data in SQLite (default) or the shared pi-kysely database. Provides an LLM `jobs` tool for querying stats, a `/jobs` TUI command, and a web dashboard at `/jobs` via pi-webserver.

**Stack:** TypeScript · better-sqlite3 · optional pi-kysely · pi-webserver

## Architecture

- `src/index.ts` — Entry point. Initializes the store backend, calls `registerTracker()` and `registerJobsTool()`, mounts web routes, registers `/jobs` command.
- `src/tracker.ts` — Lifecycle hooks: `model_select`, `turn_start`, `turn_end`, `tool_call`, `tool_result`. Also listens for `subagent:complete`, `heartbeat:result`, `cron:job_complete` to record external runs.
- `src/tool.ts` — `jobs` LLM tool. Actions: `stats`, `recent`, `cost_report`, `models`, `tools`. Period parameter maps to days (today=1, week=7, month=30, all=3650).
- `src/store.ts` — Store abstraction. Exports `getJobsStore()`, `setJobsStore()`, `isStoreReady()`. Two factory functions: `createSqliteStore(dbPath)` and `createKyselyStore(eventBus)`.
- `src/db.ts` — SQLite backend via better-sqlite3. WAL mode. Tables: `jobs`, `job_tool_calls`. Migrations tracked in `jobs_migrations`.
- `src/db-kysely.ts` — Kysely backend: same schema via pi-kysely event bus.
- `src/settings.ts` — Loads `"pi-jobs"` from global + project `settings.json`.
- `src/web.ts` — Mounts `/jobs` dashboard and `/api/jobs` API routes via pi-webserver event bus.
- `src/logger.ts` — Extension logger (emits to pi-logger).

## Database Schema

**`jobs`** — `id` (text PK), `channel` (tui|cron|heartbeat|subagent), `prompt`, `model`, `provider`, `status` (running|done|error), `response`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `total_tokens`, `cost_input`, `cost_output`, `cost_cache_read`, `cost_cache_write`, `cost_total`, `tool_call_count`, `turn_count`, `duration_ms`, `error`, `created_at`, `updated_at`.

**`job_tool_calls`** — `id`, `job_id` (FK), `tool_name`, `is_error`, `duration_ms`, `created_at`.

## Key Patterns

- **Auto-tracking** — `turn_start` at `turnIndex === 0` creates a job; `turn_end` with no pending tool results completes it. Tool calls are recorded individually via `tool_call`/`tool_result` events.
- **Channel taxonomy** — Jobs are categorized as `tui` (interactive session), `cron`, `heartbeat`, or `subagent`.
- **Store init probe** — For Kysely backend, probes `kysely:info` to detect if pi-kysely is already running before subscribing to `kysely:ready`.
- **Telemetry resilience** — All tracker callbacks catch and swallow errors; telemetry must never break the agent.
- **`web:ready` re-mount** — Listens for `web:ready` to re-mount routes if pi-webserver starts after pi-jobs.

## Settings

```jsonc
// settings.json
{
  "pi-jobs": {
    "dbPath": "jobs/jobs.db",  // SQLite file path (relative to agent home)
    "useKysely": false         // Use pi-kysely shared DB instead of SQLite
  }
}
```

## LLM Tool: `jobs`

Actions:
- `stats` — Total runs, errors, tokens, cost, tool calls, avg duration
- `recent` — Last N jobs (default 20) with status, channel, prompt, tokens, cost
- `cost_report` — Daily cost breakdown (grouped by date)
- `models` — Usage and cost by provider/model
- `tools` — Tool call frequency, error count, avg duration

Optional parameters: `period` (today|week|month|all), `channel` (tui|cron|heartbeat|subagent), `limit` (for recent).

## Integration Points

| Extension | Integration | Mechanism |
|-----------|------------|-----------|
| **pi-webserver** | Job dashboard + API | `web:mount`, `web:mount-api`, `web:ready` |
| **pi-kysely** | Shared DB backend | `kysely:info`, `kysely:ready` |
| **pi-heartbeat** | Track heartbeat runs | `heartbeat:result` event |
| **pi-cron** | Track cron runs | `cron:job_complete` event |
| **pi-logger** | Structured logging | `log` event |

## Commands

- `/jobs [channel]` — Show quick stats (total runs, errors, tokens, cost, tool calls, avg duration). Channel optional filter (tui|cron|heartbeat|subagent).

## Events Emitted

- `jobs:recorded` — `{ jobId, type: "start"|"complete" }` — fired on job creation and completion.

## Conventions

- No `console.log` — use `createLogger(pi)`.
- SQLite DB stored at `<agentDir>/jobs/jobs.db` by default.
- `closeDb()` is called on `session_shutdown` to flush WAL and close handles.
