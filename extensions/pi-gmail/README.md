# @e9n/pi-gmail

Full Gmail integration for [pi](https://github.com/mariozechner/pi-coding-agent) — read, search, compose, reply, and manage emails via the Gmail API.

## Features

- **Read & search** — search with Gmail query syntax, read individual emails or full threads
- **Compose & reply** — create drafts, reply to threads, send immediately
- **Manage** — archive, trash, label, mark read/unread
- **Attachments** — download attachments to disk
- **Notifications** — optional background polling with TUI alerts for new mail
- **Web UI** — OAuth flow and auth status page via pi-webserver

## Setup

### 1. Create Google OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use an existing one)
3. Enable the **Gmail API**
4. Create **OAuth 2.0 Client ID** credentials (Desktop or Web application)
5. Add `http://localhost:<port>/gmail/callback` as an authorized redirect URI

### 2. Configure pi settings

Add to `~/.pi/agent/settings.json`:

```json
{
  "pi-gmail": {
    "clientId": "your-client-id.apps.googleusercontent.com",
    "clientSecret": "your-client-secret",
    "userEmail": "you@gmail.com"
  }
}
```

Values can use `env:VAR_NAME` syntax to read from environment variables.

### 3. Authenticate

Run `/gmail-auth` in pi to start the OAuth flow — opens a browser for Google sign-in and stores tokens locally.

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `clientId` | string | — | Google OAuth client ID (required) |
| `clientSecret` | string | — | Google OAuth client secret (required) |
| `userEmail` | string | — | Your Gmail address (used for reply filtering) |
| `notifications.enabled` | boolean | `false` | Enable background polling for new mail |
| `notifications.intervalMinutes` | number | `5` | Polling interval in minutes |
| `notifications.query` | string | `"is:unread"` | Gmail search query for notifications |

## Tool: `gmail`

All actions are accessed through a single `gmail` tool with an `action` parameter.

### Actions

| Action | Description | Key params |
|--------|-------------|------------|
| `search` | Search emails with Gmail query syntax | `query`, `max_results` |
| `read` | Read a single email by ID | `id` |
| `read_thread` | Read a full conversation thread | `thread_id` |
| `list_inbox` | List recent inbox messages | `max_results` |
| `list_unread` | List unread messages | `max_results` |
| `list_labels` | List all Gmail labels | — |
| `compose` | Create a draft email | `to`, `subject`, `body`, `cc`, `bcc` |
| `reply` | Reply to a thread | `thread_id`, `body`, `reply_all` |
| `send` | Compose and send immediately | `to`, `subject`, `body` |
| `send_draft` | Send an existing draft | `draft_id` |
| `list_drafts` | List all drafts | — |
| `delete_draft` | Delete a draft | `draft_id` |
| `archive` | Archive messages (remove from inbox) | `id` or `ids` |
| `trash` | Move messages to trash | `id` or `ids` |
| `label` | Add or remove labels | `id`, `add_labels`, `remove_labels` |
| `mark_read` | Mark messages as read | `id` or `ids` |
| `mark_unread` | Mark messages as unread | `id` or `ids` |
| `download_attachment` | Save an attachment to disk | `id`, `attachment_id`, `save_path` |

## Commands

| Command | Description |
|---------|-------------|
| `/gmail-auth` | Start OAuth authentication flow |
| `/gmail-logout` | Disconnect Gmail account |
| `/gmail-status` | Show current authentication status |

## Web UI

When [pi-webserver](../pi-webserver) is running, the extension mounts:

- `/gmail` — Auth status page with connect/disconnect
- `/gmail/auth` — OAuth redirect to Google
- `/gmail/callback` — OAuth callback handler
- `/api/gmail/status` — JSON auth status endpoint

## Install

```bash
pi install npm:@e9n/pi-gmail
```

## License

MIT
