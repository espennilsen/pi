# pi-telemetry

Local-only telemetry extension for [pi](https://github.com/badlogic/pi-mono). Records lightweight, privacy-safe events (no prompts, completions, or file contents) to per-day JSONL files under `~/.pi/agent/telemetry/`.

## Installation

```bash
pi install github.com/espennilsen/pi-telemetry
```

Or try it without installing:

```bash
pi -e git:github.com/espennilsen/pi-telemetry
```

## Configuration

Add to `~/.pi/agent/settings.json`:

```jsonc
{
  "telemetry": {
    "mode": "on",       // "on" (default) | "off"
    "level": "INFO"     // "NONE" | "DEBUG" | "INFO" (default) | "WARN" | "ERROR" | "CRITICAL"
  }
}
```

Or toggle at runtime with the `/telemetry` command:

```
/telemetry              → show current mode & level
/telemetry on           → enable telemetry
/telemetry off          → disable telemetry
/telemetry on WARN      → enable, only WARN and above
```

## Events

All events contain only numeric, enum, or ID fields. **No prompts, completions, file contents, or raw commands are ever recorded.**

| Event            | Level    | Fields                                         |
|------------------|----------|-------------------------------------------------|
| `session_start`  | INFO     | `agentVersion`, `cwdHash`                      |
| `session_end`    | INFO     | `reason`, `durationMs`                         |
| `model_call`     | INFO/WARN| `provider`, `modelId`, `turnIndex`, `error`    |
| `tool_call`      | INFO/ERROR| `toolName`, `durationMs`, `error`             |
| `config_change`  | INFO     | `provider`, `modelId`, `source`                |

## Output

Events are written as JSONL (one JSON object per line) to daily files:

```
~/.pi/agent/telemetry/
├── 2026-02-10.jsonl
├── 2026-02-11.jsonl
└── ...
```

Example line:

```json
{"type":"session_start","level":"INFO","agentVersion":"0.52.9","cwdHash":"c3d247157174","ts":"2026-02-11T12:43:48.440Z","sessionId":"5255544ed0a2"}
```

## Project Structure

```
pi-telemetry/
├── package.json        # pi extension manifest
├── README.md
└── src/
    ├── index.ts        # Extension entry point (event subscriptions + /telemetry command)
    ├── types.ts        # TelemetryEvent union, mode/level types
    ├── config.ts       # TelemetryConfig, defaults, shouldLog() filter
    └── writer.ts       # JSONL writer (per-day files under ~/.pi/agent/telemetry/)
```
