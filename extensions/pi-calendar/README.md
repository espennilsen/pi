# pi-calendar

Calendar tool, web dashboard, and reminders for [pi](https://github.com/nicholasgasior/pi-coding-agent).

## Features

- **Tool** — `calendar` with actions: `list`, `create`, `update`, `delete`, `today`, `upcoming`
- **Web UI** — Weekly calendar view at `/calendar` with create/edit modal, color-coded events, now-line, and full recurrence support
- **REST API** — JSON CRUD at `/api/calendar`
- **Reminders** — 60-second interval checks for upcoming events; sends notifications via [pi-channels](https://github.com/espennilsen/pi-channels) event bus
- **Advanced recurrence** — Daily, weekly, biweekly, monthly, yearly with custom intervals, day/position selection, end conditions, exclusions, and per-occurrence overrides

## Recurrence

### Frequency Types

| Type | Description |
|------|-------------|
| Daily | Every N days |
| Weekly | Every N weeks on selected days (Mon–Sun) |
| Biweekly | Every 2 weeks (shorthand for weekly with interval 2) |
| Monthly | Every N months by day-of-month or week position |
| Yearly | Every N years by month+day or week position |

### Weekly Options

- Select specific days of the week (Mon, Tue, Wed, Thu, Fri, Sat, Sun)
- Multi-day selection (e.g., every Mon, Wed, Fri)
- Configurable interval (e.g., every 2nd week on Mon and Thu)

### Monthly Options

- **By day of month** — e.g., the 15th of every month
- **By week position + weekday** — e.g., "2nd Tuesday", "last Friday", "1st and 3rd Monday"
- Multiple week position selections (1st, 2nd, 3rd, 4th, Last)
- Configurable month interval (e.g., every 3 months)

### Yearly Options

- **By month + day** — e.g., March 15th every year
- **By week position + weekday + month** — e.g., "3rd Thursday of November"
- Configurable year interval

### End Conditions

| Condition | Description |
|-----------|-------------|
| Never | Infinite recurrence |
| After N | Stop after N occurrences |
| Until date | Stop on a specific date |

### Exclusions & Overrides

- **Exclusions** — Skip specific dates from a recurring series
- **Overrides** — Modify individual occurrences with different time, title, or description

### Recurrence Rule JSON

The `recurrence_rule` field stores a JSON object with these optional fields:

```json
{
  "interval": 2,
  "daysOfWeek": [1, 3, 5],
  "byType": "weekPosition",
  "dayOfMonth": 15,
  "weekPositions": [2, -1],
  "weekday": 2,
  "month": 11,
  "endType": "count",
  "count": 10,
  "endDate": "2026-12-31",
  "exclusions": ["2026-03-15", "2026-06-15"],
  "overrides": {
    "2026-04-15": {
      "start_time": "2026-04-15T10:00:00Z",
      "title": "Modified occurrence"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `interval` | number | Repeat every N periods (default: 1) |
| `daysOfWeek` | number[] | Days for weekly: 0=Sun, 1=Mon, …, 6=Sat |
| `byType` | string | `"dayOfMonth"` or `"weekPosition"` for monthly/yearly |
| `dayOfMonth` | number | Day 1–31 for dayOfMonth mode |
| `weekPositions` | number[] | Week positions: 1–4 or -1 (last) |
| `weekday` | number | Weekday 0–6 for weekPosition mode |
| `month` | number | Target month 1–12 for yearly |
| `endType` | string | `"never"`, `"count"`, or `"date"` |
| `count` | number | Occurrence limit (endType=count) |
| `endDate` | string | End date YYYY-MM-DD (endType=date) |
| `exclusions` | string[] | Dates to skip (YYYY-MM-DD) |
| `overrides` | object | Per-date overrides: `{ start_time?, end_time?, title?, description? }` |

**Examples:**

```
Every 3 days:                recurrence="daily",  recurrence_rule={"interval":3}
Mon/Wed/Fri weekly:          recurrence="weekly",  recurrence_rule={"daysOfWeek":[1,3,5]}
Every 2 weeks on Mon & Thu:  recurrence="weekly",  recurrence_rule={"interval":2,"daysOfWeek":[1,4]}
2nd Tuesday monthly:         recurrence="monthly", recurrence_rule={"byType":"weekPosition","weekPositions":[2],"weekday":2}
1st & 3rd Monday monthly:    recurrence="monthly", recurrence_rule={"byType":"weekPosition","weekPositions":[1,3],"weekday":1}
Last Friday every 3 months:  recurrence="monthly", recurrence_rule={"interval":3,"byType":"weekPosition","weekPositions":[-1],"weekday":5}
March 15th yearly:           recurrence="yearly",  recurrence_rule={"month":3,"dayOfMonth":15}
3rd Thu of Nov yearly:       recurrence="yearly",  recurrence_rule={"month":11,"byType":"weekPosition","weekPositions":[3],"weekday":4}
After 10 occurrences:        recurrence_rule={"endType":"count","count":10}
```

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
├── types.ts          # CalendarEvent, RecurrenceRule, input interfaces
├── recurrence.ts     # Recurrence expansion engine (shared by reminders + tool)
├── db.ts             # SQLite DB with migrations and prepared statements
├── tool.ts           # LLM tool (list, create, update, delete, today, upcoming)
├── reminders.ts      # Interval-based reminder checker + pi-channels notify
├── web.ts            # Web page + API routes via pi-webserver event bus
└── ui/
    ├── calendar.html # HTML template ({{CSS}} and {{JS}} placeholders)
    ├── calendar.css  # Dark theme styles
    └── calendar.js   # Client-side calendar rendering, recurrence expansion, and modal logic
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
| `list` | `range_start`, `range_end` | Events in date range (recurring events expanded) |
| `today` | — | Today's events (recurring events expanded) |
| `upcoming` | `days` (default: 7) | Events in next N days (recurring events expanded) |
| `create` | `title`, `start_time`, `end_time` | Create event with optional `recurrence` + `recurrence_rule` |
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
