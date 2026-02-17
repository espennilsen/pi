---
name: pi-webnav
description: Unified navigation shell for pi-webserver — wraps all mounts in a persistent top-nav + iframe layout
---

## Overview

Navigation shell extension. Mounts at the root path (`/`) of pi-webserver and serves a single-page HTML application that discovers all registered mounts and presents them as nav buttons loading content in an iframe.

**Stack:** TypeScript · pi-webserver event bus · Vanilla JS (nav.html)

## Architecture

- `src/index.ts` — Full extension logic (small). Reads `nav.html` at module load via `fs.readFileSync`. Registers `mountNav()` on both `web:ready` and `session_start`. Emits `web:unmount` on `session_shutdown`.
- `src/logger.ts` — Thin log helper emitting to `log` event with channel `"webnav"`.
- `nav.html` — Self-contained navigation shell (vanilla JS + inline CSS). Fetches mount list from `/_api/mounts/dashboard`, renders nav buttons, routes to iframes. No build step — edit the file directly.

## Mount Config

```ts
{
  name: "webnav",
  label: "Navigation",
  description: "Unified navigation shell",
  prefix: "/",
  handler: (_req, res, subPath) => { /* serves nav.html at "/" only; 404 for subpaths */ }
}
```

The prefix `/` wins over the default webserver root. Pi-webserver's **longest-prefix matching** ensures all other mounts (e.g. `/dashboard`, `/tasks`) still take priority over the webnav root handler.

## nav.html Behaviour

- Fetches `/_api/mounts/dashboard` to discover registered mounts
- Renders each mount as a nav button in a top bar
- Loads the selected mount's `prefix` in an `<iframe>` below
- Hash-based routing: URL becomes `/#/dashboard`, `/#/tasks`, etc. for bookmarkability
- Highlights the active nav button based on current iframe path
- Periodically refreshes the mount list to pick up runtime changes
- Falls back gracefully: each mount still works standalone at its own URL

## Integration Points

| Extension | Integration | Mechanism |
|-----------|------------|-----------|
| **pi-webserver** | Root page mount | `web:mount` (prefix `/`), `web:unmount`, `web:ready` |
| **pi-logger** | Structured logging | `log` event |

## Key Patterns

- **Root mount override** — Mounts at `prefix: "/"`. Requires pi-webserver's root mount override support.
- **No API mount** — Page only; no `web:mount-api`. The nav shell reads the existing `/_api/mounts/dashboard` endpoint from pi-webserver directly.
- **Idempotent mounting** — `mount()` is called on both `web:ready` and `session_start` to handle whichever starts first.
- **HTML from disk** — `nav.html` read once at import time. Modify `nav.html` for all UI changes; no TypeScript rebuild needed.
