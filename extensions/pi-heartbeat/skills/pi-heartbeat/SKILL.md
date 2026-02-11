---
name: pi-heartbeat
description: Configure periodic health checks via HEARTBEAT.md and the /heartbeat command.
---

## Pi Heartbeat Extension

Runs a periodic health-check prompt as an isolated subprocess.

### Setup

1. Enable via `--heartbeat` flag, `/heartbeat on`, or settings.json:
   ```json
   { "pi-heartbeat": { "enabled": true, "intervalMinutes": 15 } }
   ```

2. Create a `HEARTBEAT.md` in your project root with check items:
   ```markdown
   # Heartbeat Checklist
   - [ ] Check git status — any uncommitted changes?
   - [ ] Check disk space — anything over 90%?
   - [ ] Review td list for blocked tasks
   ```

3. If the agent responds with `HEARTBEAT_OK`, the result is suppressed. Any other response is treated as an alert and sent via pi-channels.

### Configuration (settings.json)

```json
{
  "pi-heartbeat": {
    "enabled": false,
    "intervalMinutes": 15,
    "activeHours": { "start": "08:00", "end": "22:00" },
    "route": "ops",
    "showOk": false,
    "prompt": null
  }
}
```

- **enabled**: Start heartbeat on session start
- **intervalMinutes**: Check frequency (default: 15)
- **activeHours**: Only run during these hours (null = always)
- **route**: pi-channels route for alerts (default: "ops")
- **showOk**: Also send HEARTBEAT_OK results to the channel
- **prompt**: Custom prompt (overrides HEARTBEAT.md)

### Commands

- `/heartbeat on` — Start periodic checks
- `/heartbeat off` — Stop checks
- `/heartbeat status` — Show run stats
- `/heartbeat run` — Run a check immediately

### Events

- `heartbeat:check` — Emitted when a check starts
- `heartbeat:result` — Emitted with `{ ok, response, durationMs }`
