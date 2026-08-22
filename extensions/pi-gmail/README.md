# @e9n/pi-gmail

Full Gmail integration for [pi](https://github.com/mariozechner/pi-coding-agent) — read, search, compose, reply, and manage emails via the Gmail API.

## Features

- **Read & search** — search with Gmail query syntax, read individual emails or full threads
- **Compose & reply** — create drafts, reply to threads, send immediately
- **Manage** — archive, trash, label, mark read/unread
- **Attachments** — download attachments to disk
- **Multi-account support** — connect multiple Gmail accounts, switch between them on the fly, or specify account per tool call
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

#### Single account:
```json
{
  "pi-gmail": {
    "clientId": "your-client-id.apps.googleusercontent.com",
    "clientSecret": "your-client-secret",
    "readOnly": false
  }
}
```

#### Multiple accounts:
```json
{
  "pi-gmail": {
    "defaultAccount": "personal",
    "accounts": {
      "personal": {
        "clientId": "personal-client-id.apps.googleusercontent.com",
        "clientSecret": "personal-client-secret"
      },
      "work": {
        "clientId": "work-client-id.apps.googleusercontent.com",
        "clientSecret": "work-client-secret",
        "readOnly": true
      }
    }
  }
}
```

Set `clientId` and `clientSecret` directly in `settings.json`; `env:VAR_NAME` substitution is not supported.

### 3. Authenticate

Start pi-webserver with `/web`, then run `/gmail-auth` (or `/gmail-auth <account_name>`). Pi opens the default browser and prints a clickable authentication URL fallback. The webserver handles the OAuth callback and stores account tokens locally in `~/.pi/agent/db/`.

### Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `clientId` | string | — | Google OAuth client ID (for single account) |
| `clientSecret` | string | — | Google OAuth client secret (for single account) |
| `defaultAccount` | string | — | Name of the default account in multi-account setups |
| `accounts` | object | — | Map of account configurations (`{ [name]: { clientId, clientSecret, readOnly? } }`) |
| `readOnly` | boolean | `false` | Disable the `send` and `send_draft` actions; composing and reading drafts remains available |
| `notifications.enabled` | boolean | `false` | Enable background polling for new mail |
| `notifications.intervalMinutes` | number | `5` | Polling interval in minutes |
| `notifications.query` | string | `"is:unread"` | Gmail search query for notifications |

## Tool: `gmail`

All actions are accessed through a single `gmail` tool with an `action` parameter. In multi-account setups, an optional `account` parameter can target a specific account.

### Actions

| Action | Description | Key params |
|--------|-------------|------------|
| `search` | Search emails with Gmail query syntax | `query`, `max_results`, `account?` |
| `read` | Read a single email by ID | `id`, `account?` |
| `read_thread` | Read a full conversation thread | `thread_id`, `account?` |
| `list_inbox` | List recent inbox messages | `max_results`, `account?` |
| `list_unread` | List unread messages | `max_results`, `account?` |
| `list_labels` | List all Gmail labels | `account?` |
| `compose` | Create a draft email | `to`, `subject`, `body`, `cc`, `bcc`, `account?` |
| `reply` | Reply to a thread | `thread_id`, `body`, `reply_all`, `account?` |
| `send` | Compose and send immediately (disabled when `readOnly` is `true`) | `to`, `subject`, `body`, `account?` |
| `send_draft` | Send an existing draft (disabled when `readOnly` is `true`) | `draft_id`, `account?` |
| `list_drafts` | List all drafts | `account?` |
| `delete_draft` | Delete a draft | `draft_id`, `account?` |
| `archive` | Archive messages (remove from inbox) | `id` or `ids`, `account?` |
| `trash` | Move messages to trash | `id` or `ids`, `account?` |
| `label` | Add or remove labels | `id`, `add_labels`, `remove_labels`, `account?` |
| `mark_read` | Mark messages as read | `id` or `ids`, `account?` |
| `mark_unread` | Mark messages as unread | `id` or `ids`, `account?` |
| `download_attachment` | Save an attachment to disk | `id`, `attachment_id`, `save_path`, `account?` |

## Commands

| Command | Description |
|---------|-------------|
| `/gmail-auth [account]` | Start OAuth authentication flow for active or named account |
| `/gmail-switch [account]` | Switch active account, or list configured accounts if no argument is given |
| `/gmail-accounts` | List all configured and connected Gmail accounts |
| `/gmail-logout [account]` | Disconnect specified or active Gmail account |
| `/gmail-status` | Show current authentication status for active account |

## Web UI

When [pi-webserver](../pi-webserver) is running, the extension mounts:

- `/gmail` — Auth status page with connect/disconnect
- `/gmail/auth` — OAuth redirect to Google (supports `?account=<name>`)
- `/gmail/callback` — OAuth callback handler
- `/api/gmail/status` — JSON auth status endpoint

## Install

```bash
pi install npm:@e9n/pi-gmail
```

## License

MIT
