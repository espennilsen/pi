# pi-logger

Event bus logger for [pi](https://github.com/badlogic/pi-mono). Listens for events on the shared event bus and writes structured JSONL log files.

## Install

```bash
pi install /path/to/pi-logger
```

## How it works

1. On session start, subscribes to event bus events based on settings
2. Each captured event is written as a JSON line to a per-day file
3. Log files are stored either globally (`~/.pi/agent/logs/`) or per-project (`.pi/logs/`)
4. Timestamps use the configured timezone (defaults to your system timezone)
5. Events are filtered by level, event whitelist/ignore, and channel whitelist/ignore

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

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
| `scope` | `"global"` | Where to write logs: `"global"` → `~/.pi/agent/logs/`, `"project"` → `.pi/logs/`. |
| `timezone` | System tz | IANA timezone for timestamps (e.g. `"Europe/Oslo"`). |
| `events_whitelist` | `["log"]` | Bus event prefixes to subscribe to. Default captures `log` and `log:*`. Set to `[]` to capture all known bus events. |
| `events_ignore` | `[]` | Bus event prefixes to skip (applied after whitelist). |
| `channels_whitelist` | `[]` | Channels to accept in the `log` handler. Empty = all. Only affects `emit("log", { channel, ... })`. |
| `channels_ignore` | `[]` | Channels to drop in the `log` handler (applied after whitelist). |

### Examples

Log all bus events (not just `log:*`):

```json
{
  "pi-logger": {
    "events_whitelist": []
  }
}
```

Log only heartbeat and cron events:

```json
{
  "pi-logger": {
    "events_whitelist": ["heartbeat", "cron"],
    "level": "DEBUG"
  }
}
```

Log everything except web server lifecycle:

```json
{
  "pi-logger": {
    "events_whitelist": [],
    "events_ignore": ["web"]
  }
}
```

Only log from specific channels:

```json
{
  "pi-logger": {
    "channels_whitelist": ["webserver", "db"]
  }
}
```

Log all channels except noisy ones:

```json
{
  "pi-logger": {
    "channels_ignore": ["trace", "metrics"]
  }
}
```

Per-project logging with European timezone:

```json
{
  "pi-logger": {
    "scope": "project",
    "level": "DEBUG",
    "timezone": "Europe/Oslo"
  }
}
```

## Log scope

The `scope` setting controls where log files are written:

| Scope | Path | Use case |
|-------|------|----------|
| `"global"` | `~/.pi/agent/logs/YYYY-MM-DD.jsonl` | Default. All sessions write to a single location. Good for cross-project monitoring and centralized log review. |
| `"project"` | `.pi/logs/YYYY-MM-DD.jsonl` | Logs stay inside the project directory. Good for project-specific debugging, keeping logs alongside code, and `.gitignore`-able output. |

With `"project"` scope, each project gets its own log directory under `.pi/logs/` relative to the working directory. Add `.pi/logs/` to your `.gitignore` to avoid committing logs.

You can set global defaults and override per-project. For example, global `settings.json`:

```json
{
  "pi-logger": { "scope": "global" }
}
```

Then in a specific project's `.pi/settings.json`:

```json
{
  "pi-logger": { "scope": "project", "level": "DEBUG" }
}
```

That project's logs go to `.pi/logs/` with debug-level verbosity, while everything else logs globally at INFO.

The scope can also be changed at runtime via `/logger scope project` or `/logger scope global`, though this only lasts for the current session.

## Log format

Each line is a JSON object. The bus event name is split into `channel` and `event`:

```json
{"ts":"2026-02-12T11:24:17.123","level":"WARN","channel":"webserver","event":"","data":{"path":"/api/err"}}
{"ts":"2026-02-12T11:24:18.456","level":"INFO","channel":"heartbeat","event":"result","data":{"ok":true,"durationMs":3200}}
{"ts":"2026-02-12T11:24:19.789","level":"ERROR","channel":"log","event":"error","data":{"message":"connection refused"}}
{"ts":"2026-02-12T11:24:20.012","level":"INFO","channel":"db","event":"slow-query","data":{"ms":500}}
```

| Field | Description |
|-------|-------------|
| `ts` | Timestamp in the configured timezone |
| `level` | `DEBUG`, `INFO`, `WARN`, or `ERROR` |
| `channel` | Bus channel — prefix before the first `:` (e.g. `log`, `heartbeat`, `cron`) |
| `event` | Event name — suffix after the first `:` (e.g. `webserver`, `result`, `job_start`) |
| `data` | Event payload (whatever was emitted) |

The split means `log:webserver` becomes `channel: "log"`, `event: "webserver"`, and `heartbeat:result` becomes `channel: "heartbeat"`, `event: "result"`.

Files are named `YYYY-MM-DD.jsonl` based on the configured timezone.

## Level inference

Events are assigned a level from their name when no explicit level is given:

| Pattern | Level |
|---------|-------|
| Contains `error` or `fail` | `ERROR` |
| Contains `warn` or `alert` | `WARN` |
| Contains `debug` | `DEBUG` |
| Everything else | `INFO` |

## Direct logging API

All custom logging goes through the `"log"` bus event. Set `channel`, `level`, `event`, and `data` in the payload:

```typescript
// Custom channel with explicit level
// → { channel: "webserver", event: "", level: "WARN", data: ... }
pi.events.emit("log", { channel: "webserver", level: "WARN", data: { path: "/api/err" } });

// Channel + event
// → { channel: "db", event: "slow-query", level: "INFO", data: ... }
pi.events.emit("log", { channel: "db", event: "slow-query", data: { ms: 500 } });

// No channel — defaults to "log"
// → { channel: "log", event: "", level: "ERROR", data: ... }
pi.events.emit("log", { level: "ERROR", data: { message: "out of memory" } });
```

Shorthand events `log:debug`, `log:info`, `log:warn`, `log:error` infer the level from the name, but you can override it in the payload:

```typescript
// Level inferred as ERROR from event name
pi.events.emit("log:error", { event: "my-ext:crash", data: { message: "segfault" } });

// Level inferred as INFO
pi.events.emit("log:info", { event: "my-ext:started", data: { port: 3000 } });

// Override: emitted on log:warn but logged as ERROR
pi.events.emit("log:warn", { event: "cache-miss", level: "ERROR", data: { key: "foo" } });
```

## Known bus events captured

| Event | Source |
|-------|--------|
| `channel:send`, `channel:receive`, `channel:register` | pi-channels |
| `cron:job_start`, `cron:job_complete`, `cron:add`, `cron:remove`, `cron:enable`, `cron:disable`, `cron:run`, `cron:status`, `cron:reload` | pi-cron |
| `heartbeat:check`, `heartbeat:result` | pi-heartbeat |
| `jobs:recorded` | pi-jobs |
| `web:mount`, `web:unmount`, `web:mount-api`, `web:unmount-api`, `web:ready` | pi-webserver |
| `kysely:ready`, `kysely:ack` | pi-kysely |

For events not in this list, use the `log` / `log:*` protocol above.

## Commands

| Command | Description |
|---------|-------------|
| `/logger` or `/logger status` | Show current settings and subscription count |
| `/logger level <LVL>` | Change log level at runtime |
| `/logger scope <global\|project>` | Change log scope at runtime |
| `/logger reload` | Reload settings from disk and resubscribe |

## Architecture

```
src/
├── index.ts      # Extension entry — lifecycle, bus subscriptions, /logger command
├── settings.ts   # Settings loader (global + project merge)
└── writer.ts     # JSONL file writer with timezone-aware timestamps
```

## License

MIT
