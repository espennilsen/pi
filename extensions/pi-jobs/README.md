# pi-jobs

Agent run telemetry and cost tracking extension for [pi](https://github.com/badlogic/pi-mono). Tracks every agent invocation with token usage, cost, duration, and tool call stats.

## Install

```bash
pi install /path/to/pi-jobs
```

## Features

- **Auto-tracking** — records all agent runs via lifecycle events
- **Cost tracking** — token usage and estimated cost per model
- **Tool stats** — call counts, error rates, average duration
- **Channel tracking** — separate stats for TUI, cron, heartbeat, subagent runs
- **`jobs` tool** — LLM can query stats directly
- **Web dashboard** — at `/jobs` via pi-webserver
- **`/jobs` command** — quick stats in TUI

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-jobs": {
    "dbPath": "jobs/jobs.db"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `"jobs/jobs.db"` | SQLite database path (relative to agent dir). |

## Commands

| Command | Description |
|---------|-------------|
| `/jobs` | Show totals (runs, errors, tokens, cost) |
| `/jobs cron` | Show stats for cron channel only |
| `/jobs heartbeat` | Show stats for heartbeat channel |

## Integrations

Listens for events from pi-cron, pi-heartbeat, and pi-subagent to track subprocess runs.

| Extension | Event | Purpose |
|-----------|-------|---------|
| pi-webserver | `web:mount`, `web:mount-api`, `web:ready` | Serve web UI and API |
| pi-cron | `cron:job_complete` | Track cron job runs |
| pi-heartbeat | `heartbeat:result` | Track heartbeat runs |
| pi-subagent | `subagent:complete` | Track subagent runs |

## Architecture

```
src/
├── index.ts      # Extension entry — lifecycle, command
├── settings.ts   # Settings loader
├── db.ts         # SQLite database with migrations
├── tracker.ts    # Event listener — records runs from all channels
├── tool.ts       # LLM tool (stats, recent, models, tools)
└── web.ts        # Web dashboard + API routes via pi-webserver
```

## License

MIT
