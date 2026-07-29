---
name: pi-calendar
description: Calendar extension for pi — tool, web UI, API, and reminders
---

## Overview

Self-contained pi extension providing a calendar with recurring events and reminders.

**Stack:** TypeScript · better-sqlite3 · pi SDK event bus

## Architecture

- `index.ts` — Extension entry point. Registers tool, mounts web routes, starts reminders.
- `types.ts` — CalendarEvent, RecurrenceRule, CreateEventInput, UpdateEventInput interfaces.
- `recurrence.ts` — Recurrence expansion engine. Generates concrete occurrence dates from recurrence patterns within a time window. Used by reminders and tool.
- `db.ts` — SQLite database at `~/.pi/agent/db/calendar.db`. Migration system with prepared statements.
- `tool.ts` — LLM tool with actions: list, create, update, delete, today, upcoming. Expands recurring events for display.
- `web.ts` — Mounts `/calendar` page and `/api/calendar` REST endpoints via pi-webserver event bus.
- `reminders.ts` — 60s interval that checks for events with reminders, expands recurring occurrences, sends via pi-channels `channel:send`.
- `ui/` — Split frontend: `calendar.html` (template), `calendar.css` (styles), `calendar.js` (client logic). Composed at load time.

## Key Patterns

- **No direct imports** between extensions — all integration via event bus (`web:mount`, `web:mount-api`, `web:ready`, `channel:send`).
- **Self-contained SQLite** via better-sqlite3 (same pattern as pi-personal-crm).
- **Prepared statements** for all queries — fast and safe.
- **Reminder deduplication** — `calendar_reminders_sent` table prevents duplicate notifications.
- **Recurrence expansion** — Server-side (recurrence.ts) and client-side (calendar.js) expansion engines with identical logic.

## DB Schema

- `calendar_events` — id, title, description, start_time, end_time, all_day, color, recurrence, recurrence_rule (JSON), recurrence_end, reminder_minutes, created_at, updated_at
- `calendar_reminders_sent` — id, event_id, event_time, sent_at (UNIQUE on event_id + event_time)
- `calendar_module_versions` — migration tracking

## Recurrence System

### Frequency Types
- Daily, Weekly, Biweekly, Monthly, Yearly
- Custom interval via `recurrence_rule.interval` (e.g., every 3 days, every 2 weeks)

### RecurrenceRule JSON (stored in recurrence_rule column)
- `interval` — repeat every N periods
- `daysOfWeek` — [0-6] for weekly day selection
- `byType` — "dayOfMonth" | "weekPosition" for monthly/yearly
- `dayOfMonth` — 1-31 for specific day
- `weekPositions` — [1,2,3,4,-1] for week position selection
- `weekday` — 0-6 for weekPosition mode
- `month` — 1-12 for yearly target month
- `endType` — "never" | "count" | "date"
- `count` — occurrence limit for endType=count
- `endDate` — YYYY-MM-DD for endType=date
- `exclusions` — array of YYYY-MM-DD dates to skip
- `overrides` — object mapping YYYY-MM-DD to {start_time?, end_time?, title?, description?}

## Conventions

- No console.log — use logger or remove.
- Frontend split into css/js/html for maintainability. Composed via `{{CSS}}`/`{{JS}}` template placeholders.
