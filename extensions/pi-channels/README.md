# @e9n/pi-channels

Two-way channel extension for [pi](https://github.com/espennilsen/pi) — route messages between agents and Telegram, Slack, webhooks, or custom adapters.

## Features

- **Telegram adapter** — bidirectional via Bot API; polling, voice/audio transcription, `allowedChatIds` filtering
- **Slack adapter** — bidirectional via Socket Mode + Web API
- **Webhook adapter** — outgoing HTTP POST to any URL
- **Chat bridge** — incoming messages are routed to the agent as prompts; responses sent back automatically; persistent (RPC) or stateless mode
- **Event API** — `channel:send`, `channel:receive`, `channel:register` for inter-extension messaging
- **Custom adapters** — register at runtime via `channel:register` event

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

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
      "ops": { "adapter": "telegram", "recipient": "-100987654321" }
    },
    "bridge": {
      "enabled": false
    }
  }
}
```

Use `"env:VAR_NAME"` to reference environment variables. Project settings override global ones.

### Adapter types

| Type | Direction | Key config |
|------|-----------|------------|
| `telegram` | bidirectional | `botToken`, `polling`, `parseMode`, `allowedChatIds`, `transcription` |
| `slack` | bidirectional | `botToken`, `appToken` |
| `webhook` | outgoing | `method`, `headers` |

### Bridge settings

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `false` | Enable on startup (also: `--chat-bridge` flag or `/chat-bridge on`) |
| `sessionMode` | `"persistent"` | `"persistent"` = RPC subprocess with conversation memory; `"stateless"` = isolated per message |
| `sessionRules` | `[]` | Per-sender mode overrides: `[{ "match": "telegram:-100*", "mode": "stateless" }]` |
| `idleTimeoutMinutes` | `30` | Kill idle persistent sessions after N minutes |
| `maxQueuePerSender` | `5` | Max queued messages per sender |
| `timeoutMs` | `300000` | Per-prompt timeout (ms) |
| `maxConcurrent` | `2` | Max senders processed in parallel |
| `typingIndicators` | `true` | Send typing indicators while processing |

## Tool: `notify`

| Action | Required params | Description |
|--------|----------------|-------------|
| `send` | `adapter`, `text` | Send a message via an adapter name or route alias |
| `list` | — | Show configured adapters and routes |
| `test` | `adapter` | Send a test ping |

## Commands

| Command | Description |
|---------|-------------|
| `/chat-bridge` | Show bridge status (sessions, queue, active prompts) |
| `/chat-bridge on` | Start the chat bridge |
| `/chat-bridge off` | Stop the chat bridge |

## Install

```bash
pi install npm:@e9n/pi-channels
```

## License

MIT
