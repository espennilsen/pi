---
name: pi-td-hub
description: Cross-project task aggregator — reads td databases across ~/Dev for PM coordination
---

## Overview

Read-only pi extension that discovers all td databases (`.todos/issues.db`) across a configurable root directory and provides a single `td_hub` tool for cross-project task visibility. Designed for PM-level orchestration (Fury agent).

## Architecture

Single-file extension (`index.ts`) with no persistent state. Opens each SQLite database read-only for every query — no connection pooling, no caching, no writes.

### Key Design Decisions

- **Read-only**: Never modifies any project's database
- **No caching**: Fresh reads every time — databases are small, SQLite is fast
- **Fail-safe**: If a database is locked or corrupt, it's silently skipped
- **Discovery**: Walks `root/*/.todos/issues.db` up to `maxDepth` levels

## Configuration

```json
{
  "pi-td-hub": {
    "root": "~/Dev",
    "maxDepth": 3
  }
}
```

## Tool: `td_hub`

| Action | Description |
|--------|-------------|
| `projects` | List all repos with td databases + open task counts |
| `status` | Cross-project summary: tasks by status, priority, type, age |
| `pipeline` | Group tasks by `pipeline:*` labels |
| `query` | Filter by status, priority, type, labels, project |
| `search` | Full-text search across titles, descriptions, IDs |

## Database Schema

The `issues` table has: `id, title, description, status, type, priority, points, labels, parent_id, sprint, minor, created_branch, created_at, updated_at, closed_at, deleted_at`.

Pipeline stages are encoded as labels: `pipeline:queued`, `pipeline:planning`, `pipeline:building`, `pipeline:reviewing`, `pipeline:pr-ready`, `pipeline:approved`.
