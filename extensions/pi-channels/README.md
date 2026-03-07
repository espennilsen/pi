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
        "botToken": "your-telegram-bot-token",
        "polling": true
      },
      "alerts": {
        "type": "webhook",
        "headers": { "Authorization": "Bearer your-webhook-secret" }
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

**Secrets:**
- Set secret values (tokens, keys) directly in `settings.json`
- Project settings override global ones

### Adapter types

| Type | Direction | Key config |
|------|-----------|------------|
| `telegram` | bidirectional | `botToken`, `polling`, `parseMode`, `allowedChatIds`, `transcription` |
| `slack` | bidirectional | `botToken`, `appToken` |
| `webhook` | outgoing | `method`, `contentType`, `payloadMode`, `headers` |

> Webhook migration note: custom `Content-Type` should be set via `contentType`.
> If both `contentType` and `headers["Content-Type"]` are provided, `contentType` wins.

### Transcription (Voice & Audio)

The Telegram adapter supports transcribing voice messages and audio files. Add to the telegram adapter config:

```json
{
  "telegram": {
    "type": "telegram",
    "botToken": "your-telegram-bot-token",
    "transcription": {
      "enabled": true,
      "provider": "openai"
    }
  }
}
```

**Providers:**

| Provider | Requirements | Notes |
|----------|--------------|-------|
| `apple` | macOS only | Free, offline, uses SFSpeechRecognizer. No API key needed. |
| `openai` | OpenAI API key | **Automatically uses pi's built-in OpenAI authentication** if you've run `/login openai`. No explicit `apiKey` needed! Override with `apiKey` in config if you want to use a separate key. |
| `elevenlabs` | ElevenLabs API key | Requires `apiKey` set directly in config. |

**Transcription options:**
- `enabled` — Enable transcription (default: `false`)
- `provider` — `"apple"`, `"openai"`, or `"elevenlabs"` (required)
- `apiKey` — For OpenAI: **optional** (uses pi's auth). For ElevenLabs: required (set directly in settings.json).
- `model` — Model name, e.g. `"whisper-1"` (OpenAI), `"scribe_v1"` (ElevenLabs)
- `language` — ISO 639-1 code, e.g. `"en"`, `"no"` (optional)

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
| `send` | `adapter`, (`text` or `json`) | Send a message via an adapter name or route alias |
| `list` | — | Show configured adapters and routes |
| `test` | `adapter` | Send a test ping |

For webhook sends, `notify` supports:
- `payloadMode`: `"envelope"` (default) or `"raw"`
- `json`: raw request body (auto-enables raw mode if provided; required for body-carrying raw methods)
- `method`: HTTP method override for raw mode (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`)
- `contentType`: `Content-Type` override for raw mode (applies only when a request body is sent)
- `GET`/`HEAD` raw requests are bodyless (do not provide `json`)

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
