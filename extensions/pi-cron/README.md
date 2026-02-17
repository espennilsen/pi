# @e9n/pi-cron

Cron scheduler for [pi](https://github.com/espennilsen/pi) — schedule recurring prompts that run as isolated `pi -p` subprocesses.

## Features

- **No database** — jobs stored in `~/.pi/agent/pi-cron.tab` (plain text, hand-edit friendly)
- **Live reload** — file watcher reloads jobs automatically when the tab changes
- **Disabled by default** — scheduler doesn't run unless explicitly started
- **Lock file** — only one pi instance can run the scheduler at a time (`~/.pi/agent/pi-cron.lock`)
- **Event API** — `cron:add`, `cron:list`, `cron:job_complete`, etc. for inter-extension use

## Enabling the scheduler

The scheduler is **off by default**. Start it with:

```bash
pi --cron                    # CLI flag — enable on startup
```

Or toggle at runtime:

```
/cron on                     # Start scheduler
/cron off                    # Stop scheduler
/cron                        # Show status
```

Or set `"pi-cron": { "autostart": true }` in your settings file to start automatically every session.

## Tool: `cron`

| Action | Required params | Description |
|--------|----------------|-------------|
| `list` | — | Show all jobs with status |
| `add` | `name`, `schedule`, `prompt` | Add a new job (`schedule` is a standard cron expression) |
| `update` | `name` | Update schedule, prompt, or channel for an existing job |
| `remove` | `name` | Remove a job |
| `enable` | `name` | Re-enable a disabled job |
| `disable` | `name` | Disable a job without removing it |
| `run` | `name` | Trigger a job immediately (scheduler must be active) |

## Commands

| Command | Description |
|---------|-------------|
| `/cron on` | Start the scheduler |
| `/cron off` | Stop the scheduler |
| `/cron` | Show status (active, PID, job count) |

## Install

```bash
pi install npm:@e9n/pi-cron
```

## License

MIT
