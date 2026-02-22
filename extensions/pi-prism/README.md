# @e9n/pi-prism

Configurable widget sidebar overlay for [pi](https://github.com/espennilsen/pi) — an operational dashboard in the TUI.

## Features

- **Right-anchored overlay** — 34% width sidebar with scrollable widget stack
- **14 built-in widgets** — tasks, calendar, git, finance, CRM, system health, and more
- **Configurable** — choose and order widgets via settings
- **Auto-refresh** — widgets update every 60s, manual refresh with `r`
- **Keyboard-driven** — `j/k` scroll, `q/Esc` close, `r` refresh

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-prism": {
    "widgets": ["active-task", "today-calendar", "git-status", "accounts"],
    "autoOpen": true
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `widgets` | `["active-task", "today-calendar", "recent-ops", "accounts"]` | Widget IDs to display (order matters) |
| `autoOpen` | `true` | Auto-open sidebar on session start |

## Usage

- **Command:** `/prism` — toggle the sidebar
- **Shortcut:** `Ctrl+Shift+P` — toggle the sidebar
- Auto-opens on session start (configurable)

## Available Widgets

| ID | Icon | Description |
|----|------|-------------|
| `active-task` | 🎯 | Current td task status |
| `task-queue` | 📋 | Open td tasks (top 6) |
| `git-status` | 🔀 | Branch, staged/modified/untracked counts |
| `today-calendar` | 📅 | Today's calendar events |
| `week-calendar` | 🗓️ | This week's calendar events |
| `recent-ops` | ⚡ | Last 8 tool calls with status |
| `system-health` | 🟢 | DB, memory, git, tasks health checks |
| `accounts` | 💳 | Finance account balances |
| `budget-bars` | 📊 | Monthly budget progress bars |
| `recent-txns` | 💸 | Last 5 transactions |
| `reminders` | 🔔 | Upcoming CRM reminders (14 days) |
| `recent-contacts` | 👥 | Recently contacted people |
| `session-stats` | ⏱ | Session uptime, model, daily cost |
| `clock` | 🕐 | Big digit clock with date |

## Requirements

Widgets that query the database require [pi-kysely](https://www.npmjs.com/package/@e9n/pi-kysely) to be loaded. Widgets gracefully degrade if their data source is unavailable.

## License

MIT
