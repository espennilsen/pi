# pi-channels

Two-way channel extension for [pi](https://github.com/badlogic/pi-mono). Routes messages between agents and external services like Telegram, webhooks, or custom adapters.

## Install

```bash
pi install /path/to/pi-channels
```

## How it works

1. Extensions emit `channel:send` events (or pi-cron emits `cron:job_complete`)
2. pi-channels resolves the adapter + recipient (directly or via a named route)
3. Delivers the message via the matching adapter
4. No adapter found? Returns `{ ok: false }` (silent unless caller checks callback)

## Config

Add `"pi-channels"` to your pi settings file (`~/.pi/agent/settings.json` or `.pi/settings.json`):

```json
{
  "pi-channels": {
    "adapters": {
      "telegram": {
        "type": "telegram",
        "botToken": "env:TELEGRAM_BOT_TOKEN"
      },
      "alerts": {
        "type": "webhook",
        "headers": { "Authorization": "env:WEBHOOK_SECRET" }
      }
    },
    "routes": {
      "ops": { "adapter": "telegram", "recipient": "-100987654321" },
      "cron": { "adapter": "telegram", "recipient": "123456789" }
    }
  }
}
```

Use `"env:VAR_NAME"` to reference environment variables.

Project settings (`.pi/settings.json`) override global settings.

### Routes

Routes map friendly names to adapter + recipient pairs. When pi-cron fires a job with `channel: "ops"`, the route resolves it to Telegram chat `-100987654321`.

## Built-in adapters

### Telegram

```json
{
  "type": "telegram",
  "botToken": "env:TELEGRAM_BOT_TOKEN",
  "parseMode": "Markdown"
}
```

- Recipient = Telegram chat ID (per-message or via route)
- Auto-splits messages over 4096 chars
- `parseMode` optional (default: plain text)

### Webhook

```json
{
  "type": "webhook",
  "method": "POST",
  "headers": { "Authorization": "Bearer secret" }
}
```

- Recipient = webhook URL
- POSTs JSON: `{ text, source, metadata, timestamp }`

## Custom adapters

Other extensions register adapters at runtime:

```typescript
pi.events.emit("channel:register", {
  name: "email",
  adapter: {
    async send(message) {
      await sendEmail({ to: message.recipient, subject: message.source, body: message.text });
    },
  },
});
```

Then anyone can send to it:

```typescript
pi.events.emit("channel:send", {
  adapter: "email",
  recipient: "espen@example.com",
  text: "File changed: src/index.ts",
  source: "file-watcher",
});
```

## Event API

| Event | Purpose | Payload |
|---|---|---|
| `channel:send` | Send a message | `{ adapter, recipient, text, source?, metadata?, callback? }` |
| `channel:register` | Register a custom adapter | `{ name, adapter: { send(msg) }, callback? }` |
| `channel:remove` | Remove an adapter | `{ name, callback? }` |
| `channel:list` | List adapters + routes | `{ callback? }` |
| `channel:test` | Send a test ping | `{ adapter, recipient, callback? }` |

Also listens to `cron:job_complete` from pi-cron — routes job output via the job's channel field.

## LLM tool

The `channel` tool lets the LLM send messages directly:

- `list` — show configured adapters and routes
- `send` — deliver a message (adapter + recipient + text)
- `test` — send a ping to verify delivery

## File structure

```
src/
├── index.ts              # Extension entry — lifecycle + wiring
├── types.ts              # ChannelMessage, ChannelAdapter, config types
├── config.ts             # Reads "pi-channels" from settings.json
├── registry.ts           # Adapter registry + route resolution
├── events.ts             # channel:* event handlers + cron listener
├── tool.ts               # LLM tool
└── adapters/
    ├── telegram.ts       # Telegram Bot API adapter
    └── webhook.ts        # Generic webhook adapter
```
