---
name: pi-logger
description: Event bus JSONL logger for pi — subscribes to bus events and writes structured per-day log files
---

## Overview

Self-contained pi extension that listens to `pi.events` and writes structured JSONL log files. Other extensions emit structured logs via the `log` / `log:*` bus events. pi-logger also subscribes to a set of well-known system events (channel, cron, heartbeat, jobs, web, kysely) and captures them automatically. No external dependencies — pure Node.js fs writes.

**Stack:** TypeScript · Node.js `fs.appendFileSync` · `Intl.DateTimeFormat`

## Architecture

- `src/index.ts` — Entry point. Calls `setup()` on `session_start`, `teardown()` on `session_shutdown`. Registers `/logger` command. All subscription management is in-module.
- `src/settings.ts` — Loads `"pi-logger"` from global + project `settings.json`. Exports `LoggerSettings`, `LogLevel`, `LogScope`.
- `src/writer.ts` — `writeLogEntry(busEvent, level, data, scope, cwd, timezone)`. Writes one JSON line to `YYYY-MM-DD.jsonl`. Resolves log directory from scope. Errors are silently swallowed.

## Log File Layout

| Scope | Path |
|-------|------|
| `global` (default) | `~/.pi/agent/logs/YYYY-MM-DD.jsonl` |
| `project` | `.pi/logs/YYYY-MM-DD.jsonl` (relative to `cwd`) |

Each line is a JSON object: `{ ts, level, channel, event, data }`.

Bus event `"heartbeat:result"` → `{ channel: "heartbeat", event: "result" }`.

## How Extensions Emit Logs

```ts
// Structured log via "log" event:
pi.events.emit("log", { channel: "myext", level: "WARN", event: "retry", data: { attempt: 3 } });

// Shorthand by level:
pi.events.emit("log:error", { event: "crash", data: { err: "ENOENT" } });
pi.events.emit("log:info",  { event: "ready", data: { port: 3000 } });
```

Level is inferred from the event name if omitted (`error`/`fail` → ERROR, `warn`/`alert` → WARN, `debug` → DEBUG, else INFO).

## Filtering Logic

1. **`events_whitelist`** — Only capture bus events matching these prefixes. Default `["log"]` (captures `log` and `log:*`).
2. **`events_ignore`** — Skip bus events matching these prefixes (applied after whitelist).
3. **`channels_whitelist`** — For the `"log"` handler: only write entries whose `channel` field matches. Empty = accept all.
4. **`channels_ignore`** — For the `"log"` handler: drop entries whose `channel` matches.
5. **`level`** — Minimum level gate; events below this are discarded. DEBUG < INFO < WARN < ERROR.

## Well-Known System Events (auto-subscribed)

`channel:send/receive/register`, `cron:job_start/job_complete/add/remove/enable/disable/run/status/reload`, `heartbeat:check/result`, `jobs:recorded`, `web:mount/unmount/mount-api/unmount-api/ready`, `kysely:ready/ack`.

These are subscribed only if they pass the whitelist/ignore filters. To capture them, add e.g. `"heartbeat"` to `events_whitelist`.

## Settings

```jsonc
// settings.json
{
  "pi-logger": {
    "level": "INFO",                    // DEBUG | INFO | WARN | ERROR
    "scope": "global",                  // "global" or "project"
    "timezone": "Europe/Oslo",          // IANA timezone (default: system tz)
    "events_whitelist": ["log"],        // Bus event prefixes to capture
    "events_ignore": [],                // Bus event prefixes to skip
    "channels_whitelist": [],           // "log" handler: channels to accept ([] = all)
    "channels_ignore": []               // "log" handler: channels to drop
  }
}
```

## Commands

- `/logger status` — Print current settings and active subscription count
- `/logger level <DEBUG|INFO|WARN|ERROR>` — Change log level at runtime (in-memory only)
- `/logger scope <global|project>` — Change log scope at runtime (in-memory only)
- `/logger reload` — Re-read settings from disk and re-subscribe

## Conventions

- No `console.log` — this extension is the logging layer; it must never emit its own logs via side channels.
- `writeLogEntry` silently swallows all errors — logging must never break the agent.
- Subscriptions are stored in `subscriptions: Array<() => void>`; `teardown()` calls all unsubscribers and clears the array.
- Settings are re-read on every `setup()` call (triggered by `reload` command or `session_start`).
- `setup()` always calls `teardown()` first to avoid duplicate subscriptions.
