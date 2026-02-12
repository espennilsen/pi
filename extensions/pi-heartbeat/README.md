# pi-heartbeat

Periodic health check extension for [pi](https://github.com/badlogic/pi-mono). Runs a configurable prompt on an interval as an isolated subprocess and alerts via pi-channels when something needs attention.

## Install

```bash
pi install /path/to/pi-heartbeat
```

## How it works

1. On each interval, spawns `pi -p --no-session` with a health-check prompt
2. If the agent responds with `HEARTBEAT_OK`, the result is suppressed
3. If the agent responds with anything else, it's treated as an alert and sent via pi-channels
4. Reads `HEARTBEAT.md` from cwd as a checklist of things to verify
5. If `HEARTBEAT.md` is missing, does a generic check

## Enabling

Disabled by default. Three ways to enable:

```bash
# 1. CLI flag
pi --heartbeat

# 2. Runtime command
/heartbeat on

# 3. Settings
{ "pi-heartbeat": { "autostart": true } }
```

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-heartbeat": {
    "autostart": true,
    "intervalMinutes": 15,
    "activeHours": { "start": "08:00", "end": "22:00" },
    "route": "ops",
    "showOk": false,
    "prompt": null
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `autostart` | `false` | Start heartbeat automatically on session start. |
| `intervalMinutes` | `15` | Minutes between health checks. |
| `activeHours` | `{ "start": "08:00", "end": "22:00" }` | Suppress checks outside this window. Set to `null` for 24/7. |
| `route` | `"ops"` | pi-channels route for sending alerts. |
| `showOk` | `false` | Send notifications on `HEARTBEAT_OK` too (not just alerts). |
| `prompt` | `null` | Custom prompt override (bypasses HEARTBEAT.md). |

## HEARTBEAT.md

Place a `HEARTBEAT.md` file in your project root with a checklist:

```markdown
# Heartbeat Checklist

- Check if the web server is responding on port 3000
- Verify the database connection is healthy
- Check disk usage isn't above 90%
```

If the file exists but is empty (only headers/blank lines), heartbeat checks are skipped.

## Commands

| Command | Description |
|---------|-------------|
| `/heartbeat on` | Start periodic checks |
| `/heartbeat off` | Stop checks |
| `/heartbeat status` | Show run count, OK/alert counts, last run |
| `/heartbeat run` | Run a check immediately |

## Events

| Event | When | Payload |
|-------|------|---------|
| `heartbeat:check` | Check starts | `{ time }` |
| `heartbeat:result` | Check completes | `{ ok, response, durationMs, time }` |
| `channel:send` | Alert sent | `{ route, text, source: "pi-heartbeat" }` |

## Architecture

```
src/
├── index.ts       # Extension entry — flag, command, lifecycle
├── settings.ts    # Settings loader (global + project)
├── heartbeat.ts   # HeartbeatRunner — interval, subprocess, alert logic
└── prompt.ts      # Prompt builder — reads HEARTBEAT.md, builds prompt
```

## License

MIT
