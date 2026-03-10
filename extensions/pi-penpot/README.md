# pi-penpot

Penpot design tool integration for [pi](https://github.com/badlogic/pi-mono). Provides full programmatic access to Penpot's REST API — manage projects, files, pages, shapes, comments, and more from the pi CLI.

## Setup

### 1. Install

```bash
cd ~/Dev/pi/extensions/pi-penpot
npm install
```

### 2. Configure

Add to your `settings.json` (global `~/.pi/agent/settings.json` or project `.pi/settings.json`):

```json
{
  "pi-penpot": {
    "endpoint": "https://penpot.e9n.dev",
    "accessToken": "<your-personal-access-token>"
  }
}
```

Get your access token from Penpot: **Profile Settings → Access Tokens → Generate new token**.

### 3. Load

The extension auto-discovers if placed in `~/Dev/pi/extensions/pi-penpot/`. Or load explicitly:

```bash
pi -e ~/Dev/pi/extensions/pi-penpot/src/index.ts
```

## Tools

### `penpot` — Projects, Files, Teams

Organizational operations: manage teams, projects, files, libraries, webhooks, snapshots, and share links.

**Actions:**

| Category | Actions |
|----------|---------|
| Profile & Teams | `get-profile`, `get-teams`, `get-team-members` |
| Projects | `get-projects`, `create-project`, `rename-project`, `delete-project`, `duplicate-project` |
| Files | `get-project-files`, `get-file`, `get-file-summary`, `create-file`, `rename-file`, `delete-file`, `duplicate-file`, `move-files`, `search-files`, `export-file` |
| Libraries | `get-file-libraries`, `get-shared-files`, `link-library`, `unlink-library`, `set-file-shared` |
| Media | `get-thumbnails` |
| Fonts | `get-fonts` |
| Webhooks | `get-webhooks`, `create-webhook`, `update-webhook`, `delete-webhook` |
| Share Links | `create-share-link`, `delete-share-link` |
| Snapshots | `get-snapshots`, `create-snapshot`, `restore-snapshot` |
| Misc | `status` |

### `penpot_page` — Pages & Shapes

Design content operations: read pages, create/modify/delete shapes, manage components.

**Actions:**

| Category | Actions |
|----------|---------|
| Pages | `get-page`, `add-page`, `rename-page`, `delete-page` |
| Shapes (Read) | `list-shapes`, `get-shape` |
| Shapes (Create) | `add-rectangle`, `add-ellipse`, `add-text`, `add-frame`, `add-group`, `add-path`, `add-image` |
| Shapes (Modify) | `modify-shape`, `delete-shape`, `move-shapes` |
| Components | `add-component`, `list-components` |

### `penpot_comment` — Comments

Collaboration: comment threads, replies, and thread management.

**Actions:**

| Category | Actions |
|----------|---------|
| Read | `get-threads`, `get-comments`, `get-unread-threads` |
| Write | `create-thread`, `reply`, `update-comment` |
| Manage | `delete-comment`, `delete-thread`, `update-thread-status`, `update-thread-position`, `mark-threads-read` |

## Examples

```
> penpot get-teams
> penpot get-projects teamId="<team-id>"
> penpot create-project teamId="<team-id>" name="My Design System"
> penpot create-file projectId="<project-id>" name="Components"
> penpot_page add-frame fileId="<file-id>" pageId="<page-id>" name="Hero Section" width=1440 height=900
> penpot_page add-rectangle fileId="<file-id>" pageId="<page-id>" parentId="<frame-id>" x=100 y=100 width=200 height=50 fills=[{"fillColor":"#3B82F6","fillOpacity":1}]
> penpot_page add-text fileId="<file-id>" pageId="<page-id>" parentId="<frame-id>" x=100 y=200 text="Hello World"
> penpot_comment create-thread fileId="<file-id>" pageId="<page-id>" content="Review this layout" position={"x":100,"y":100}
```

## API Coverage

This extension covers the full Penpot REST API (`/api/rpc/command/*`):

- **Authentication** — Token-based (personal access tokens)
- **Teams** — List, members
- **Projects** — CRUD, duplicate
- **Files** — CRUD, duplicate, move, search, export, shared libraries
- **Pages** — CRUD via update-file changes
- **Shapes** — Create (rect, ellipse, text, frame, group, path, image), modify (any attribute), delete, move/reorder
- **Components** — Create, list
- **Comments** — Threads CRUD, replies, status, position, read status
- **Webhooks** — CRUD
- **Share Links** — Create, delete
- **Snapshots** — Create, list, restore
- **Media** — Thumbnails, image upload from URL
- **Fonts** — List custom font variants

## Architecture

```
src/
├── index.ts              # Extension entry point
├── settings.ts           # SettingsManager integration
├── client.ts             # HTTP client (fetch with auth)
├── types.ts              # TypeScript types (uses @penpot/plugin-types)
└── tools/
    ├── penpot.ts          # Main tool (projects/files/teams)
    ├── penpot-page.ts     # Page & shape tool
    └── penpot-comment.ts  # Comment tool
```

## Dependencies

- `@penpot/plugin-types` — Penpot domain model type definitions
- `@mariozechner/pi-coding-agent` — Pi extension API (peer)
- `@sinclair/typebox` — Tool parameter schemas (peer)
- `@mariozechner/pi-ai` — StringEnum for Google-compatible enums (peer)
