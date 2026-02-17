# @e9n/pi-calendar

Calendar tool, web dashboard, and reminders for [pi](https://github.com/espennilsen/pi).

## Features

- **`calendar` tool** — list, create, update, delete, today, upcoming (recurring events fully expanded)
- **Web UI** — weekly calendar view at `/calendar` with drag-to-create, color-coded events, and recurrence support
- **REST API** — JSON CRUD at `/api/calendar`
- **Reminders** — checks for upcoming events every 60 s; sends notifications via [pi-channels](https://www.npmjs.com/package/@e9n/pi-channels)
- **Recurrence** — daily, weekly, biweekly, monthly, yearly with custom intervals, day/position selection, end conditions, exclusions, and per-occurrence overrides

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-calendar": {
    "dbPath": "db/calendar.db",
    "useKysely": false
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `db/calendar.db` | SQLite file path (relative to agent dir, or absolute) |
| `useKysely` | `false` | Use shared DB via pi-kysely instead of local SQLite |

## Tool: `calendar`

| Action | Required params | Description |
|--------|----------------|-------------|
| `list` | `range_start`, `range_end` | Events in a date range (recurring events expanded) |
| `today` | — | Today's events |
| `upcoming` | `days` (default: 7) | Events in the next N days |
| `create` | `title`, `start_time`, `end_time` | Create an event; optional: `recurrence`, `recurrence_rule` |
| `update` | `id` + fields to change | Update an existing event |
| `delete` | `id` | Delete an event |

## Web UI

Served at `/calendar` (requires [pi-webserver](https://www.npmjs.com/package/@e9n/pi-webserver)). REST API at `/api/calendar`.

## Install

```bash
pi install npm:@e9n/pi-calendar
```

## License

MIT
