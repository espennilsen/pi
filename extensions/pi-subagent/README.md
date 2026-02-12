# pi-subagent

Parallel task delegation extension for [pi](https://github.com/badlogic/pi-mono). Spawn isolated `pi -p` subprocesses for single, parallel, or chained tasks.

## Install

```bash
pi install /path/to/pi-subagent
```

## Features

- **`subagent` tool** — spawn isolated pi subprocesses from the LLM
- **Parallel execution** — run multiple tasks concurrently with configurable limits
- **Agent discovery** — reads agent definitions from `~/.pi/agent/agents/*.md` and `.pi/agents/*.md`
- **One-shot tracking** — event bus integration for tracking subprocess runs
- **Chain mode** — pipe output from one agent into the next

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-subagent": {
    "maxConcurrent": 4,
    "maxTotal": 8,
    "timeoutMs": 600000,
    "model": null
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `maxConcurrent` | `4` | Max subagents running in parallel. |
| `maxTotal` | `8` | Max total subagents per session. |
| `timeoutMs` | `600000` | Subprocess timeout (10 min). |
| `model` | `null` | Model override for subprocesses (null = use default). |

## Events

| Event | When | Payload |
|-------|------|---------|
| `subagent:start` | Subprocess spawned | `{ agent, task, trackingId }` |
| `subagent:complete` | Subprocess finished | `{ agent, trackingId, status, tokens, cost, durationMs }` |

## Exports

```typescript
import { runIsolatedAgent } from "pi-subagent";
import { discoverAgents } from "pi-subagent";
import { oneShotTracker } from "pi-subagent";
```

## Architecture

```
src/
├── index.ts      # Extension entry — tool registration, exports
├── settings.ts   # Settings loader
├── tool.ts       # LLM tool (single, parallel, chain modes)
├── runner.ts     # Subprocess runner (pi -p --no-session)
├── agents.ts     # Agent discovery from .md files
├── tracker.ts    # One-shot run tracking
└── types.ts      # Shared types
```

## License

MIT
