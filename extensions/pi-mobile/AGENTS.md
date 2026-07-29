---
name: pi-mobile
description: PWA mobile app for Pi agents — mounts on pi-webserver at /mobile
---

## Overview

Pi extension that serves a mobile-first PWA at `/mobile`. Uses Preact + HTM from CDN (no build step). Dark mode by default, scrollable bottom tab navigation with 11 screens, installable as a home screen app.

## Architecture

```
pi-mobile/
├──
│   └── index.ts          # Extension entry — web:mount + web:mount-api + SSE broadcasting
├── public/
│   ├── app.html          # SPA shell — all 11 screens (Preact + HTM from esm.sh CDN)
│   ├── manifest.json     # PWA manifest (standalone, dark theme)
│   └── sw.js             # Service worker (app shell caching strategy)
├── package.json          # Pi extension metadata
├── tsconfig.json         # TypeScript strict mode, ES2022
└── README.md
```

## Extension Pattern

Follows the standard pi-webserver mount pattern:

- **`web:mount`** at `/mobile` — serves HTML, manifest.json, sw.js, screen modules
- **`web:mount-api`** at `/mobile` — API routes at `/api/mobile/*`
- **`web:ready`** listener — re-mounts if webserver starts late
- SPA fallback: all unknown sub-routes serve the app shell (client-side routing)
- SSE broadcast: agent events forwarded to all connected mobile clients

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mobile/health` | GET | Health check |
| `/api/mobile/status` | GET | Agent health, system info, tools, memory |
| `/api/mobile/chat/prompt` | POST | Submit prompt to agent |
| `/api/mobile/chat/events` | GET | SSE stream of agent events |
| `/api/mobile/td/issues` | GET/POST | List/create td issues |
| `/api/mobile/td/issues/:id` | GET/PATCH | Show/update issue |
| `/api/mobile/files/list` | GET | List directory contents |
| `/api/mobile/files/read` | GET | Read file content |
| `/api/mobile/cron/jobs` | GET | List cron jobs |
| `/api/mobile/cron/jobs/:name/toggle` | POST | Enable/disable job |
| `/api/mobile/cron/jobs/:name/run` | POST | Trigger manual run |
| `/api/mobile/skills` | GET | List registered tools |
| `/api/mobile/extensions` | GET | List extensions (grouped tools) |
| `/api/mobile/crm/contacts` | GET/POST | List/create contacts |
| `/api/mobile/calendar/events` | GET/POST | List/create events |
| `/api/mobile/logs/events` | GET | SSE stream of log events |

## Frontend Stack

- **Preact 10** + **HTM 3** — imported from `esm.sh` CDN, no build step
- **CSS Custom Properties** — theming via `--color-*` variables
- **Dark mode by default** — `#0a0a0f` background, indigo `#6366f1` accent
- **Mobile-first** — max-width 480px on mobile, 600px on desktop
- **Safe areas** — respects `env(safe-area-inset-*)` for notch/home indicator
- **Scrollable tab bar** — supports 11+ tabs without overflow

## Conventions

- All frontend in a single `public/app.html` — Preact components, CSS, no build step
- Static files in `public/` — loaded at import time via `fs.readFileSync`
- All API routes return JSON with consistent `{ error }` for errors
- SSE connections use keepalive pings (15s) and auto-reconnect on client
- CRM/Calendar/Cron APIs gracefully return empty lists when extensions not installed
- Path traversal prevention on Files API (resolves to cwd, rejects escapes)
- Tab screens are Preact components — one function per screen
- Error boundaries wrap each tab screen independently
- `td` commands proxied via `pi.exec()` with 15s timeout

## Screens

| Tab | Screen | Features |
|-----|--------|----------|
| 💬 Chat | Streaming conversation | SSE streaming, prompt submission, markdown rendering, typing indicators, auto-scroll |
| 📊 Status | Health dashboard | Agent health, uptime, Node/memory/heap stats, tool count, SSE connections |
| 📋 Tasks | td issue management | Issue list with status/priority filters, create/update via td CLI proxy |
| 📁 Files | Workspace browser | Directory listing, file viewer, breadcrumb navigation, path traversal prevention |
| 📜 Logs | Live log viewer | SSE log stream, level filters, pin-to-bottom, buffer limit (500), clear |
| ⏰ Cron | Job management | Job list, enable/disable toggle, manual run, schedule display |
| 🧠 Skills | Tool browser | Search/filter, tool descriptions |
| 👥 CRM | Contact management | Contact list with search, phone/email links |
| 📅 Calendar | Event management | Upcoming events list |
| 🧩 Extensions | Extension browser | Tools grouped by extension prefix, tool counts |
| ⚙️ Settings | Configuration | Agent URL, API key, connection test, theme, clear data |
