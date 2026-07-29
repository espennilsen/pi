---
name: pi-td
description: td task management extension for pi — structured LLM tool wrapping the td CLI, with optional web dashboard via pi-webserver
---

## Overview

Extension that wraps the `td` CLI as a structured LLM tool, enforces mandatory task management workflow via system prompt injection, and optionally serves a web dashboard (`/tasks`) and REST API (`/api/td/*`) for managing tasks across projects.

**Stack:** TypeScript · td CLI (via `pi.exec`) · pi-webserver event bus · vanilla JS dashboard

## Architecture

- `index.ts` — Entry point. Registers tool, mounts web UI, handles session_start/switch/fork/shutdown.
- `tool.ts` — `td` LLM tool (20 actions). Injects mandatory workflow into system prompt via `before_agent_start`. All td operations delegate to `pi.exec("td", args, { cwd })`.
- `td-settings.ts` — Reads `pi-td` (or legacy `tdWebui`) from global + project settings. Provides `getCrossProjectConfig()` for multi-project root.
- `cross-project.ts` — Scans subdirectories under `crossProjectRoot` for `.todos` folders, aggregates issues, builds project tree.
- `http-helpers.ts` — Minimal HTTP helpers: `json()`, `html()`, `badRequest()`, `notFound()`, `serverError()`, `readBody()`.
- `index.ts` (route handlers) — Implements REST API: list, detail, create, update, handoff, review, approve, reject, log, delete, and all `/global/*` cross-project variants.
- `tasks.html` — Single-file web dashboard (embedded as static string at startup via `fs.readFileSync`).
- `td-dashboard.css/js` — Dashboard assets referenced by tasks.html.

## Tool: `td`

### Action Groups

| Group | Actions |
|-------|---------|
| **Query** | `status`, `list`, `show`, `ready`, `next`, `reviewable`, `search` |
| **Lifecycle** | `create`, `start`, `log`, `handoff`, `review`, `approve`, `reject`, `close` |
| **Modify** | `update`, `delete` |
| **Focus** | `focus`, `unfocus` |
| **Other** | `block`, `unblock`, `reopen`, `comment` |

### Key parameters

- `id` — Required for most lifecycle/query actions (format: `td-abc123`)
- `title`, `type` (task/bug/feature/epic/chore), `priority` (P0–P4) — for `create` and `update`
- `minor: true` — marks task as minor; enables self-review via `approve`
- `done`, `remaining`, `decisions`, `uncertain` — arrays for `handoff`
- `log_type` — progress/blocker/decision/hypothesis/tried/result for `log`
- `show_all`, `filter_type`, `filter_priority`, `filter_status`, `filter_labels`, `filter_mine`, `filter_epic` — for `list`
- `query` — search text for `search` action or `--search` filter on `list`
- `sort`, `limit` — result ordering and pagination for `list`/`search`
- `self_close` — allow closing own implemented work (for `close` action)
- `reason` — optional for `approve`, `reject`, `close`, `block`

### Auto-retry behavior

- `approve` and `reject` auto-create a new review session (`td session --new`) and retry when td reports "cannot approve/reject" (same session as implementer).
- `close` supports `self_close: true` which maps to `--self-close-exception` for closing own work.

### System prompt injection

On `before_agent_start`, the tool injects a mandatory workflow block:
1. `td status` → create task → start → create git branch → do work → `td log` → `td handoff` → push + PR → `td review`
2. Minor tasks can be self-approved with `td approve`.
3. Never commit to `main` — always use `<task-id>/<short-name>` branches.

## Web Dashboard

Mounted via pi-webserver event bus when `webui: true` (default):

| Mount | Route | Description |
|-------|-------|-------------|
| `web:mount` | `/tasks` | Single-page task dashboard (serves `tasks.html`) |
| `web:mount-api` | `/api/td` | REST API for all td operations |

### REST API endpoints

- `GET /api/td/` — List tasks (enriched with log_count, handoff status, last_log)
- `GET /api/td/detail?id=` — Task detail
- `POST /api/td/` — Create task
- `PATCH /api/td/` — Update task
- `POST /api/td/handoff` — Record handoff
- `POST /api/td/review` / `approve` / `reject` / `log` — Workflow transitions
- `DELETE /api/td/` — Delete task (force)
- `GET /api/td/tree` / `config` / `global` / `global/stats` — Cross-project views

## Cross-Project Support

When `crossProjectRoot` is configured, the dashboard shows tasks from all projects under that root:

- `GET /api/td/global` — Aggregated issues from all sub-projects
- All global endpoints require `projectPath` in the request body
- Path traversal protection: `projectPath` must resolve within `crossProjectRoot` (symlink-safe via `realpathSync`)

## Settings

```jsonc
// settings.json
{
  "pi-td": {
    "webui": true,                   // Enable web dashboard (default: true)
    "crossProjectRoot": "~/Dev",     // Root for cross-project view (optional)
    "crossProjectDepth": 1           // Directory depth to scan for sub-projects
  }
}
```

## Integration Points

| Extension | Integration | Mechanism |
|-----------|------------|-----------|
| **pi-webserver** | Task dashboard + REST API | `web:mount`, `web:mount-api`, `web:unmount`, `web:unmount-api`, `web:ready` |
| **pi-logger** | Structured logging | (via pi.exec stderr) |

## Conventions

- No direct SQLite — all task data lives in the `td` CLI's `.todos` folder. Extension only shells out to `td`.
- `sessionCwd` is updated on `session_switch` and `session_fork` — always use `getCwd()` in tool handlers.
- `td` stdout starting with `ERROR:` or `Warning: cannot` is treated as an error even on exit code 0.
- Both the tool and REST API approve/reject handlers auto-create a review session (`td session --new`) if td reports "cannot approve/reject".
- No console.log — errors surface through tool result strings.
