# pi-subagent

Parallel task delegation extension for [pi](https://github.com/badlogic/pi-mono). Spawn isolated `pi -p` subprocesses for single, parallel, or chained tasks.

## Install

```bash
pi install /path/to/pi-subagent
```

## Features

- **`subagent` tool** — spawn isolated pi subprocesses from the LLM
- **Parallel execution** — run multiple tasks concurrently with streaming progress
- **Chain mode** — pipe output from one agent into the next via `{previous}` placeholder
- **Agent discovery** — reads agent definitions from `~/.pi/agent/agents/*.md` and `.pi/agents/*.md`
- **Extension isolation** — subagents run with `-ne` (no extension discovery) by default, only whitelisted extensions via `-e`
- **TUI rendering** — rich display with tool call history, markdown output, usage stats
- **One-shot tracking** — event bus integration for tracking subprocess runs

## Extension Isolation

Subagents always run with `--no-extensions` (`-ne`) to prevent:
- Recursive subagent spawning (no depth bomb)
- Subagents accessing channels, vault, finance, CRM, etc.
- Uncontrolled extension side effects in subprocess context

Extensions can be whitelisted at three levels (all merged, deduplicated):

### 1. Tool call (agent decides at runtime)

```json
{
  "agent": "researcher",
  "task": "Find pricing info for Vercel",
  "extensions": ["extensions/pi-brave-search", "extensions/pi-webnav"]
}
```

### 2. Per-agent (in agent .md frontmatter)

```yaml
---
name: researcher
description: Web research agent
tools: read, bash
extensions: extensions/pi-brave-search, extensions/pi-webnav
model: claude-haiku-4-5
---
```

### 3. Global (all subagents)

```json
{
  "pi-subagent": {
    "extensions": ["extensions/pi-dotenv"]
  }
}
```

### Blocked extensions

Some extensions are blocked by default (configurable via `blockedExtensions`). `pi-subagent` is always blocked (prevents recursion).

```json
{
  "pi-subagent": {
    "blockedExtensions": ["pi-webserver", "pi-cron", "pi-heartbeat", "pi-channels", "pi-web-dashboard", "pi-telemetry"]
  }
}
```

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-subagent": {
    "maxConcurrent": 4,
    "maxTotal": 8,
    "timeoutMs": 600000,
    "model": null,
    "extensions": []
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `maxConcurrent` | `4` | Max subagents running in parallel |
| `maxTotal` | `8` | Max total subagents per session |
| `timeoutMs` | `600000` | Subprocess timeout (10 min) |
| `model` | `null` | Model override for subprocesses (null = use default) |
| `extensions` | `[]` | Extension paths to whitelist for all subagents |
| `blockedExtensions` | `[see below]` | Extensions that subagents can never load. Default: `pi-webserver`, `pi-cron`, `pi-heartbeat`, `pi-channels`, `pi-web-dashboard`, `pi-telemetry`. `pi-subagent` is always blocked. |

## Events

| Event | When | Payload |
|-------|------|---------|
| `subagent:start` | Subprocess spawned | `{ agent, task, trackingId }` |
| `subagent:complete` | Subprocess finished | `{ agent, trackingId, status, tokens, cost, durationMs }` |

## Architecture

```
src/
├── index.ts      # Extension entry — tool registration, exports
├── settings.ts   # Settings loader (includes extensions whitelist)
├── tool.ts       # LLM tool (single, parallel, chain) with TUI rendering
├── runner.ts     # Subprocess runner (pi -p -ne --no-session)
├── agents.ts     # Agent discovery from .md files (supports extensions field)
├── tracker.ts    # One-shot run tracking
└── types.ts      # Shared types
```
