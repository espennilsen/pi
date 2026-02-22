---
name: pi-prism
description: Configurable widget sidebar overlay for pi — operational dashboard in the TUI
---

## Overview

TUI sidebar extension that renders a right-anchored overlay with configurable widgets.
No database of its own — queries other extensions' tables via pi-kysely event bus (read-only).

**Stack:** TypeScript · pi-tui overlay API · pi-kysely event bus

## Architecture

- `src/index.ts` — Extension entry point. Registers `/prism` command, `Ctrl+Shift+P` shortcut, auto-opens on session start.
- `src/settings.ts` — Loads `pi-prism` settings from `.pi/settings.json` (widget list, autoOpen).
- `src/helpers.ts` — Shared utilities: DB query helper (via kysely event bus), CLI exec, format helpers (money, date, time, progress bars).
- `src/sidebar.ts` — `WidgetSidebar` class — the main TUI overlay component. Handles rendering, scrolling, refresh, keyboard input.
- `src/widgets/index.ts` — Widget interface, registry, and default widget list.
- `src/widgets/*.ts` — Individual widget implementations (one file per widget).

## Key Patterns

- **Read-only DB access** — requests `kysely:grant` with `select` only. Never writes data.
- **Graceful degradation** — each widget catches errors silently. Missing data shows "no data" message.
- **No direct extension imports** — all data access via pi-kysely event bus queries.
- **Overlay API** — uses `ctx.ui.custom()` with `overlay: true` and `overlayOptions` for right-anchored sidebar.
- **Cached rendering** — sidebar caches rendered output and only re-renders on state changes (version counter pattern).
