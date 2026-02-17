# @e9n/pi-memory

Persistent memory system for [pi](https://github.com/mariozechner/pi-mono). Long-term facts and daily session logs stored as plain Markdown, automatically injected into every agent turn.

## Features

- **Long-term memory** — `MEMORY.md` with section-based editing for curated facts, preferences, and decisions
- **Daily logs** — `memory/YYYY-MM-DD.md` append-only files with auto-timestamped entries
- **Full-text search** — search across all memory files with surrounding context
- **System prompt injection** — `MEMORY.md` and recent daily logs are loaded before every agent turn
- **Skill included** — `pi-memory` skill with usage conventions and housekeeping guidance

## Setup / Settings

Optional — defaults to cwd. Override via `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project):

```json
{
  "pi-memory": {
    "path": "~/notes/memory"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `path` | cwd | Base directory for `MEMORY.md` and `memory/` daily logs. Supports `~`. |

### Memory layout

```
<path>/
├── MEMORY.md              # Curated long-term memory (## Section headers)
└── memory/
    ├── 2026-02-17.md      # Today's session notes
    ├── 2026-02-16.md
    └── ...
```

## Tools

### `memory_read`

Read from persistent memory.

| Parameter | Values | Description |
|-----------|--------|-------------|
| `target` | `long_term` \| `daily` \| `list` | What to read |
| `date` | `YYYY-MM-DD` (optional) | Date for `daily` target (defaults to today) |

- `long_term` — reads `MEMORY.md`
- `daily` — reads the daily log for the given date (defaults to today)
- `list` — lists all available daily log files

### `memory_write`

Write to persistent memory.

| Parameter | Values | Description |
|-----------|--------|-------------|
| `target` | `daily` \| `long_term` | Where to write |
| `content` | string | Content to write |
| `section` | string (optional) | For `long_term`: `## Section` header to find and replace. Omit to append to end. |

- `daily` — appends a `### HH:MM` timestamped entry to today's log
- `long_term` — replaces the named section in `MEMORY.md`, or appends a new section if not found

### `memory_search`

Search across all memory files.

| Parameter | Values | Description |
|-----------|--------|-------------|
| `query` | string | Case-insensitive search term |
| `limit` | number (optional) | Max results (default: 20) |

Returns matching lines with one line of surrounding context and the source file and line number.

## Install

```bash
pi install npm:@e9n/pi-memory
```

## License

MIT
