# pi-gmail

Gmail extension for [pi](https://github.com/badlogic/pi-mono). Gives the agent the ability to read, search, compose, and send emails via the Gmail API.

## Install

```bash
pi install /path/to/pi-gmail
```

## Setup

1. Create a [Google Cloud project](https://console.cloud.google.com)
2. Enable the **Gmail API**
3. Create **OAuth 2.0 credentials** (Desktop app type)
4. Set environment variables:
   ```bash
   export GOOGLE_CLIENT_ID="your-client-id"
   export GOOGLE_CLIENT_SECRET="your-client-secret"
   ```
5. Run `/gmail-auth` to get the consent URL
6. Visit the URL, authorize, and copy the auth code
7. Run `/gmail-auth <code>` to exchange for a refresh token
8. Set the refresh token:
   ```bash
   export GOOGLE_REFRESH_TOKEN="the-refresh-token"
   ```

Or use `/gmail-setup` for step-by-step instructions.

## Config

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-gmail": {
    "readOnly": false,
    "confirmBeforeSend": true
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `readOnly` | `true` | Disable all write operations (compose, reply, send, label changes). |
| `confirmBeforeSend` | `true` | Require draft review before sending. |

## LLM Tool

The `gmail` tool provides these actions:

### Read Operations

| Action | Params | Description |
|--------|--------|-------------|
| `inbox` | `maxResults?` | List recent inbox messages |
| `unread` | `maxResults?` | List unread messages |
| `search` | `query`, `maxResults?` | Search with Gmail query syntax |
| `read` | `id` | Read a specific message by ID |
| `thread` | `id` | Read a full thread by ID |
| `labels` | — | List all labels with stats |

### Label Management

| Action | Params | Description |
|--------|--------|-------------|
| `add-label` | `id`, `label_id` | Apply a label to a message |
| `remove-label` | `id`, `label_id` | Remove a label from a message |

### Write Operations

| Action | Params | Description |
|--------|--------|-------------|
| `compose` | `to`, `subject`, `body`, `cc?`, `bcc?` | Create a draft (does NOT send) |
| `reply` | `id`, `body` | Create a reply draft (does NOT send) |
| `send` | `draft_id` | Send a previously composed draft |

### Gmail Search Syntax

```
from:john@example.com          # From specific sender
subject:invoice                # Subject contains "invoice"
is:unread                      # Unread messages
label:important                # Has label
has:attachment                 # Has attachments
filename:pdf                   # Attachment filename
after:2024/01/01               # Date filter
before:2024/12/31              # Date filter
in:inbox                       # In inbox
{from:a OR from:b}             # OR queries
```

### Safety Model

Compose and reply **only create drafts** — they don't send. The workflow:

1. Agent calls `compose` or `reply` → gets a draft with a `draft_id`
2. Draft preview is shown to the user
3. User reviews and approves
4. Agent calls `send` with the `draft_id` to actually send

## Commands

| Command | Description |
|---------|-------------|
| `/gmail-setup` | Show OAuth setup instructions |
| `/gmail-auth [code]` | Generate consent URL or exchange auth code |

## File Structure

```
src/
├── index.ts    # Extension entry — lifecycle, commands, config
├── auth.ts     # Google OAuth 2.0 (refresh token flow, caching)
├── client.ts   # Gmail REST API client (messages, threads, labels, send)
├── tool.ts     # LLM tool (read, search, compose, send, labels)
└── types.ts    # Type definitions (GmailMessage, GmailThread, etc.)
```
