# @e9n/pi-subagent

Parallel task delegation extension for [pi](https://github.com/mariozechner/pi-coding-agent). Spawn isolated pi subprocesses for single, parallel, chain, orchestrator, and pool-based agent workflows.

## Features

- **Single** — delegate one task to a named agent subprocess
- **Parallel** — run multiple independent tasks concurrently; results stream back as they complete
- **Chain** — pipeline tasks where each step receives the previous output via `{previous}`
- **Orchestrator** — hierarchical agent trees where agents spawn and message each other autonomously
- **Pool** — long-lived agents with persistent context; send follow-up messages without losing state
- **Agent discovery** — reads agent definitions from `~/.pi/agent/agents/*.md` and `.pi/agents/*.md`
- **Extension isolation** — subagents run with `--no-extensions` by default; whitelist only what's needed
- **System prompt injection** — injects available agents and usage patterns into the LLM context automatically
- **Bundled skill** — includes skill definitions for agent orchestration patterns

## Setup

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-subagent": {
    "maxConcurrent": 4,
    "maxTotal": 8,
    "timeoutMs": 600000,
    "model": null,
    "extensions": [],
    "blockedExtensions": []
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `maxConcurrent` | `4` | Max subagents running in parallel |
| `maxTotal` | `8` | Max total subagents per session |
| `timeoutMs` | `600000` | Subprocess timeout in ms (10 min) |
| `model` | `null` | Model override for all subagents (`null` = use default) |
| `extensions` | `[]` | Extension paths whitelisted for all subagents |
| `blockedExtensions` | `[see below]` | Extensions subagents can never load. Default: `pi-webserver`, `pi-cron`, `pi-heartbeat`, `pi-channels`, `pi-web-dashboard`, `pi-telemetry`. `pi-subagent` is always blocked. |

## Tool: `subagent`

Delegate tasks to isolated pi subprocesses. Choose a mode by supplying the matching parameter.

### Modes

| Mode | How to invoke | Description |
|------|---------------|-------------|
| **Single** | `{ agent, task }` | Run one agent on one task |
| **Parallel** | `{ tasks: [{agent, task}, …] }` | Run multiple tasks concurrently |
| **Chain** | `{ chain: [{agent, task}, …] }` | Pipeline — each step gets `{previous}` output |
| **Orchestrator** | `{ orchestrator: {agent, task} }` | Root agent spawns and manages sub-agents autonomously |
| **Pool: spawn** | `{ action: "spawn", id, agent, task }` | Start a persistent agent |
| **Pool: send** | `{ action: "send", id, message }` | Send a follow-up message to a pool agent |
| **Pool: list** | `{ action: "list" }` | List all active pool agents |
| **Pool: kill** | `{ action: "kill", id }` | Kill a pool agent and its children |
| **Pool: kill-all** | `{ action: "kill-all" }` | Tear down entire pool |

### Key Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent` | string | Agent name (from discovered `.md` definitions) |
| `task` | string | Task prompt for the subagent |
| `model` | string | Model override for this invocation |
| `thinking` | string | Thinking budget: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `extensions` | string[] | Extra extension paths to whitelist for this invocation |
| `noTools` | boolean | Run without file/bash tools |
| `agentScope` | string | Agent discovery scope: `user`, `project`, or `both` |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `subagent:start` | `{ agent, task, trackingId }` | Fired when a subprocess is spawned |
| `subagent:complete` | `{ agent, trackingId, status, tokens, cost, durationMs }` | Fired when a subprocess finishes |

## Install

```bash
pi install npm:@e9n/pi-subagent
```

## License

MIT
