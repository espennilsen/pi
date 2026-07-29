---
name: herdr-operations
description: Use when inspecting or operating Herdr sessions, workspaces, tabs, panes, agents, terminal output, agent messaging, or waits.
---

# Herdr Operations

Inspect state before acting. Use the installed CLI help as the authority for the current version.

## Safe discovery

```bash
herdr status
herdr session list --json
herdr workspace list
herdr pane list
herdr agent list
```

If one command fails, do not try invented alternatives. Run `herdr --help`, then the relevant command group's `--help`; if needed, use [the upstream docs fallback](references/upstream-docs.md).

## Choose the right target

| Need | Use |
| --- | --- |
| Coding-agent state, output, or message | `herdr agent …` |
| Server, test, shell, or low-level terminal control | `herdr pane …` |
| Submit a shell command atomically | `herdr pane run <pane_id> <command>` |
| Read logs without soft wrapping | `--source recent-unwrapped` |

## Common workflows

Inspect an agent, then use the installed agent-message command:

```bash
herdr agent list
herdr agent get <target>
herdr agent read <target> --source recent-unwrapped --lines 120
herdr agent --help
herdr agent <installed-message-command> <target> "<message>"
```

For example, documented releases have used `agent send`; newer releases may expose another message command. Use the spelling and argument order from local help.

Create an unfocused workspace or split pane so current work remains visible:

```bash
herdr workspace create --cwd <path> --label <label> --no-focus
herdr pane split <pane_id> --direction right --no-focus
```

Wait rather than polling:

```bash
herdr agent wait <target> --status idle --timeout 300000
herdr wait output <pane_id> --match "<text>" --timeout 300000
```

## Safety

- Read output before sending input to an agent.
- Use `pane run` instead of separate text and Enter events for shell commands.
- Ask before stopping/deleting sessions or closing workspaces, tabs, or panes.
- Treat agent messages as literal terminal input; do not send destructive instructions without explicit user approval.
