# @e9n/pi-todoist

Todoist task management integration for [pi](https://github.com/mariozechner/pi-coding-agent) — manage tasks, projects, sections, labels, and comments through natural language.

## Installation

```bash
npm install @e9n/pi-todoist
```

Or install in your pi agent home:

```bash
cd ~/.pi/agent/extensions
git clone <this-repo> pi-todoist
cd pi-todoist
npm install
```

## Configuration

Add your Todoist API token to `settings.json` (in your project root or `~/.pi/agent/`):

```json
{
  "pi-todoist": {
    "apiToken": "your_todoist_api_token_here"
  }
}
```

**Get your API token:**
1. Go to https://todoist.com/prefs/integrations
2. Click the "Developer" tab
3. Copy your API token

## Available Tools

### `todoist_tasks`
Manage tasks — list, get, add, update, complete, reopen, delete, move, and search.

**Example actions:**
```typescript
// List today's tasks
{ action: "list", filter: "today" }

// Create a high-priority task
{
  action: "add",
  content: "Review architecture docs",
  projectId: "2293453",
  priority: 3,
  dueString: "tomorrow at 2pm"
}

// Complete a task
{ action: "close", id: "7654321" }

// Search completed tasks
{ action: "search", query: "review" }
```

**Priority values:** 1 = normal, 2 = medium, 3 = high, 4 = urgent

### `todoist_projects`
Manage projects — list, get, add, update, delete, archive, and unarchive.

```typescript
// List all projects
{ action: "list" }

// Create a project
{ action: "add", name: "Q1 Goals", color: "blue", isFavorite: true }

// Archive a project
{ action: "archive", id: "2293453" }
```

### `todoist_sections`
Manage sections within projects.

```typescript
// List sections in a project
{ action: "list", projectId: "2293453" }

// Create a section
{ action: "add", name: "In Progress", projectId: "2293453" }
```

### `todoist_labels`
Manage labels for task organization.

```typescript
// List all labels
{ action: "list" }

// Create a label
{ action: "add", name: "urgent", color: "red", isFavorite: true }
```

### `todoist_comments`
Manage comments on tasks and projects.

```typescript
// List comments on a task
{ action: "list", taskId: "7654321" }

// Add a comment
{ action: "add", taskId: "7654321", content: "Started working on this" }
```

## Natural Language Usage

Once configured, you can use natural language with your pi agent:

- "What tasks do I have today?"
- "Add a task to review the PR tomorrow"
- "Mark task 7654321 as complete"
- "Show me all my projects"
- "Create a new project called Q1 Goals"
- "Add a comment to task 7654321: almost done"

## Features

- ✅ Full Todoist REST API v1 integration
- ✅ Tasks, projects, sections, labels, and comments
- ✅ Natural language date parsing ("tomorrow", "next Monday")
- ✅ Todoist filter syntax support ("today & p1", "#Work")
- ✅ Automatic cursor-based pagination
- ✅ Clean markdown-formatted responses
- ✅ Comprehensive error handling

## API Documentation

For detailed parameter documentation, see [AGENTS.md](./AGENTS.md).

For Todoist API reference: https://todoist.com/api/v1/docs

## License

MIT © Espen Nilsen
