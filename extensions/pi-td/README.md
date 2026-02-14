# pi-td

td task management extension for pi. Optionally serves a web dashboard via [`pi-webserver`](https://github.com/espennilsen/pi-webserver).

## Features

- `/tasks` web UI (board, table, tree) — toggle with `webui` setting
- `/api/td/*` endpoints for td CRUD, review flows, activity logs
- Cross-project view (configurable root in `settings.json`)

## Requirements

- `td` CLI in `$PATH`
- `pi-webserver` extension installed and running (`/web`) — only needed if `webui` is enabled

## Install

```bash
pi install git@github.com:espennilsen/pi-td.git
```

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

- `webui`: enable/disable the web dashboard (default: `true`)
- `crossProjectRoot`: root directory to scan for `.todos/issues.db`
- `crossProjectDepth`: how many directory levels below the root to scan (default: `1`)

Legacy `tdWebui` settings key is still supported for backwards compatibility.

## Usage

Start the shared server (if webui enabled):

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

## Notes

- The UI HTML is bundled at `src/tasks.html` with inline CSS/JS.
