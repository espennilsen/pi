---
name: pi-todoist
description: Todoist task management integration for Pi — manage tasks, projects, sections, labels, and comments
---

## Overview

`pi-todoist` provides comprehensive Todoist integration for Pi agents. Manage tasks, projects, sections, labels, and comments using natural language through the Todoist REST API.

## Configuration

Add your Todoist API token to `settings.json`:

```json
{
  "pi-todoist": {
    "apiToken": "your_todoist_api_token_here"
  }
}
```

Get your API token from: https://todoist.com/prefs/integrations (Developer tab)

## Available Tools

### `todoist_tasks`
Manage tasks — list, get, add, update, complete, reopen, delete, move, and search.

**Actions:**
- `list` — List tasks (filter by project, section, label, or use Todoist filter syntax)
- `get` — Get single task by ID
- `add` — Create new task (content, description, project, labels, priority, due date, duration)
- `update` — Update task fields
- `close` — Mark task as complete
- `reopen` — Reopen completed task
- `delete` — Delete task permanently
- `move` — Move task to different project/section/parent
- `search` — Search completed tasks by query

**Priority values:** 1 = normal, 2 = medium, 3 = high, 4 = urgent

### `todoist_projects`
Manage projects — list, get, add, update, delete, archive, and unarchive.

**Actions:**
- `list` — List all projects
- `get` — Get project by ID
- `add` — Create new project (name, color, parent, viewStyle, isFavorite)
- `update` — Update project fields
- `delete` — Delete project
- `archive` — Archive project
- `unarchive` — Unarchive project

### `todoist_sections`
Manage sections within projects.

**Actions:**
- `list` — List sections (optionally filter by project)
- `get` — Get section by ID
- `add` — Create section in project
- `update` — Update section name
- `delete` — Delete section

### `todoist_labels`
Manage labels for task organization.

**Actions:**
- `list` — List all labels
- `get` — Get label by ID
- `add` — Create new label (name, color, order, isFavorite)
- `update` — Update label fields
- `delete` — Delete label

### `todoist_comments`
Manage comments on tasks and projects.

**Actions:**
- `list` — List comments (requires taskId or projectId)
- `get` — Get comment by ID
- `add` — Add comment to task or project (with optional attachment)
- `update` — Update comment content
- `delete` — Delete comment

## Architecture

- **settings.ts** — Reads `apiToken` from `settings.json` under `pi-todoist` key
- **client.ts** — Wraps `TodoistApi` from `@doist/todoist-api-typescript` with init/reset/get/ready helpers
- **index.ts** — Main entry point; registers tools and handles lifecycle events
- **tools/** — One tool per file; each uses single `action` parameter pattern with string literal unions

All tools check client readiness before operations and return structured markdown responses. The SDK uses cursor-based pagination which is handled automatically for list operations.

## Example Usage

```typescript
// List today's high-priority tasks
todoist_tasks({ action: "list", filter: "today & p1" })

// Create a task with due date
todoist_tasks({
  action: "add",
  content: "Review PR #42",
  projectId: "2293453",
  priority: 3,
  dueString: "tomorrow"
})

// Complete a task
todoist_tasks({ action: "close", id: "7654321" })

// List projects
todoist_projects({ action: "list" })

// Add a comment to a task
todoist_comments({
  action: "add",
  taskId: "7654321",
  content: "Started working on this"
})
```

## Notes

- All SDK methods are async — operations use `await`
- Errors are caught and returned as friendly error messages
- No `console.log` — all output through structured tool responses
- Tool responses use markdown formatting for readability
- Priority numbering follows Todoist convention (1-4, not 0-3)
