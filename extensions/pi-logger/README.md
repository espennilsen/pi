# @e9n/pi-logger

Event bus logger for [pi](https://github.com/mariozechner/pi-mono). Subscribes to events on the shared event bus and writes structured JSONL log files, one per day.

## Features

- Captures any event on the pi event bus as a structured log entry
- Writes JSONL files named `YYYY-MM-DD.jsonl`, one per day
- **Global scope** — all sessions write to `~/.pi/agent/logs/`
- **Project scope** — logs write to `.pi/logs/` next to project code
- Configurable minimum level, event whitelist/ignore, and channel whitelist/ignore
- Level inferred from event name when not explicitly set
- Timestamps use the configured IANA timezone (defaults to system timezone)
- Runtime control via `/logger` command — change level, scope, or reload settings without restarting

## Setup / Settings

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project):

```json
{
  "pi-logger": {
    "level": "INFO",
    "scope": "global",
    "timezone": "Europe/Oslo",
    "events_whitelist": ["log"],
    "events_ignore": [],
    "channels_whitelist": [],
    "channels_ignore": []
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `level` | `"INFO"` | Minimum log level: `DEBUG`, `INFO`, `WARN`, `ERROR`. |
| `scope` | `"global"` | `"global"` → `~/.pi/agent/logs/`, `"project"` → `.pi/logs/`. |
| `timezone` | System tz | IANA timezone for timestamps (e.g. `"Europe/Oslo"`). |
| `events_whitelist` | `["log"]` | Bus event prefixes to subscribe to. `[]` = capture all known events. |
| `events_ignore` | `[]` | Bus event prefixes to skip (applied after whitelist). |
| `channels_whitelist` | `[]` | Channels to accept in the `log` handler. `[]` = all. |
| `channels_ignore` | `[]` | Channels to drop in the `log` handler. |

### Logging from extensions

Emit structured log entries via the `"log"` bus event:

```typescript
// Channel + level
pi.events.emit("log", { channel: "myext", level: "WARN", data: { msg: "something odd" } });

// Channel + sub-event
pi.events.emit("log", { channel: "myext", event: "request", data: { path: "/api" } });

// Shorthand by level (level inferred from event name)
pi.events.emit("log:error", { event: "myext:crash", data: { message: "oops" } });
pi.events.emit("log:warn",  { event: "myext:slow",  data: { ms: 2000 } });
```

### Level inference

Events are assigned a level from their name when no explicit level is given:

| Pattern in event name | Level |
|-----------------------|-------|
| `error` or `fail` | `ERROR` |
| `warn` or `alert` | `WARN` |
| `debug` | `DEBUG` |
| Anything else | `INFO` |

### Log format

Each line is a JSON object:

```json
{"ts":"2026-02-12T11:24:17.123+01:00","level":"INFO","channel":"heartbeat","event":"result","data":{"ok":true,"durationMs":3200}}
```

The bus event name is split on the first `:` into `channel` and `event`:  
`heartbeat:result` → `channel: "heartbeat"`, `event: "result"`

### Known bus events captured

`channel:send/receive/register` · `cron:job_start/job_complete/add/remove/enable/disable/run/status/reload` · `heartbeat:check/result` · `jobs:recorded` · `web:mount/unmount/mount-api/unmount-api/ready` · `kysely:ready/ack`

For events not in this list, use the `log` / `log:*` protocol above.

## Commands

| Command | Description |
|---------|-------------|
| `/logger` or `/logger status` | Show current settings and active subscription count |
| `/logger level <DEBUG\|INFO\|WARN\|ERROR>` | Change minimum log level for the current session |
| `/logger scope <global\|project>` | Change log scope for the current session |
| `/logger reload` | Reload settings from disk and resubscribe to events |

## Install

```bash
pi install npm:@e9n/pi-logger
```

## License

MIT
