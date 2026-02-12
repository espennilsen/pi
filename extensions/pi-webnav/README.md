# pi-webnav

Unified navigation shell for [pi-webserver](../pi-webserver). Replaces the default dashboard with a persistent top nav bar + iframe layout.

## How it works

1. Mounts at `/` via pi-webserver's mount system
2. Discovers available mounts from `/_api/mounts/dashboard`
3. Renders a nav bar with buttons for each mount
4. Loads mount content in an iframe below the nav
5. Uses hash-based routing (`#/tasks`, `#/calendar`) for bookmarks

Each mount page becomes a clean content frame — no per-page navbar duplication needed.

## Features

- **Auto-discovery** — picks up any mount registered with pi-webserver
- **Deep linking** — hash updates as you navigate within a mount
- **Active state** — highlights the current nav button
- **Home view** — shows mount cards when no section is selected (click the "pi" brand)
- **Live refresh** — periodically checks for new/removed mounts
- **Graceful fallback** — each mount still works standalone at its original URL

## Requirements

- pi-webserver >= 0.1.0 with root mount override support (dashboard moved after mount matching)

## Installation

Place in `~/.pi/agent/extensions/pi-webnav/`. Auto-discovered by pi.

## Usage

Start the web server with `/web` in the TUI. The nav shell replaces the default dashboard at `http://localhost:4100/`.
