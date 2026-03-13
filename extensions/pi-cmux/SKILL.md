---
name: cmux
description: Orchestrate cmux terminal panes — split terminals, run parallel processes, read output from other panes, and use the built-in browser. Use when working inside cmux and you need to run a dev server, watch tests, spawn sub-agents, or preview web pages.
---

# cmux Pane Orchestration

You have access to cmux tools for managing terminal panes. Use them to run parallel processes, monitor output, and interact with other terminals.

## Available Tools

| Tool | Purpose |
|---|---|
| `cmux_list` | List all surfaces (panes) and workspaces |
| `cmux_split` | Split pane right or down, optionally run a command |
| `cmux_read` | Read terminal output from another pane |
| `cmux_send` | Send text or keystrokes to another pane |
| `cmux_close` | Close a pane |
| `cmux_notify` | Send desktop notification |
| `cmux_browser` | Open/navigate/snapshot/click/fill/eval in built-in browser |

## Common Patterns

### Dev server + coding workflow
```
1. cmux_split direction="down" command="npm run dev\n"
2. Note the surface ID from the result
3. Work on code in your main terminal (edit files, etc.)
4. cmux_read surface="surface:X" to check dev server output
5. cmux_close surface="surface:X" when done
```

### Parallel test watching
```
1. cmux_split direction="right" command="npm test -- --watch\n"
2. Edit code in main pane
3. cmux_read surface="surface:X" to check test results
4. If tests fail, read the output and fix the code
```

### Sub-agent spawning
```
1. cmux_split direction="right" command="pi \"Task description here\"\n"
2. Continue working on your own task
3. cmux_read surface="surface:X" to check sub-agent progress
4. cmux_close surface="surface:X" when sub-agent finishes
```

### Web preview with browser
```
1. Start dev server: cmux_split direction="down" command="npm run dev\n"
2. Open browser: cmux_browser action="open" url="http://localhost:3000"
3. Get DOM: cmux_browser action="snapshot" surface="surface:X" compact=true
4. Interact: cmux_browser action="click" surface="surface:X" selector="button.submit"
5. Fill form: cmux_browser action="fill" surface="surface:X" selector="input[name=email]" value="test@example.com"
```

### Stopping a process in another pane
```
1. cmux_send surface="surface:X" key="ctrl+c"
2. Wait a moment, then cmux_read to confirm it stopped
```

## Guidelines

- **Always `cmux_list` first** if you don't know the surface IDs
- **Append `\n` to commands** in `cmux_split` and `cmux_send` to execute them
- **Read before assuming** — use `cmux_read` to check what happened in other panes
- **Clean up** — close panes you no longer need with `cmux_close`
- **Don't close your own pane** — only close panes you created
- **Notify on completion** — use `cmux_notify` for long-running tasks so the user knows
- **Surface IDs are like `surface:2`** — use the exact format from `cmux_list` or `cmux_split` results
