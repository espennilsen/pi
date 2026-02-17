# @e9n/pi-telemetry

Local-only telemetry extension for [pi](https://github.com/badlogic/pi-mono) — records lightweight, privacy-safe events to per-day JSONL files. No prompts, completions, or file contents are ever written.

## Features

- **Event recording** — session, model call, tool call, and config change events
- **Privacy-safe** — only numeric/enum/hashed fields; no user content
- **Per-day JSONL files** — written to `~/.pi/agent/telemetry/`
- **`/telemetry` command** — toggle mode and level at runtime

## Settings

Add to `~/.pi/agent/settings.json`:

```json
{
  "telemetry": {
    "mode": "on",
    "level": "INFO"
  }
}
```

| Setting | Values | Default | Description |
|---------|--------|---------|-------------|
| `mode` | `"on"`, `"off"` | `"on"` | Enable or disable telemetry |
| `level` | `NONE` `DEBUG` `INFO` `WARN` `ERROR` `CRITICAL` | `"INFO"` | Minimum level to record |

## Events

| Event | Level | Fields |
|-------|-------|--------|
| `session_start` | INFO | `agentVersion`, `cwdHash` |
| `session_end` | INFO | `reason`, `durationMs` |
| `model_call` | INFO/WARN | `provider`, `modelId`, `turnIndex`, `error` |
| `tool_call` | INFO/ERROR | `toolName`, `durationMs`, `error` |
| `config_change` | INFO | `provider`, `modelId`, `source` |

Events are written as JSONL to `~/.pi/agent/telemetry/YYYY-MM-DD.jsonl`.

## Commands

| Command | Description |
|---------|-------------|
| `/telemetry` | Show current mode and level |
| `/telemetry on` | Enable telemetry |
| `/telemetry off` | Disable telemetry |
| `/telemetry on WARN` | Enable, recording WARN and above only |

## Install

```bash
pi install npm:@e9n/pi-telemetry
```

## License

MIT
