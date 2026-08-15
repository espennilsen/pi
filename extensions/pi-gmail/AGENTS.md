---
name: pi-gmail
description: Gmail extension for pi — search, read, compose, send, and manage emails via Gmail API
---

## Overview

Self-contained pi extension providing full Gmail integration via Google's REST API. OAuth 2.0 auth with token persistence, LLM tool for email operations, web-based auth flow, and optional email notifications via pi-channels.

**Stack:** TypeScript · Gmail API v1 REST · OAuth 2.0

## Architecture

- `index.ts` — Extension entry point. Registers tool, commands, mounts web routes, starts notifications.
- `types.ts` — All shared types: OAuthTokens, GmailMessage, GmailThread, GmailLabel, ParsedEmail, etc.
- `auth.ts` — OAuth 2.0 flow: consent URL generation, code exchange, token storage (JSON file), auto-refresh.
- `client.ts` — Thin REST client over Gmail API v1. Direct fetch calls, no SDK dependency.
- `tool.ts` — LLM tool with 18 actions: search, read, read_thread, list_inbox, list_unread, list_labels, compose, reply, send, send_draft, list_drafts, delete_draft, archive, trash, label, mark_read, mark_unread, download_attachment.
- `formatter.ts` — Converts raw Gmail API responses to clean markdown for LLM. HTML stripping, body truncation, thread formatting, RFC 2822 message builder.
- `web.ts` — Mounts `/gmail` status page, `/gmail/auth` OAuth start, `/gmail/callback` OAuth callback, `/api/gmail/status` via pi-webserver event bus.
- `logger.ts` — Extension logger (emits to pi-logger).

## Key Patterns

- **No SDK dependency** — Direct REST via `fetch` to `gmail.googleapis.com/gmail/v1/users/me/*`.
- **No direct imports** between extensions — all integration via event bus (`web:mount`, `web:mount-api`, `web:ready`, `channel:send`).
- **Safety gates** — `send`, `send_draft`, `archive`, `trash` actions require `ctx.ui.confirm()` before execution.
- **Token auto-refresh** — Access tokens refreshed 5 minutes before expiry; refresh tokens persisted in JSON file (`db/gmail-tokens.json`).
- **Single tool, multi-action** — One `gmail` tool with StringEnum action parameter (same pattern as pi-calendar).

## Token Storage

OAuth tokens persisted as `db/gmail-tokens.json` under agent home directory. Simple JSON file — no database dependency.

## Settings

```jsonc
// settings.json
{
  "pi-gmail": {
    "clientId": "env:GMAIL_CLIENT_ID",        // Google OAuth client ID
    "clientSecret": "env:GMAIL_CLIENT_SECRET", // Google OAuth client secret
    "maxResults": 20,                          // Default max results per query
    "readOnly": true,                          // Block send and send_draft actions
    "notifications": {
      "enabled": false,                        // Enable email polling
      "query": "is:unread",                    // Gmail query for notifications
      "intervalMinutes": 5,                    // Polling interval
      "channel": "default"                     // pi-channels channel
    }
  }
}
```

## Integration Points

| Extension | Integration | Mechanism |
|-----------|------------|-----------|
| **pi-webserver** | OAuth callback, status page | `web:mount`, `web:mount-api`, `web:ready`, `web:info` |
| **pi-channels** | Email notifications | `channel:send` event |
| **pi-logger** | Structured logging | `log` event |

## Commands

- `/gmail-auth` — Start OAuth flow (opens browser or prints URL)
- `/gmail-logout` — Disconnect Gmail account (clears tokens)
- `/gmail-status` — Show connection status

## Conventions

- No console.log — use logger.
- Tool output truncated to stay under 50KB context limit.
- `env:VAR_NAME` pattern for secrets in settings.
