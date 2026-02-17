---
name: pi-projects
description: Project tracking dashboard for pi — auto-discovers git repos in ~/Dev, shows git status, and provides a web dashboard
---

## Overview

Self-contained pi extension that scans a root directory (default `~/Dev`) for git repositories and exposes their status (branch, dirty files, ahead/behind) via an LLM tool, TUI command, and web dashboard.

**Stack:** TypeScript · better-sqlite3 · pi-webserver event bus · vanilla JS dashboard

## Architecture

- `src/index.ts` — Entry point. Registers tool, command, mounts web routes, handles lifecycle.
- `src/tool.ts` — `projects` LLM tool with 5 actions: list, scan, hide, unhide, sources.
- `src/scanner.ts` — Live git repo discovery. Shells out to `git` for branch, status, ahead/behind, remote URL.
- `src/store.ts` — Unified async store interface; wraps SQLite or Kysely backend.
- `src/db.ts` — SQLite backend via better-sqlite3 (sync). Tables: `project_sources`, `hidden_projects`.
- `src/db-kysely.ts` — Kysely backend via `kysely:*` event bus (for shared DB with other extensions).
- `src/settings.ts` — Reads `pi-projects` block from global + project settings. Expands `~/` paths.
- `src/web.ts` — Mounts `/projects` UI and `/api/projects/*` REST endpoints via pi-webserver event bus.
- `src/logger.ts` — Extension logger (emits to pi-logger).
- `src/ui/` — Single-file vanilla JS dashboard (projects.html, projects.js, projects.css).

## Tool: `projects`

| Action | Required params | Description |
|--------|----------------|-------------|
| `list` / `scan` | — | Scan devDir and all additional sources; return markdown table with git status |
| `hide` | `path` | Suppress a project from listing (stored in DB) |
| `unhide` | `path` | Restore a hidden project |
| `sources` | — / `path` | List scan dirs or add a new source directory |

Output includes: name, branch, dirty count, ahead/behind indicators per project.

## Key Patterns

- **Live scan** — No persistent project cache. Every `list`/`scan` call shells out to `git`. Status is always fresh.
- **Store abstraction** — All DB access goes through `ProjectsStore` interface; swap SQLite ↔ Kysely by setting `useKysely: true`.
- **Dual backend init** — Kysely backend probes `kysely:info` first, then listens for `kysely:ready` — handles any startup order.
- **No direct imports** between extensions — web mounting, DB sharing, and logging all via event bus.

## Settings

```jsonc
// settings.json
{
  "pi-projects": {
    "devDir": "~/Dev",                // Root scan directory (default: ~/Dev)
    "dbPath": "projects/projects.db", // SQLite path relative to agent home
    "useKysely": false,               // Use pi-kysely shared DB instead of SQLite
    "autoScan": true                  // Scan on startup (unused, reserved)
  }
}
```

## Integration Points

| Extension | Integration | Mechanism |
|-----------|------------|-----------|
| **pi-webserver** | Dashboard UI + REST API | `web:mount`, `web:mount-api`, `web:ready` |
| **pi-kysely** | Optional shared DB | `kysely:info`, `kysely:ready`, `kysely:query` events |
| **pi-logger** | Structured logging | `log` event |

## Commands

- `/projects [search]` — Quick TUI status: total, git count, dirty projects, optional name/branch filter.

## Conventions

- No console.log — use logger.
- DB tables prefixed: `project_sources`, `hidden_projects`, `projects_migrations`.
- `~/` paths expanded in settings via `expandHome()`.
- `devDir` is the single source of truth for the default scan root; additional sources are stored in DB.
