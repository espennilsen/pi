---
name: pi-subagent
description: Delegate tasks to specialized subagents for parallel or sequential execution.
---

# When to use subagents

Use the `subagent` tool when:
- A task can be split into independent pieces that run in parallel
- You need a chain of specialists (research → analyze → summarize)
- A subtask benefits from a clean context window (no accumulated noise)
- You want crash isolation (failed subtask doesn't corrupt main session)

## Modes

### Single
One agent, one task. Use for focused delegation:
```
{ agent: "scout", task: "Find all REST endpoints in src/" }
```

### Parallel
Multiple agents concurrently (up to 4 concurrent, 8 total):
```
{ tasks: [
  { agent: "scout", task: "Audit auth module" },
  { agent: "scout", task: "Audit API routes" },
  { agent: "scout", task: "Audit database queries" }
]}
```

### Chain
Sequential pipeline — each step can use `{previous}` for the prior step's output:
```
{ chain: [
  { agent: "scout", task: "Find all TODO comments in the codebase" },
  { agent: "worker", task: "Categorize these TODOs by priority:\n{previous}" }
]}
```

## Agent scope
- Default: `"user"` — loads agents from `~/.pi/agent/agents/*.md`
- `"both"` — also includes project-local `.pi/agents/*.md` (prompts for confirmation)
- `"project"` — only project-local agents

## Creating agents
Place `.md` files in `~/.pi/agent/agents/` with YAML frontmatter:
```yaml
---
name: scout
description: Fast codebase reconnaissance
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---
System prompt for the agent...
```
