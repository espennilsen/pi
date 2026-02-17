# @e9n/pi-projects

Project tracking dashboard extension for [pi](https://github.com/mariozechner/pi-coding-agent). Auto-discovers git repos in `~/Dev`, shows live git status, and provides a web dashboard.

## Features

- **Auto-discovery** — scans a configurable root directory for git repos on session start
- **Git status** — branch name, dirty file count, ahead/behind remote
- **Hide/unhide** — suppress specific projects from results
- **Multiple sources** — scan additional directories via `sources` action
- **Web dashboard** — live project overview at `/projects` via pi-webserver
- **`/projects` command** — quick status summary in the TUI
- **Bundled skill** — includes a `git-project-status` skill for detailed reports

## Setup

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-projects": {
    "devDir": "~/Dev"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `devDir` | `"~/Dev"` | Root directory to scan for git repos |
| `dbPath` | `"projects/projects.db"` | SQLite path for scan config and hidden projects (relative to agent dir) |
| `useKysely` | `false` | Use shared pi-kysely DB instead of local SQLite |

## Tool: `projects`

Discover and manage git projects on disk.

### Actions

| Action | Description |
|--------|-------------|
| `list` | List all discovered projects with git status |
| `scan` | Re-scan the dev directory and refresh project list |
| `hide` | Hide a project from results (pass `id`) |
| `unhide` | Unhide a previously hidden project (pass `id`) |
| `sources` | List configured scan source directories |

### Key Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | Action to perform (required) |
| `id` | number | Project ID for `hide` / `unhide` |
| `query` | string | Filter projects by name (for `list`) |

## Commands

| Command | Description |
|---------|-------------|
| `/projects [search]` | Show project count, git repos, dirty status — optionally filter by name |

## Web UI

The dashboard auto-mounts at `/projects` when [pi-webserver](https://github.com/espennilsen/pi) is installed, showing live git status for all discovered repos.

## Install

```bash
pi install npm:@e9n/pi-projects
```

## License

MIT
