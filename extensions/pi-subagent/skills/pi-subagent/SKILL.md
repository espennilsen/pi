---
name: pi-subagent
description: Delegate tasks to specialized subagents for parallel or sequential execution.
---

# Subagent Orchestration

Use the `subagent` tool to delegate tasks to isolated pi subprocesses. Each subagent gets a fresh context window — no shared state with the parent session.

## When to use subagents

- A task can be split into independent pieces that run in parallel
- You need a chain of specialists (scout → planner → worker)
- A subtask benefits from a clean context window (no accumulated noise)
- You want crash isolation (failed subtask doesn't corrupt main session)

## Modes

### Single — one agent, one task
```json
{ "agent": "scout", "task": "Find all REST endpoints in src/" }
```

### Parallel — multiple agents concurrently (streams progress as each completes)
```json
{ "tasks": [
    { "agent": "scout", "task": "Audit auth module" },
    { "agent": "scout", "task": "Audit API routes" },
    { "agent": "scout", "task": "Audit database queries" }
  ]
}
```

### Chain — sequential pipeline, use `{previous}` for prior step's output
```json
{ "chain": [
    { "agent": "scout", "task": "Find all TODO comments in the codebase" },
    { "agent": "planner", "task": "Categorize and prioritize these TODOs:\n{previous}" },
    { "agent": "worker", "task": "Fix the top 3 critical TODOs:\n{previous}" }
  ]
}
```

## Per-task options

Every task (single, parallel item, chain step) supports these overrides:

| Option | Type | Description |
|--------|------|-------------|
| `model` | string | Model override (e.g. `"claude-haiku-4-5"` for fast, `"claude-sonnet-4-5"` for complex) |
| `thinking` | string | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `extensions` | string[] | Extension paths to load (subagents run with `-ne` — only whitelisted) |
| `skills` | string[] | Skill files/dirs to load via `--skill` |
| `noTools` | boolean | Disable all built-in tools (`--no-tools`) — for analysis-only agents |
| `noSkills` | boolean | Disable skill discovery (`-ns`) |
| `cwd` | string | Working directory override |

**Priority:** per-task item > top-level params > agent .md frontmatter > global settings

### Examples

**Fast recon with cheap model, no thinking overhead:**
```json
{ "agent": "scout", "task": "Map the auth module", "model": "claude-haiku-4-5", "thinking": "off" }
```

**Research task needing web search:**
```json
{ "agent": "worker", "task": "Find pricing for Vercel Pro", "extensions": ["extensions/pi-brave-search"] }
```

**Parallel with different models per task:**
```json
{ "tasks": [
    { "agent": "scout", "task": "Map the codebase", "model": "claude-haiku-4-5" },
    { "agent": "reviewer", "task": "Review the PR diff", "model": "claude-sonnet-4-5", "thinking": "high" }
  ]
}
```

**Chain with escalating capability:**
```json
{ "chain": [
    { "agent": "scout", "task": "Map the auth module", "model": "claude-haiku-4-5", "thinking": "off" },
    { "agent": "planner", "task": "Plan a refactor based on: {previous}", "thinking": "high" },
    { "agent": "worker", "task": "Implement the plan: {previous}", "thinking": "medium" }
  ]
}
```

## Extension isolation

Subagents always run with `--no-extensions` (`-ne`). They cannot:
- Spawn further subagents (pi-subagent is always blocked)
- Send messages via channels, cron, or heartbeat
- Access the web dashboard or webserver

Whitelist only what a specific task needs via the `extensions` parameter.

## Agent scope

- `"user"` (default) — loads from `~/.pi/agent/agents/*.md`
- `"both"` — also includes `.pi/agents/*.md` (prompts for confirmation)
- `"project"` — only project-local agents

## Creating agents

Place `.md` files in `~/.pi/agent/agents/` with YAML frontmatter:

```yaml
---
name: scout
description: Fast codebase reconnaissance
tools: read, grep, find, ls, bash
extensions: extensions/pi-dotenv
model: claude-haiku-4-5
---
System prompt for the agent goes here...
```

| Frontmatter | Description |
|-------------|-------------|
| `name` | Agent name (required) |
| `description` | What the agent does (required) |
| `tools` | Comma-separated tool whitelist |
| `model` | Default model |
| `extensions` | Comma-separated extension paths to load |

## Tips

- **Scout first:** use scout (haiku, fast) for recon, then hand results to planner/worker
- **Parallel for independence:** only parallelize truly independent tasks
- **Chain for pipelines:** scout → planner → worker is the classic pattern
- **Model matching:** use haiku for simple recon, sonnet for analysis/implementation
- **Thinking levels:** `off` for fast tasks, `high`/`xhigh` for complex reasoning
- **Keep extensions minimal:** only whitelist what's actually needed per task
