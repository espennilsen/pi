# @e9n/pi-heartbeat

Periodic health check extension for [pi](https://github.com/mariozechner/pi-mono). Runs a configurable prompt as an isolated subprocess on an interval and alerts via pi-channels when something needs attention.

## Features

- Spawns a `pi --no-session` subprocess to run health checks in isolation
- Reads `HEARTBEAT.md` from cwd as a per-project checklist; falls back to a generic check if missing
- Suppresses `HEARTBEAT_OK` responses; escalates anything else as an alert via pi-channels
- Delivers alerts via the `channel:send` event (integrates with **pi-channels**)
- Optional persistent run history via **pi-kysely**
- Web dashboard at `/heartbeat` via **pi-webserver**
- Disabled by default — enable with `--heartbeat` flag, `/heartbeat on`, or `autostart: true`

## Setup / Settings

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project):

```json
{
  "pi-heartbeat": {
    "autostart": false,
    "intervalMinutes": 15,
    "activeHours": { "start": "08:00", "end": "22:00" },
    "route": "ops",
    "showOk": false,
    "prompt": null,
    "webui": false,
    "useKysely": false,
    "extensions": null
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `autostart` | `false` | Start automatically on session start. |
| `intervalMinutes` | `15` | Minutes between checks. |
| `activeHours` | `{"start":"08:00","end":"22:00"}` | Only run checks inside this window. `null` for 24/7. |
| `route` | `"ops"` | pi-channels route for alert delivery. |
| `showOk` | `false` | Also send a notification on `HEARTBEAT_OK` (not just alerts). |
| `prompt` | `null` | Custom prompt override — bypasses `HEARTBEAT.md`. |
| `webui` | `false` | Mount web dashboard on pi-webserver at `/heartbeat`. |
| `useKysely` | `false` | Persist run history via pi-kysely instead of in-memory. |
| `extensions` | `null` | Extensions to load in the subprocess. `null` = none. |

### HEARTBEAT.md

Place a `HEARTBEAT.md` in your project root with a checklist of things to verify:

```markdown
# Heartbeat Checklist

- Check that the API server responds on port 3000
- Verify database connectivity
- Confirm disk usage is below 90%
```

If the file is missing or contains only headers/blank lines, checks are skipped.

## Commands

| Command | Description |
|---------|-------------|
| `/heartbeat on` | Start periodic checks |
| `/heartbeat off` | Stop checks |
| `/heartbeat status` | Show interval, run count, OK/alert totals, last result |
| `/heartbeat run` | Run a check immediately |

Pass `--heartbeat` at startup to enable automatically: `pi --heartbeat`.

## Web UI

Enable with `"webui": true`. Requires **pi-webserver** (`"pi-webserver": { "autostart": true }`).

Dashboard at `http://localhost:4100/heartbeat` — live status, stats (runs / OK / alerts / rate), last check result, expandable history (up to 100 entries), and start / stop / run controls.

REST API at `/api/heartbeat`:

| Method | Body | Description |
|--------|------|-------------|
| `GET` | — | Status, stats, and history |
| `POST` | `{ "action": "start" }` | Start heartbeat |
| `POST` | `{ "action": "stop" }` | Stop heartbeat |
| `POST` | `{ "action": "run" }` | Run a check immediately |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `heartbeat:check` | `{ time }` | Emitted when a check starts |
| `heartbeat:result` | `{ ok, response, durationMs, time }` | Emitted when a check completes |
| `channel:send` | `{ route, text, source: "pi-heartbeat" }` | Alert dispatched to pi-channels |

## Install

```bash
pi install npm:@e9n/pi-heartbeat
```

## License

MIT
