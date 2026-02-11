# pi-memory

Persistent memory system for [pi](https://github.com/badlogic/pi-mono). Long-term facts and daily session logs stored as plain Markdown.

## Features

- **Long-term memory** — `MEMORY.md` with section-based editing for curated facts, preferences, and decisions
- **Daily logs** — `memory/YYYY-MM-DD.md` append-only files with timestamped entries
- **Full-text search** — Search across all memory files with context
- **System prompt injection** — Automatically loads MEMORY.md + recent daily logs into every agent turn
- **Skill included** — `pi-memory` skill with usage instructions, conventions, and housekeeping guidance

## Installation

```bash
pi install /path/to/pi-memory
```

Or add to `package.json`:

```json
{ "dependencies": { "pi-memory": "file:../pi/extensions/pi-memory" } }
```

## Configuration

Optional — defaults to cwd. Override via `settings.json`:

```json
{
  "pi-memory": {
    "path": "~/notes/memory"
  }
}
```

Settings are read from `~/.pi/agent/settings.json` (global) and `.pi/settings.json` (project), with project overriding global.

## Architecture

```
pi-memory/
├── src/
│   ├── index.ts      # Extension entry — registers tools + context injection
│   ├── files.ts      # File I/O, paths, date helpers
│   ├── tools.ts      # memory_read, memory_write, memory_search tools
│   ├── context.ts    # System prompt injection (before_agent_start)
│   └── settings.ts   # Settings loader (global + project settings.json)
├── skills/
│   └── pi-memory/
│       └── SKILL.md  # Usage instructions for the agent
├── package.json
└── README.md
```

## Tools

| Tool | Description |
|------|-------------|
| `memory_read` | Read MEMORY.md (`long_term`), a daily log (`daily` + optional `date`), or list files (`list`) |
| `memory_write` | Append to daily log (`daily`) or update/append to MEMORY.md (`long_term` + optional `section`) |
| `memory_search` | Search all memory files for a query string, returns matches with context |

## Memory Format

```
<base-path>/
├── MEMORY.md              # Curated long-term memory
│   ├── ## About User
│   ├── ## Preferences
│   ├── ## Active Focus
│   └── ## Decisions & Conventions
└── memory/
    ├── 2026-02-11.md      # Today's session notes
    ├── 2026-02-10.md      # Yesterday
    └── ...
```

### MEMORY.md

Organized into `## Sections`. The `memory_write` tool with `target: "long_term"` and a `section` parameter replaces the content of that section. Without `section`, content is appended to the end.

### Daily Logs

Each entry is auto-timestamped with `### HH:MM` headers. Append-only — entries are never edited, only added.

## License

MIT
