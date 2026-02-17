# @e9n/pi-jobs

Agent run telemetry and cost tracking for [pi](https://github.com/mariozechner/pi-mono). Records every agent invocation with token usage, estimated cost, duration, and tool call stats.

## Features

- **Auto-tracking** — records all agent runs via session lifecycle events
- **Cost tracking** — token usage and estimated cost per model and provider
- **Tool stats** — call counts, error rates, and average duration per tool
- **Channel tracking** — separate stats for `tui`, `cron`, `heartbeat`, and `subagent` runs
- **`jobs` tool** — LLM can query stats, cost reports, model breakdowns, and recent runs
- **Web dashboard** — auto-mounts at `/jobs` via pi-webserver
- **`/jobs` command** — quick stats in the TUI

## Setup / Settings

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project):

```json
{
  "pi-jobs": {
    "dbPath": "jobs/jobs.db",
    "useKysely": false
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `"jobs/jobs.db"` | SQLite file path (relative to agent dir). |
| `useKysely` | `false` | Use pi-kysely shared DB instead of a local SQLite file. |

## Tool: `jobs`

Query agent run telemetry.

| Action | Params | Description |
|--------|--------|-------------|
| `stats` | `period?`, `channel?` | Summary totals: runs, errors, tokens, cost, tool calls, avg duration |
| `recent` | `channel?`, `limit?` | Recent runs with status, prompt preview, tokens, cost, and duration |
| `cost_report` | `period?`, `channel?` | Daily cost breakdown over the period |
| `models` | `period?` | Token and cost breakdown by provider/model |
| `tools` | `period?` | Tool call frequency, error count, and avg duration |

**`period`**: `today` · `week` · `month` (default) · `all`  
**`channel`**: `tui` · `cron` · `heartbeat` · `subagent`

## Commands

| Command | Description |
|---------|-------------|
| `/jobs` | Show totals across all channels |
| `/jobs tui` | Stats for TUI sessions only |
| `/jobs cron` | Stats for cron job runs |
| `/jobs heartbeat` | Stats for heartbeat check runs |
| `/jobs subagent` | Stats for subagent runs |

## Web UI

Requires **pi-webserver**. The dashboard mounts automatically at `/jobs` and re-mounts if pi-webserver starts after pi-jobs.

## Install

```bash
pi install npm:@e9n/pi-jobs
```

## License

MIT
