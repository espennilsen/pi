# pi-cmux

[cmux](https://cmux.dev) terminal app integration for [Pi](https://github.com/mariozechner/pi-coding-agent).

## What it does

When Pi runs inside a cmux terminal, this extension automatically:

- **Notifies you** when the agent finishes (blue ring on cmux tab + desktop notification)
- **Shows status** in the cmux sidebar (thinking, running tools, idle)
- **Gives the agent tools** to split panes, read other terminals, send commands, and control cmux's built-in browser

## Detection

The extension auto-detects cmux via environment variables (`CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`) and the Unix socket at `/tmp/cmux.sock`. Outside cmux, it does nothing.

## Tools

| Tool | Description |
|---|---|
| `cmux_list` | List all panes and workspaces |
| `cmux_split` | Split terminal, optionally run a command |
| `cmux_read` | Read output from another pane |
| `cmux_send` | Send text or keystrokes to another pane |
| `cmux_close` | Close a pane |
| `cmux_notify` | Desktop notification |
| `cmux_browser` | Browser automation (open, snapshot, click, fill, eval) |

## Commands

| Command | Description |
|---|---|
| `/cmux-status` | Show cmux connection info |

## Shortcuts

| Shortcut | Description |
|---|---|
| `Ctrl+Shift+W` | Quick pane switcher |

## Example: dev server + coding

Ask the agent:

> Start a dev server in a split pane, then fix the bug in src/app.ts

The agent will:
1. `cmux_split` down → `npm run dev`
2. Edit `src/app.ts`
3. `cmux_read` the dev server pane to check for errors
4. Iterate until clean

## License

MIT
