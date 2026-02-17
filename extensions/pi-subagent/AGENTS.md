---
name: pi-subagent
description: Parallel task delegation for pi — spawn isolated subagent subprocesses in single, parallel, chain, orchestrator, or pool modes
---

## Overview

Extension that delegates tasks to isolated pi subprocesses. Each subagent gets a fresh context window. Supports five execution modes, custom agent profiles, hierarchical orchestrator trees, and long-lived pool agents with persistent context.

**Stack:** TypeScript · pi subprocess spawning · Unix socket RPC (pool mode) · pi-tui rendering

## Architecture

- `src/index.ts` — Entry point. Registers tool (sync, before session_start). Injects available agents into system prompt via `before_agent_start`. Cleans up pool on shutdown.
- `src/tool.ts` — `subagent` LLM tool. All 5 modes, TUI `renderCall`/`renderResult`, concurrency limiter.
- `src/runner.ts` — `runIsolatedAgent()` — spawns a `pi` subprocess and streams `Message[]` back.
- `src/agents.ts` — Agent discovery from `~/.pi/agent/agents/*.md` (user) and `.pi/agents/*.md` (project). Parses YAML frontmatter.
- `src/pool.ts` — `AgentPool` — manages long-lived RPC agents. Handles spawn/send/kill with tree tracking and usage aggregation.
- `src/pool-server.ts` — Unix socket RPC server injected into orchestrator/pool subagents so they can spawn children.
- `src/rpc-agent.ts` — `RpcAgent` — single long-lived agent subprocess connected to pool server via IPC.
- `src/router.ts` — Routes IPC messages from subagents to pool actions.
- `src/tracker.ts` — `oneShotTracker` — in-memory log of all one-shot runs (status, usage, timing).
- `src/settings.ts` — Reads `pi-subagent` block; merges global + project. Default blocked extensions hardcoded.
- `src/types.ts` — All shared types: `AgentConfig`, `SingleResult`, `SubagentDetails`, `PoolDetails`, `SubagentSettings`, etc.
- `src/logger.ts` — Extension logger.

## Tool: `subagent`

### Modes

| Mode | Params | Description |
|------|--------|-------------|
| **single** | `agent`, `task` | One agent, one task |
| **parallel** | `tasks: [{agent, task}]` | Concurrent execution, streaming progress |
| **chain** | `chain: [{agent, task}]` | Sequential pipeline; use `{previous}` to inject prior output |
| **orchestrator** | `orchestrator: {agent, task}` | Root agent gets spawn/send/kill/list tools; builds hierarchical tree |
| **pool** | `action: spawn/send/list/kill/kill-all` + `id`, `message` | Manual long-lived agents with persistent context |

### Per-task overrides (apply to all modes)

`model`, `thinking` (off/minimal/low/medium/high/xhigh), `extensions`, `skills`, `noTools`, `noSkills`

**Priority:** per-task params > top-level params > agent .md frontmatter > global settings

## Agent Definition Files

Agents are defined as markdown files with YAML frontmatter:

```markdown
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
extensions: extensions/pi-brave-search
---
System prompt content...
```

- **User agents:** `~/.pi/agent/agents/*.md` — always available
- **Project agents:** `.pi/agents/*.md` — only with `agentScope: "project"` or `"both"`
- Project agents require `ctx.ui.confirm()` before running (prompt injection protection)

## Key Patterns

- **Tool registered synchronously** — not in `session_start`, so it's immediately visible to the model.
- **Subagents run with `-ne` by default** — no extensions loaded unless explicitly whitelisted via `extensions` param or agent frontmatter.
- **pi-subagent is always blocked** in subagents — hardcoded, cannot be overridden (prevents infinite recursion).
- **Default blocked:** pi-webserver, pi-cron, pi-heartbeat, pi-channels, pi-web-dashboard, pi-telemetry.
- **Events emitted:** `subagent:start { agent, task, trackingId }`, `subagent:complete { agent, trackingId, status, tokens, cost, durationMs }`.

## Settings

```jsonc
// settings.json
{
  "pi-subagent": {
    "maxConcurrent": 4,       // Max parallel agents at once
    "maxTotal": 8,            // Max tasks per parallel call
    "timeoutMs": 600000,      // Per-agent timeout (ms)
    "model": null,            // Global model override
    "extensions": [],         // Extensions whitelisted for all subagents
    "maxPoolSize": 20,        // Max agents in a pool/orchestrator tree
    "maxDepth": 4             // Max orchestrator tree depth
  }
}
```

## Integration Points

| Extension | Integration | Mechanism |
|-----------|------------|-----------|
| **pi-logger** | Structured logging | `log` event |

## Conventions

- No DB — all state is in-memory (`oneShotTracker`, `AgentPool`).
- Pool is disposed on `session_shutdown` — long-lived agents do not survive session restarts.
- `agentScope` defaults to `"user"` — project agents must be explicitly requested.
