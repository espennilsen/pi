---
name: pi-calendar
description: Calendar extension for pi — tool, web UI, API, and reminders
---

## Overview

Self-contained pi extension providing a calendar with recurring events and reminders.

**Stack:** TypeScript · better-sqlite3 · pi SDK event bus

## Architecture

- `src/index.ts` — Extension entry point. Registers tool, mounts web routes, starts reminders.
- `src/types.ts` — CalendarEvent, CreateEventInput, UpdateEventInput interfaces.
- `src/db.ts` — SQLite database at `~/.pi/agent/calendar/calendar.db`. Migration system with prepared statements.
- `src/tool.ts` — LLM tool with actions: list, create, update, delete, today, upcoming.
- `src/web.ts` — Mounts `/calendar` page and `/api/calendar` REST endpoints via pi-webserver event bus.
- `src/reminders.ts` — 60s interval that checks for events with reminders, expands recurring occurrences, sends via pi-channels `channel:send`.
- `src/ui/` — Split frontend: `calendar.html` (template), `calendar.css` (styles), `calendar.js` (client logic). Composed at load time.

## Key Patterns

- **No direct imports** between extensions — all integration via event bus (`web:mount`, `web:mount-api`, `web:ready`, `channel:send`).
- **Self-contained SQLite** via better-sqlite3 (same pattern as pi-personal-crm).
- **Prepared statements** for all queries — fast and safe.
- **Reminder deduplication** — `calendar_reminders_sent` table prevents duplicate notifications.

## DB Schema

- `calendar_events` — id, title, description, start_time, end_time, all_day, color, recurrence, recurrence_end, reminder_minutes, created_at, updated_at
- `calendar_reminders_sent` — id, event_id, event_time, sent_at (UNIQUE on event_id + event_time)
- `calendar_module_versions` — migration tracking

## Conventions

- No console.log — use logger or remove.
- Frontend split into css/js/html for maintainability. Composed via `{{CSS}}`/`{{JS}}` template placeholders.
