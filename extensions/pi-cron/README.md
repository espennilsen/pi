# pi-cron

Cron scheduler extension for [pi](https://github.com/badlogic/pi-mono). Schedule recurring prompts that run as isolated `pi -p` subprocesses.

## Install

```bash
pi install /path/to/pi-cron
# or
pi install git:github.com/user/pi-cron
```

## Key design

- **No database** — jobs stored in a plain `~/.pi/agent/pi-cron.tab` crontab file
- **File watcher** — scheduler reloads automatically when the tab file changes (hand-edit friendly)
- **Disabled by default** — scheduler doesn't run unless explicitly started
- **Lock file** — only one pi instance can run the scheduler (`~/.pi/agent/pi-cron.lock`)
- **Extension API** — other extensions can read/write jobs via `pi.events`

## Scheduler control

The scheduler is **off by default**. Start it with:

```bash
pi --cron                 # Flag: enable on startup
```

Or toggle at runtime:

```
/cron on                  # Start scheduler
/cron off                 # Stop scheduler
/cron                     # Show status
```

Or via settings (autostart on every session):

```json
{ "pi-cron": { "autostart": true } }
```

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-cron": {
    "autostart": true,
    "activeHours": { "start": "08:00", "end": "22:00" },
    "route": "cron",
    "showOk": false
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `autostart` | `false` | Start the scheduler automatically on session start. |
| `activeHours` | `{ "start": "08:00", "end": "22:00" }` | Suppress job execution outside this window. Set to `null` for 24/7. |
| `route` | `"cron"` | pi-channels route for sending job results (failures, or all results if `showOk`). |
| `showOk` | `false` | Send notifications for successful jobs too (not just failures). |

## Crontab format

`~/.pi/agent/pi-cron.tab` — one job per line:

```
# <min> <hour> <dom> <month> <dow>  <name>  [channel:<ch>]  [disabled]  <prompt>

0 9 * * 1-5  daily-standup  Review my td tasks and summarize what's open
*/15 * * * *  health-check  channel:ops  Check system health
0 0 * * 0  weekly-digest  disabled  Summarize the week
```

You can edit this file directly — the scheduler picks up changes via file watcher.

## LLM tool

The `cron` tool supports: `list`, `add`, `update`, `remove`, `enable`, `disable`, `run`.

Reading and writing jobs works regardless of scheduler state. Only `run` requires an active scheduler.

## Extension API

Other pi extensions can interact with cron via the shared event bus:

```typescript
// Read
pi.events.emit("cron:list", { callback: (jobs) => console.log(jobs) });
pi.events.emit("cron:get", { name: "my-job", callback: (job) => ... });
pi.events.emit("cron:status", { callback: (status) => ... });

// Write (modifies crontab file, scheduler picks up via watcher)
pi.events.emit("cron:add", { name: "my-job", schedule: "0 9 * * 1-5", prompt: "...", callback: (result) => ... });
pi.events.emit("cron:update", { name: "my-job", schedule: "0 10 * * 1-5", callback: (result) => ... });
pi.events.emit("cron:remove", { name: "my-job", callback: (result) => ... });
pi.events.emit("cron:enable", { name: "my-job", callback: (result) => ... });
pi.events.emit("cron:disable", { name: "my-job", callback: (result) => ... });
pi.events.emit("cron:run", { name: "my-job", callback: (result) => ... });

// Listen for job lifecycle
pi.events.on("cron:job_start", (event) => { /* { job, startedAt } */ });
pi.events.on("cron:job_complete", (event) => { /* { job, startedAt, durationMs, ok, error?, responsePreview? } */ });
pi.events.on("cron:reload", (jobs) => { /* array of CronJob */ });
```

All callbacks are optional. Write results have `{ ok: boolean, message: string }`.

## How it works

1. Extension creates `~/.pi/agent/pi-cron.tab` on first load
2. Scheduler starts only when enabled (`--cron` flag or `/cron on`)
3. Lock file prevents multiple pi instances from scheduling simultaneously
4. Scheduler ticks every 30 seconds, matching cron expressions against local time
5. On match, spawns `pi -p "<prompt>"` as a child process (crash-isolated, fresh context)
6. File watcher reloads the job list when the tab file changes

## Development

```bash
cd pi-cron
npm install
pi -e ./src/index.ts        # Test locally
pi --cron -e ./src/index.ts  # Test with scheduler active
```
