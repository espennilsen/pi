---
name: pi-cron
description: Cron scheduler extension for pi — manages recurring prompts stored in a crontab file and runs them as isolated `pi -p` subprocesses
---

## Overview

File-based cron scheduler for pi. Jobs are defined in `~/.pi/agent/pi-cron.tab` (custom 5-field cron format). The scheduler ticks every 30 seconds, watches the tab file for live reloads, and spawns isolated `pi -p --no-session --no-extensions` subprocesses for each job. A PID lock file prevents multiple pi instances from running the scheduler concurrently. **Disabled by default** — enable via `--cron` flag, `/cron on` command, or `autostart: true` in settings.

**Stack:** TypeScript · Node.js `child_process.spawn` · `fs.watch`

## Architecture

```
src/
├── index.ts      # Entry — flags, lifecycle, /cron command, cron tool
├── scheduler.ts  # CronScheduler class — tick loop, cron expression parser, subprocess runner
├── crontab.ts    # File-based tab parser/serializer + CRUD helpers
├── api.ts        # cron:* event API for inter-extension use
├── web.ts        # Web dashboard (mounts /cron + /api/cron on pi-webserver)
├── lock.ts       # PID lock file (~/.pi/agent/pi-cron.lock)
├── settings.ts   # Settings loader (global + project merge)
├── logger.ts     # Extension logger
└── ui/           # Static HTML/CSS/JS for the web dashboard
```

## Key Files

- `src/index.ts` — Registers `--cron` flag, lifecycle hooks, `/cron` command, and `cron` tool.
- `src/scheduler.ts` — Cron expression parser (5-field, no lib), `CronScheduler` class with `fs.watch` reload and `spawn`-based subprocess execution.
- `src/crontab.ts` — Parses/serializes `pi-cron.tab` format; CRUD helpers (`addJob`, `removeJob`, `updateJob`, `getJob`).
- `src/api.ts` — Registers `cron:list`, `cron:get`, `cron:status`, `cron:add`, `cron:update`, `cron:remove`, `cron:enable`, `cron:disable`, `cron:run` event handlers.
- `src/lock.ts` — PID-based lock file; stale locks (dead PIDs) are auto-cleaned.
- `src/web.ts` — Mounts `/cron` dashboard and `/api/cron` REST endpoints via `web:mount` / `web:mount-api`.

## Tools

- `cron` — actions: `list`, `add`, `update`, `remove`, `enable`, `disable`, `run`. Reads/writes the crontab file regardless of scheduler state; `run` requires the scheduler to be active.

## Commands

- `/cron on|start` — Start the scheduler (acquires lock, sets TUI status indicator)
- `/cron off|stop` — Stop the scheduler (releases lock)
- `/cron` (no args) — Show status: active/inactive, PID, lock holder, job count

## Events

- Emits: `cron:job_start`, `cron:job_complete`, `cron:reload`, `channel:send` (job result notifications)
- Listens: `cron:list`, `cron:get`, `cron:status`, `cron:add`, `cron:update`, `cron:remove`, `cron:enable`, `cron:disable`, `cron:run`, `web:ready`

## Settings

- `autostart` — Start scheduler automatically on session start (default: `false`)
- `activeHours` — `{ start: "08:00", end: "22:00" }` — suppress jobs outside this window; `null` = always active
- `route` — Channel route for job result notifications (default: `"cron"`)
- `showOk` — Send channel notification on successful job completion (default: `false`; failures always notify)
- `extensions` — List of extension paths to load in cron subprocesses (default: `[]` = `--no-extensions`)

## Database

None. Jobs are stored in `~/.pi/agent/pi-cron.tab` (plain text, one job per line).

## Conventions

- Crontab format: `<min> <hour> <dom> <month> <dow>  <name>  [channel:<ch>]  [disabled]  <prompt>`
- Subprocess command: `pi -p --no-session --no-extensions [-e ext]... <prompt>` with 10-minute timeout.
- Lock file at `~/.pi/agent/pi-cron.lock`; always check for stale PIDs before rejecting acquisition.
- Tab file is watched with `fs.watch` — scheduler reloads automatically on any change.
- Inter-extension API uses callback-style events (emit with `{ ..., callback: (result) => ... }`).
