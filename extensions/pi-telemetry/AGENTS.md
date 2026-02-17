---
name: pi-telemetry
description: Local telemetry extension for pi — records session, model, tool, and config events as JSONL files
---

## Overview

Passive event-recording extension. Listens to pi lifecycle events and appends one-JSON-per-line records to daily files under `~/.pi/agent/telemetry/`. No tools registered; one `/telemetry` command for runtime control.

**Stack:** TypeScript · Node.js `fs` (no database)

## Architecture

- `src/index.ts` — Extension entry point. Subscribes to all lifecycle events, hashes PII, emits via `writeTelemetryEvent`. Registers `/telemetry` command.
- `src/types.ts` — Union type `TelemetryEvent` with five variants: `session_start`, `session_end`, `model_call`, `tool_call`, `config_change`.
- `src/config.ts` — `TelemetryConfig` (mode/level), `defaultTelemetryConfig`, `shouldLog()` (level ordering gate).
- `src/writer.ts` — `writeTelemetryEvent()`: resolves today's JSONL path, `mkdirSync`, `appendFileSync`. Errors silently swallowed — telemetry must never break the agent.

## Event Flow

| pi event | telemetry event emitted |
|---|---|
| `session_start` | `session_start` — agentVersion, cwdHash (SHA-256, 12 chars) |
| `session_shutdown` | `session_end` — reason, durationMs |
| `model_select` | `config_change` — provider, modelId, source |
| `turn_end` | `model_call` — provider, modelId, turnIndex, error |
| `tool_call` | (starts timer only) |
| `tool_result` | `tool_call` — toolName, durationMs, isError |

## Storage

Daily JSONL files at `<agentDir>/telemetry/YYYY-MM-DD.jsonl`. Each line is a `JSON.stringify`-ed `TelemetryEvent`. No rotation, no cleanup.

## Settings

```jsonc
// settings.json
{
  "telemetry": {
    "mode": "on",     // "on" | "off"
    "level": "INFO"   // "NONE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL"
  }
}
```

Config is re-read from disk on every `session_start`. Runtime overrides are in-memory only.

## Command

- `/telemetry` — Print current mode/level.
- `/telemetry on|off [LEVEL]` — Toggle mode and/or set level for the running session.

## Key Patterns

- **No PII** — `cwd` and `sessionId` are SHA-256 hashed to 12-char hex digests before writing.
- **Level gate** — `shouldLog(config, level)` uses a numeric ordering (`NONE=0 … CRITICAL=5`).
- **No-op when off** — Every event handler checks `config.mode === "off"` at the top.
- **No imports from other extensions** — Fully self-contained.
