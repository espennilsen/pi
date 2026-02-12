---
name: pi-memory
description: Persistent memory extension for pi — long-term facts, daily logs, and search
---

## Overview

File-based persistent memory system. Plain Markdown, no database.

**Stack:** TypeScript · pi SDK

## Architecture

- `src/index.ts` — Entry point. Registers tools, context injection, resolves settings.
- `src/files.ts` — File I/O, path resolution, date helpers. All fs operations live here.
- `src/tools.ts` — Three LLM tools: memory_read, memory_write, memory_search.
- `src/context.ts` — `before_agent_start` hook that injects MEMORY.md + recent daily logs into system prompt.
- `src/settings.ts` — Reads `"pi-memory"` key from global/project settings.json.
- `skills/pi-memory/SKILL.md` — Agent-facing instructions for when/how to use memory.

## Key Patterns

- **No database** — plain Markdown files. MEMORY.md is the brain, daily logs are append-only.
- **Section-based editing** — `memory_write target=long_term section="X"` replaces content under `## X`.
- **System prompt injection** — injects full MEMORY.md + yesterday + today on every `before_agent_start`.
- **Configurable base path** — settings.json `"pi-memory": { "path": "..." }`, defaults to cwd.

## Conventions

- No console.log — use tools or remove.
- All file operations go through `files.ts` — never direct fs calls in tools/context.
