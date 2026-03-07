# @e9n/pi-td

Task management extension for [pi](https://github.com/badlogic/pi-mono) — structured `td` tool with mandatory workflow enforcement and an optional web dashboard.

## Features

- **`td` tool** — full task lifecycle: create, start, log, handoff, review, approve/reject, close, block/unblock
- **Workflow enforcement** — system prompt injection ensures every code change has a task and a feature branch
- **Web dashboard** at `/tasks` — board, table, and tree views (requires [pi-webserver](../pi-webserver))
- **Cross-project view** — scan multiple repos under a root directory
- **REST API** at `/api/td/*` — CRUD, review flows, and activity logs

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-td": {
    "webui": true,
    "crossProjectRoot": "~/Dev",
    "crossProjectDepth": 1
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `webui` | `boolean` | `true` | Enable the web dashboard |
| `crossProjectRoot` | `string` | — | Root directory to scan for `.todos/` databases |
| `crossProjectDepth` | `number` | `1` | Subdirectory scan depth |

## Tool: `td`

### Query actions

| Action | Required params | Description |
|--------|----------------|-------------|
| `status` | — | Current session and task summary |
| `list` | — | List open issues (filterable by type/priority/status) |
| `show` | `id` | Show full issue detail |
| `ready` | — | Issues ready to start |
| `next` | — | Best next issue to work on |
| `reviewable` | — | Issues awaiting review |

### Lifecycle actions

| Action | Required params | Description |
|--------|----------------|-------------|
| `create` | `title` | Create a task (`type`, `priority`, `description`, `labels`, `parent`, `minor`) |
| `start` | `id` | Mark in-progress |
| `log` | `message` | Add a progress log entry (`log_type`: progress/blocker/decision/hypothesis/tried/result) |
| `handoff` | `id` | Record handoff (`done`, `remaining`, `decisions`, `uncertain`) |
| `review` | `id` | Submit for review |
| `approve` | `id` | Approve and close |
| `reject` | `id`, `reason` | Reject with reason |
| `close` | `id` | Close task |

### Other actions

| Action | Required params | Description |
|--------|----------------|-------------|
| `block` | `id` | Mark as blocked |
| `unblock` | `id` | Remove blocked status |
| `reopen` | `id` | Reopen a closed issue |
| `comment` | `id`, `message` | Add a comment |

## Web UI

Enable `webui: true` in settings, start the web server with `/web`, then open `http://localhost:4100/tasks`.

## Requirements

- [`td` CLI](https://github.com/marcus/td) in `$PATH` — a local-first task management CLI for AI-assisted development workflows
- [`pi-webserver`](../pi-webserver) extension (only needed for web UI)

### Installing td

```bash
# With Go installed:
go install github.com/marcus/td@latest

# Verify:
td --version
```

## Install

```bash
pi install npm:@e9n/pi-td
```

## License

MIT
