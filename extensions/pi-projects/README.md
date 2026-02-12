# pi-projects

Project tracking dashboard extension for [pi](https://github.com/badlogic/pi-mono). Auto-discovers git repos, shows git status, and provides a web dashboard.

## Install

```bash
pi install /path/to/pi-projects
```

## Features

- **Auto-discovery** — scans `~/Dev` (or custom directory) for git repos
- **Git status** — branch, dirty state, ahead/behind remote
- **`projects` tool** — LLM can list, scan, and query projects
- **Web dashboard** — at `/projects` via pi-webserver
- **`/projects` command** — quick status in TUI

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-projects": {
    "devDir": "~/Dev",
    "autoScan": true,
    "dbPath": "projects/projects.db"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `devDir` | `"~/Dev"` | Root directory to scan for git repos. |
| `autoScan` | `true` | Scan automatically on session start. |
| `dbPath` | `"projects/projects.db"` | SQLite path for scan directories and hidden projects (relative to agent dir). |

## Integrations

| Extension | Event | Purpose |
|-----------|-------|---------|
| pi-webserver | `web:mount`, `web:mount-api`, `web:ready` | Serve web UI and API |

## Architecture

```
src/
├── index.ts      # Extension entry — lifecycle, command, tool registration
├── settings.ts   # Settings loader
├── db.ts         # SQLite database for scan config and hidden projects
├── scanner.ts    # Git repo discovery and status scanning
├── tool.ts       # LLM tool (list, scan, manage projects)
└── web.ts        # Web dashboard + API routes via pi-webserver
```

## License

MIT
