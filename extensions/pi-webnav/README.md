# @e9n/pi-webnav

Unified navigation shell for [pi](https://github.com/mariozechner/pi-coding-agent) — wraps all pi-webserver mounts in a persistent nav bar with iframe routing.

## Features

- **Auto-discovery** — reads registered mounts from `/_api/mounts/dashboard`
- **Iframe layout** — each mount loads in a frame below the nav bar; no per-page nav duplication
- **Hash-based routing** — deep-linkable URLs (`#/tasks`, `#/calendar`) that survive refresh
- **Active state** — highlights the current nav button based on the iframe URL
- **Home view** — shows mount cards when no section is selected (click the "pi" brand)
- **Live refresh** — periodically polls for new or removed mounts at runtime
- **Graceful fallback** — each mount still works standalone at its own URL
- **Requires [pi-webserver](../pi-webserver) >= 0.1.0** with root mount override support

## Web UI

Mounts on pi-webserver at `/` (listens for `web:ready`):

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Navigation shell (`nav.html`) |

> Longest-prefix matching in pi-webserver ensures more specific mounts (e.g. `/tasks`) still win over the `/` catch-all.

## Install

```bash
pi install npm:@e9n/pi-webnav
```

## License

MIT
