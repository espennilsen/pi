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
| `list` | — | List open issues (filterable by type/priority/status/labels/epic) |
| `show` | `id` | Show full issue detail |
| `ready` | — | Issues ready to start |
| `next` | — | Best next issue to work on |
| `reviewable` | — | Issues awaiting review |
| `search` | `query` | Full-text search across issues |

### Lifecycle actions

| Action | Required params | Description |
|--------|----------------|-------------|
| `create` | `title` | Create a task (`type`, `priority`, `description`, `labels`, `parent`, `minor`) |
| `start` | `id` | Mark in-progress |
| `log` | `message` | Add a progress log entry (`log_type`: progress/blocker/decision/hypothesis/tried/result) |
| `handoff` | `id` | Record handoff (`done`, `remaining`, `decisions`, `uncertain`) |
| `review` | `id` | Submit for review (`minor` to allow self-review) |
| `approve` | `id` | Approve and close (auto-creates review session if needed) |
| `reject` | `id` | Reject with optional `reason` (auto-creates review session if needed) |
| `close` | `id` | Close task (`self_close: true` to close own work) |

### Modify actions

| Action | Required params | Description |
|--------|----------------|-------------|
| `update` | `id` | Update task fields (`title`, `type`, `priority`, `description`, `labels`, `parent`) |
| `delete` | `id` | Soft-delete an issue |

### Focus actions

| Action | Required params | Description |
|--------|----------------|-------------|
| `focus` | `id` | Set current working issue (without starting) |
| `unfocus` | — | Clear focus |

### Other actions

| Action | Required params | Description |
|--------|----------------|-------------|
| `block` | `id` | Mark as blocked |
| `unblock` | `id` | Remove blocked status |
| `reopen` | `id` | Reopen a closed issue |
| `comment` | `id`, `message` | Add a comment |

### List/search filters

| Parameter | Description |
|-----------|-------------|
| `show_all` | Include closed issues |
| `filter_type` | Filter by issue type |
| `filter_priority` | Filter by priority |
| `filter_status` | Filter by status |
| `filter_labels` | Filter by labels (comma-separated) |
| `filter_mine` | Show only issues assigned to current session |
| `filter_epic` | Filter by parent epic ID |
| `sort` | Sort by field (e.g. priority, created, updated) |
| `limit` | Max number of results |
| `query` | Search text (for `search` action, or `--search` filter for `list`) |

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
