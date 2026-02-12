# pi-channels

Two-way channel extension for [pi](https://github.com/badlogic/pi-mono). Routes messages between agents and external services like Telegram, webhooks, or custom adapters.

Includes a **chat bridge** that turns any bidirectional adapter into a full agent chat interface — incoming messages are routed to the agent as subprocess prompts, and responses are sent back automatically.

## Install

```bash
pi install /path/to/pi-channels
```

## How it works

1. Extensions emit `channel:send` events (or pi-cron emits `cron:job_complete`)
2. pi-channels resolves the adapter + recipient (directly or via a named route)
3. Delivers the message via the matching adapter
4. No adapter found? Returns `{ ok: false }` (silent unless caller checks callback)

When the **chat bridge** is enabled:
1. Incoming messages (e.g. from Telegram polling) hit `channel:receive`
2. The bridge serializes per sender (one prompt at a time, FIFO queue)
3. Each prompt is run as an isolated `pi -p --no-session` subprocess
4. The agent's response is sent back via the same adapter to the same chat
5. Typing indicators keep the user informed during processing

## Config

Add `"pi-channels"` to your pi settings file (`~/.pi/agent/settings.json` or `.pi/settings.json`):

```json
{
  "pi-channels": {
    "adapters": {
      "telegram": {
        "type": "telegram",
        "botToken": "env:TELEGRAM_BOT_TOKEN",
        "polling": true
      },
      "alerts": {
        "type": "webhook",
        "headers": { "Authorization": "env:WEBHOOK_SECRET" }
      }
    },
    "routes": {
      "ops": { "adapter": "telegram", "recipient": "-100987654321" },
      "cron": { "adapter": "telegram", "recipient": "123456789" }
    },
    "bridge": {
      "enabled": false,
      "maxQueuePerSender": 5,
      "timeoutMs": 300000,
      "maxConcurrent": 2,
      "typingIndicators": true,
      "commands": true,
      "model": null,
      "extensions": []
    }
  }
}
```

Use `"env:VAR_NAME"` to reference environment variables.

Project settings (`.pi/settings.json`) override global settings.

### Routes

Routes map friendly names to adapter + recipient pairs. When pi-cron fires a job with `channel: "ops"`, the route resolves it to Telegram chat `-100987654321`.

### Bridge config

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `false` | Enable on startup. Also via `--chat-bridge` flag or `/chat-bridge on`. |
| `maxQueuePerSender` | `5` | Max pending messages per sender before rejecting new ones. |
| `timeoutMs` | `300000` | Subprocess timeout (5 min). |
| `maxConcurrent` | `2` | Max senders processed in parallel. |
| `model` | `null` | Model override for subprocess (null = use default). |
| `typingIndicators` | `true` | Send typing indicators while processing. |
| `commands` | `true` | Handle bot commands (/start, /help, /abort, /status, /new). |
| `extensions` | `[]` | Extension paths to load in bridge subprocesses. Subprocess runs with `--no-extensions` by default to avoid conflicts (port collisions, native module crashes). List only what the bridge agent needs. |

## Chat bridge

The chat bridge turns pi into a conversational assistant accessible via Telegram (or any bidirectional adapter).

### Enabling

Three ways to enable:

```bash
# 1. CLI flag
pi --chat-bridge

# 2. Runtime command
/chat-bridge on

# 3. Settings
{ "bridge": { "enabled": true } }
```

### How it works

- Messages are serialized **per sender** — each sender has their own FIFO queue
- Only one prompt runs at a time per sender (no interleaving)
- Multiple senders can run concurrently (up to `maxConcurrent`)
- If a sender's queue is full, new messages are rejected with a warning
- Typing indicators refresh every 4 seconds (Telegram typing expires after ~5s)

### Bot commands

When `commands` is enabled, messages starting with `/` are handled directly without routing to the agent:

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | List available commands |
| `/abort` | Cancel the currently running prompt |
| `/status` | Show session info (queue, uptime, message count) |
| `/new` | Reset session and clear queue |

Commands work in both private and group chats. In groups, `/command@botname` format is supported.

### Events

| Event | When | Payload |
|-------|------|---------|
| `bridge:enqueue` | Message queued | `{ id, adapter, sender, queueDepth }` |
| `bridge:start` | Prompt processing starts | `{ id, adapter, sender, text }` |
| `bridge:complete` | Prompt done | `{ id, adapter, sender, ok, durationMs }` |

## Built-in adapters

### Telegram

```json
{
  "type": "telegram",
  "botToken": "env:TELEGRAM_BOT_TOKEN",
  "polling": true,
  "parseMode": "Markdown",
  "pollingTimeout": 30,
  "allowedChatIds": ["-100123456"]
}
```

- Recipient = Telegram chat ID (per-message or via route)
- Auto-splits messages over 4096 chars
- `polling: true` enables incoming messages (required for bridge)
- `allowedChatIds` restricts which chats can send messages (security)
- `parseMode` optional (default: plain text)
- Supports typing indicators when bridge is active

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
    direction: "outgoing",
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

Custom adapters can also be bidirectional with `sendTyping` support:

```typescript
pi.events.emit("channel:register", {
  name: "discord",
  adapter: {
    direction: "bidirectional",
    async send(message) { /* ... */ },
    async start(onMessage) { /* listen for incoming */ },
    async stop() { /* cleanup */ },
    async sendTyping(recipient) { /* show typing indicator */ },
  },
});
```

## Event API

| Event | Purpose | Payload |
|---|---|---|
| `channel:send` | Send a message | `{ adapter, recipient, text, source?, metadata?, callback? }` |
| `channel:receive` | Incoming message | `{ adapter, sender, text, metadata? }` |
| `channel:register` | Register a custom adapter | `{ name, adapter, callback? }` |
| `channel:remove` | Remove an adapter | `{ name, callback? }` |
| `channel:list` | List adapters + routes | `{ callback? }` |
| `channel:test` | Send a test ping | `{ adapter, recipient, callback? }` |

Also listens to `cron:job_complete` from pi-cron — routes job output via the job's channel field.

## LLM tool

The `notify` tool lets the LLM send messages directly:

- `list` — show configured adapters and routes
- `send` — deliver a message (adapter + recipient + text)
- `test` — send a ping to verify delivery

## Commands

| Command | Description |
|---------|-------------|
| `/chat-bridge` | Show bridge status |
| `/chat-bridge on` | Start the chat bridge |
| `/chat-bridge off` | Stop the chat bridge |

## File structure

```
src/
├── index.ts              # Extension entry — lifecycle, flag, command
├── types.ts              # ChannelMessage, ChannelAdapter, bridge types, config
├── config.ts             # Reads "pi-channels" from settings.json
├── registry.ts           # Adapter registry + route resolution
├── events.ts             # channel:* event handlers + bridge wiring
├── tool.ts               # LLM tool (notify)
├── adapters/
│   ├── telegram.ts       # Telegram Bot API adapter (with typing support)
│   └── webhook.ts        # Generic webhook adapter
└── bridge/
    ├── bridge.ts         # Core bridge — per-sender queues, concurrency, lifecycle
    ├── commands.ts       # Bot command registry (/start, /help, /abort, /status, /new)
    ├── runner.ts         # Subprocess runner (pi -p --no-session)
    └── typing.ts         # Typing indicator manager
```
