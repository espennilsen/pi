# pi-calendar

Calendar tool, web dashboard, and reminders for [pi](https://github.com/nicholasgasior/pi-coding-agent).

## Features

- **Tool** — `calendar` with actions: `list`, `create`, `update`, `delete`, `today`, `upcoming`
- **Web UI** — Weekly calendar view at `/calendar` with create/edit modal, color-coded events, now-line, and recurrence support
- **REST API** — JSON CRUD at `/api/calendar`
- **Reminders** — 60-second interval checks for upcoming events; sends notifications via [pi-channels](https://github.com/espennilsen/pi-channels) event bus
- **Recurrence** — Daily, weekly, biweekly, monthly with optional end date

## Installation

```bash
# In your pi project
npm install pi-calendar
```

Or add to `package.json` as a local dependency:

```json
{
  "dependencies": {
    "pi-calendar": "file:../pi/extensions/pi-calendar"
  }
}
```

## Configuration

No configuration needed — data is stored automatically at `~/.pi/agent/db/calendar.db`.

## Architecture

```
src/
├── index.ts          # Extension entry — lifecycle, tool + web registration
├── types.ts          # CalendarEvent, CreateEventInput, UpdateEventInput
├── db.ts             # SQLite DB with migrations and prepared statements
├── tool.ts           # LLM tool (list, create, update, delete, today, upcoming)
├── reminders.ts      # Interval-based reminder checker + pi-channels notify
├── web.ts            # Web page + API routes via pi-webserver event bus
└── ui/
    ├── calendar.html # HTML template ({{CSS}} and {{JS}} placeholders)
    ├── calendar.css  # Dark theme styles
    └── calendar.js   # Client-side calendar rendering and modal logic
```

## Integrations

| Extension | Event | Purpose |
|-----------|-------|---------|
| pi-webserver | `web:mount`, `web:mount-api`, `web:ready` | Serve web UI and API |
| pi-channels | `channel:send` | Send reminder notifications |

## API

### Tool actions

| Action | Required params | Description |
|--------|----------------|-------------|
| `list` | `range_start`, `range_end` | Events in date range |
| `today` | — | Today's events |
| `upcoming` | `days` (default: 7) | Events in next N days |
| `create` | `title`, `start_time`, `end_time` | Create event |
| `update` | `id` + fields to change | Update event |
| `delete` | `id` | Delete event |

### REST API

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/calendar?start=&end=` | — | List events |
| POST | `/api/calendar` | `{ title, start_time, end_time, ... }` | Create |
| PATCH | `/api/calendar` | `{ id, ...updates }` | Update |
| DELETE | `/api/calendar` | `{ id }` | Delete |

## License

MIT
