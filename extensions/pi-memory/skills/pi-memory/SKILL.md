---
name: pi-memory
description: Manage persistent memory across sessions. Use when asked to remember, recall, forget, or review what was stored. Covers long-term facts (MEMORY.md), daily session logs, search, and memory housekeeping.
---

# pi-memory — Persistent Memory

A file-based memory system that persists knowledge across sessions using plain Markdown.

## Architecture

```
<base-path>/
├── MEMORY.md              # Long-term curated memory (facts, preferences, decisions)
└── memory/
    ├── 2026-02-11.md      # Daily log — append-only session notes
    ├── 2026-02-10.md
    └── ...
```

- **MEMORY.md** — The "brain". Organized into `## Sections`. Survives compaction. Editable in place.
- **memory/YYYY-MM-DD.md** — Daily append-only logs. Timestamped entries. One file per day.

The base path defaults to cwd. Override with settings.json:
```json
{ "pi-memory": { "path": "/path/to/memory/dir" } }
```

## Tools

### memory_read

Read memory contents.

| target | description |
|--------|-------------|
| `long_term` | Read full MEMORY.md |
| `daily` | Read a specific date's log (default: today). Pass `date: "YYYY-MM-DD"` for other dates. |
| `list` | List all available daily log files |

### memory_write

Write to memory.

| target | description |
|--------|-------------|
| `daily` | Append a timestamped entry to today's log. Used for session notes, progress, decisions. |
| `long_term` | Update MEMORY.md. Pass `section` to replace a specific `## Section`, or omit to append. |

**Long-term memory sections** — use `section` parameter to target:
```
memory_write target=long_term section="Preferences" content="- Prefers dark theme\n- Terminal-first tools"
```
This replaces the content under `## Preferences`. If the section doesn't exist, it's created.

**Daily log entries** — auto-timestamped:
```
memory_write target=daily content="Completed the auth refactor. Using JWT with RS256."
```
Creates `### HH:MM` entry in today's file.

### memory_search

Full-text search across MEMORY.md and all daily logs.

```
memory_search query="JWT" limit=10
```

Returns matching lines with ±1 line of context, grouped by file.

## When to Write Memory

### Always write to long-term memory when:
- User explicitly says "remember this", "save this", "note that..."
- You learn a new preference, convention, or decision
- A significant architectural or design choice is made
- You discover something about the user's workflow or environment

### Always write to daily log when:
- Starting or completing significant work
- Making key decisions during a task
- Encountering and resolving blockers
- At the end of a work session (summarize what was done + next steps)

### Section organization for MEMORY.md

Keep MEMORY.md well-organized with clear sections:

```markdown
# Long-Term Memory

## About [User]
- Key facts, role, location, interests

## Preferences
- Communication style, tool preferences, conventions

## Active Focus
- Current projects and priorities (update as they shift)

## Decisions & Conventions
- Coding conventions, workflow rules, architectural decisions

## People & Relationships
- Key contacts and collaborators

## Recurring Patterns
- Things frequently asked about or worked on
```

## Memory Hygiene

Periodically review and clean up memory:

1. **Deduplicate** — Check for repeated sections in MEMORY.md (use `memory_read target=long_term`)
2. **Archive stale info** — Remove outdated decisions or completed project references
3. **Consolidate daily logs** — Important patterns from daily logs should be promoted to MEMORY.md
4. **Keep sections focused** — Each `## Section` should have a clear purpose

## System Prompt Injection

At each agent turn, the extension automatically injects into the system prompt:
- Full MEMORY.md content
- Yesterday's daily log (if exists)
- Today's daily log (if exists)

This means the agent always has recent context without needing to call `memory_read`.
