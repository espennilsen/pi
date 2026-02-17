---
name: pi-heartbeat
description: Periodic health check extension for pi — runs a configurable prompt as an isolated subprocess and delivers alerts via pi-channels
---

## Overview

Self-contained pi extension that runs a health-check prompt on a configurable interval. Spawns `pi --mode rpc` as a subprocess, collects the response, and delivers alerts via the `channel:send` event bus if the response does not start with `HEARTBEAT_OK`. Disabled by default — enable with `--heartbeat` flag, `/heartbeat on`, or `settings.json`.

**Stack:** TypeScript · `child_process.spawn` · EventBus · optional pi-kysely

## Architecture

- `src/index.ts` — Entry point. Registers `--heartbeat` flag, `/heartbeat` command, manages `HeartbeatRunner` lifecycle, mounts web UI.
- `src/heartbeat.ts` — `HeartbeatRunner` class. Drives the `setInterval` timer, spawns `pi --mode rpc` subprocesses, parses JSON-line RPC events, tracks in-memory stats (runCount, okCount, alertCount).
- `src/prompt.ts` — Builds the health-check prompt. Reads `HEARTBEAT.md` from `cwd`; falls back to generic check if file is missing or empty.
- `src/settings.ts` — Loads `"pi-heartbeat"` from global + project `settings.json` (project overrides global).
- `src/store.ts` — Store abstraction with two backends: `createMemoryStore()` (in-memory ring buffer, default) and `createKyselyStore()` (pi-kysely event bus). Exports `getStore()`, `setStore()`, `isStoreReady()`, `resetStore()`.
- `src/db-kysely.ts` — Kysely backend: `initDb()`, `insertRun()`, `getHistory()`, `getStats()`.
- `src/web.ts` — Mounts `/heartbeat` status page and API routes via pi-webserver event bus.
- `src/logger.ts` — Extension logger (emits to pi-logger via `log` event).
- `skills/` — Bundled pi skills directory (declared in `package.json` pi.skills).

## Key Patterns

- **Subprocess health check** — Runs `pi --mode rpc` with `-ne` (no extension discovery) and optional `-e <ext>` per `settings.extensions`. Sends a JSON prompt command via stdin, streams JSON-line events to collect `text_delta` responses, kills on `agent_end`.
- **HEARTBEAT_OK gate** — If response is exactly or starts with `HEARTBEAT_OK`, the check is suppressed. Any other response triggers `channel:send`.
- **Active hours guard** — `tick()` skips execution outside configured `activeHours` window.
- **Store init probe** — Probes for `kysely:info` to detect if pi-kysely is already ready before listening for `kysely:ready`.

## Store Schema (Kysely backend)

Table: `heartbeat_runs` — `id`, `ok` (boolean), `response` (text), `duration_ms` (integer), `created_at` (ISO string).

## Settings

```jsonc
// settings.json
{
  "pi-heartbeat": {
    "autostart": false,            // Start heartbeat on session_start
    "intervalMinutes": 15,         // Check interval (default: 15)
    "activeHours": { "start": "08:00", "end": "22:00" }, // null to disable
    "route": "ops",                // pi-channels route for alerts
    "showOk": false,               // Send channel:send for OK results too
    "prompt": null,                // Override prompt (null = use HEARTBEAT.md or default)
    "webui": false,                // Mount web UI via pi-webserver
    "useKysely": false,            // Use pi-kysely shared DB instead of memory store
    "extensions": null             // null = no extensions in subprocess; or ["ext1", "ext2"]
  }
}
```

## Events Emitted

| Event | Payload |
|-------|---------|
| `heartbeat:check` | `{ time }` — fired before each run |
| `heartbeat:result` | `{ ok, response, durationMs, time }` — fired after each run |
| `channel:send` | `{ route, text, source: "pi-heartbeat" }` — alerts only |

## Integration Points

| Extension | Integration | Mechanism |
|-----------|------------|-----------|
| **pi-webserver** | Status page + API | `web:mount`, `web:mount-api`, `web:ready` |
| **pi-channels** | Alert delivery | `channel:send` event |
| **pi-kysely** | Persistent run history | `kysely:info`, `kysely:ready`, `kysely:ack` |
| **pi-logger** | Structured logging | `log` event |

## Commands & Flags

- `--heartbeat` flag — Start heartbeat on session startup
- `/heartbeat on` / `off` — Start / stop the runner
- `/heartbeat status` — Show active state, run counts, last result
- `/heartbeat run` — Execute a check immediately

## Conventions

- No `console.log` — use `createLogger(pi)`.
- `HEARTBEAT.md` in `cwd` defines the health checklist; absence or empty = generic check.
- Timer is cleared on `session_shutdown`; store is reset via `resetStore()`.
