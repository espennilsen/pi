---
name: pi-projects
description: Track and manage projects with git status via dashboard and tool.
---

## Pi Projects Extension

Auto-discovers git repos and provides a tracking dashboard.

### Setup

Install the extension, then access:
- Web dashboard at `/projects` via pi-webserver
- `/projects` command for quick status
- `projects` tool for the LLM

### Configuration (settings.json)

```json
{
  "pi-projects": {
    "devDir": "~/Dev",
    "autoScan": true
  }
}
```

- **devDir**: Primary directory to scan for projects (default: ~/Dev)
- **autoScan**: Auto-discover repos on startup

### Tool Actions

- `projects list` — Show all projects with git status
- `projects scan` — Rescan directories
- `projects hide --path /path` — Hide a project from the dashboard
- `projects unhide --path /path` — Restore a hidden project
- `projects sources` — List scan directories
- `projects sources --path /new/dir` — Add a scan directory

### Web Dashboard Features

- Card and table views with search/filter/sort
- Git status: branch, last commit, dirty count, ahead/behind
- Manage modal: add scan directories, hide/show projects
