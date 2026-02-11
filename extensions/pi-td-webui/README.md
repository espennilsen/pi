# pi-td-webui

Standalone td task dashboard for pi, served via the shared [`pi-webserver`](https://github.com/espennilsen/pi-webserver) extension.

## Features

- `/tasks` web UI (board, table, tree)
- `/api/td/*` endpoints for td CRUD, review flows, activity logs
- Cross-project view (configurable root in `settings.json`)

## Requirements

- `td` CLI in `$PATH`
- `pi-webserver` extension installed and running (`/web`)

## Install

```bash
pi install git@github.com:espennilsen/pi-td-webui.git
pi install git@github.com:espennilsen/pi-webserver.git
```

## Usage

Start the shared server:

```bash
/web
```

Open the dashboard:

```
http://localhost:4100/tasks
```

API endpoints are mounted under `/api/td` and inherit `pi-webserver` API token auth.

## Development

```bash
npm install
npm run typecheck
```

## Settings

Cross-project mode is disabled unless you set a root directory in pi settings.
Add this to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "tdWebui": {
    "crossProjectRoot": "~/Dev",
    "crossProjectDepth": 1
  }
}
```

- `crossProjectRoot`: root directory to scan for `.todos/issues.db`.
- `crossProjectDepth`: how many directory levels below the root to scan (default: `1`).

## Notes

- The UI HTML is bundled at `src/tasks.html` with inline CSS/JS.
