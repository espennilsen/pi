---
name: obsidian-vault
description: Read, create, and update notes in Espen's Obsidian vault (PARA method). Use when asked about notes, tasks, projects, dashboards, daily logs, or anything in the vault.
---

# Obsidian Vault Management

## Vault Location

```
/Users/espen/Library/CloudStorage/OneDrive-Espennilsen.net/2-Areas/Digital_Life/Obsidian/e9n
```

## ⚠️ Safety

**Always confirm with Espen before creating, modifying, or deleting any vault file.**

The vault has established automation (Dataview queries, Templater templates, dashboards). Breaking these patterns can cascade.

## Before Making Changes

1. Read the vault's own `AGENTS.md` for full context on structure, plugins, workflows, and conventions
2. Read the relevant `_Index.md` file for the section you're working in
3. Check the `🏷️ Tag Taxonomy.md` for correct tag usage

## Structure (PARA)

```
1. Projects/     — Active initiatives with deadlines
2. Areas/        — Ongoing responsibilities (Education, Finance, Health, Personal Dev, Romance)
3. Resources/    — Reference materials (AI, Books, Career, Homelab, Languages, Programming)
4. Archive/      — Completed or inactive items
Notes/           — Daily/Weekly/Monthly notes with habit tracking
Tasks/           — TaskNotes (one task per note)
Templates/       — 23+ Templater templates
Weekly Reviews/  — Periodic reflections
```

## Conventions

- **Frontmatter** is required on all notes: `created`, `modified`, `type`, `tags` at minimum
- **Tags** follow the taxonomy: `#project/active`, `#type/note`, `#status/active`, `#priority/high`, `#area/professional`
- **File naming**: Use descriptive names. TaskNotes use format: `Project - Task Description.md`
- **Templates**: Always use existing templates rather than creating notes from scratch. Check `Templates/` first.
- **Links**: Use `[[wiki-links]]` for internal references
- **Dataview**: Many notes contain Dataview queries. Don't break the query syntax when editing.

## Obsidian Local REST API

The vault has the **Local REST API** plugin (v3.4.3) running. Prefer this over direct filesystem access — it respects Obsidian's internal state, caches, and metadata.

```
Base URL: http://localhost:27223
API Key:  d4fc944e64f535df05b34c2e8596c4e3eaffc6dfd5b5ee15e76789a4ab96698a
Auth:     Authorization: Bearer <key>
```

### Common Operations

#### List files in a directory
```bash
curl -s "http://localhost:27223/vault/" -H "Authorization: Bearer $OBSIDIAN_API_KEY"
curl -s "http://localhost:27223/vault/1.%20Projects/" -H "Authorization: Bearer $OBSIDIAN_API_KEY"
```

#### Read a note (markdown)
```bash
curl -s "http://localhost:27223/vault/PATH.md" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY" \
  -H "Accept: text/markdown"
```

#### Read a note (JSON with metadata, tags, frontmatter)
```bash
curl -s "http://localhost:27223/vault/PATH.md" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY" \
  -H "Accept: application/vnd.olrapi.note+json"
```

#### Simple text search (⚠️ POST, not GET)
```bash
curl -s -X POST "http://localhost:27223/search/simple/?query=TERM&contextLength=100" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY"
```
Returns: `[{ filename, score, matches: [{ match: {start, end}, context }] }]`

#### Dataview DQL search (POST)
```bash
curl -s -X POST "http://localhost:27223/search/" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY" \
  -H "Content-Type: application/vnd.olrapi.dataview.dql+txt" \
  -d 'TABLE file.ctime AS "Created" FROM "1. Projects" WHERE status = "active" LIMIT 10'
```

#### JsonLogic search (POST) — find by frontmatter/tags
```bash
# Find notes with a specific tag
curl -s -X POST "http://localhost:27223/search/" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY" \
  -H "Content-Type: application/vnd.olrapi.jsonlogic+json" \
  -d '{"in": ["project/active", {"var": "tags"}]}'
```

#### Create or update a note (PUT)
```bash
curl -s -X PUT "http://localhost:27223/vault/PATH.md" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY" \
  -H "Content-Type: text/markdown" \
  -d '---
created: 2026-02-09
type: note
tags: [type/note]
---
# Title

Content here'
```

#### Append to a note (POST)
```bash
curl -s -X POST "http://localhost:27223/vault/PATH.md" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY" \
  -H "Content-Type: text/markdown" \
  -d 'Content to append'
```

#### Patch a note (PATCH) — insert relative to heading/block/frontmatter
```bash
curl -s -X PATCH "http://localhost:27223/vault/PATH.md" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY" \
  -H "Content-Type: text/markdown" \
  -H "Operation: append" \
  -H "Target-Type: heading" \
  -H "Target: Heading 1::Subheading" \
  -d 'New content under this heading'
```

#### Delete a note
```bash
curl -s -X DELETE "http://localhost:27223/vault/PATH.md" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY"
```

#### Get periodic notes (daily/weekly/monthly)
```bash
# Current daily note
curl -s "http://localhost:27223/periodic/daily/" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY" \
  -H "Accept: text/markdown"

# Specific date
curl -s "http://localhost:27223/periodic/daily/2026/2/9/" \
  -H "Authorization: Bearer $OBSIDIAN_API_KEY" \
  -H "Accept: text/markdown"
```

### Filesystem Fallback

If the REST API is down, fall back to direct file access:

```bash
VAULT="/Users/espen/Library/CloudStorage/OneDrive-Espennilsen.net/2-Areas/Digital_Life/Obsidian/e9n"

# Read a note
cat "$VAULT/PATH.md"

# Find by name
find "$VAULT" -name "*.md" | grep -i "search term"

# Find by content
grep -rl "search term" "$VAULT" --include="*.md"

# Recent daily notes
ls -lt "$VAULT/Notes/Daily/" | head -10
```
