# @e9n/pi-channels

Two-way channel extension for [pi](https://github.com/espennilsen/pi) — route messages between agents and Telegram, Slack, webhooks, or custom adapters.

## Features

- **Telegram adapter** — bidirectional via Bot API; polling, voice/audio transcription, file uploads, `allowedChatIds` filtering
- **Slack adapter** — bidirectional via Socket Mode + Web API
- **Webhook adapter** — outgoing HTTP POST to any URL
- **Chat bridge** — incoming messages are routed to the agent as prompts; responses sent back automatically; persistent (RPC) or stateless mode
- **File upload** — incoming files (video, audio, binary, etc.) saved to temp and passed to the LLM as attachments
- **File send** — LLM can send local files back to Telegram via the `notify` tool's `send_file` action
- **Event API** — `channel:send`, `channel:receive`, `channel:register`, `channel:send_file` for inter-extension messaging
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
| `telegram` | bidirectional | `botToken`, `polling`, `parseMode`, `allowedChatIds`, `transcription`, `fileUpload` |
| `slack` | bidirectional | `botToken`, `appToken` |
| `webhook` | outgoing | `method`, `contentType`, `payloadMode`, `headers` |

> Webhook migration note: custom `Content-Type` should be set via `contentType`.
> If both `contentType` and `headers["Content-Type"]` are provided, `contentType` wins.

### File Upload (Incoming Files)

Enable `fileUpload` in the Telegram adapter config to allow the LLM to receive any type of file (video, audio, binary, etc.). Without `fileUpload`, only images and text documents are supported; other file types are rejected.

```json
{
  "telegram": {
    "type": "telegram",
    "botToken": "your-telegram-bot-token",
    "polling": true,
    "fileUpload": {
      "enabled": true,
      "maxSize": 52428800
    }
  }
}
```

**How it works:**
- Uploaded files are saved to `/tmp/pi-channels/` and the LLM is notified with the local file path
- The LLM can then read or process the file directly using any tools available (read, CLI, etc.)
- Audio/voice messages with transcription enabled are still transcribed first; if transcription fails, the file is saved as a fallback
- Video files require `fileUpload` to be enabled (not supported without it)
- Unsupported file types without `fileUpload` suggest enabling it in the error message

**Options:**
- `enabled` — Enable file uploads (default: `false`)
- `maxSize` — Max file size in bytes (default: `52428800` = 50MB)

### File Send (Outgoing Files)

The LLM can send local files back to Telegram using the `notify` tool's `send_file` action:

```
notify(action: "send_file", adapter: "telegram", recipient: "<chat_id>", filePath: "/tmp/pi-channels/result.pdf", caption: "Here's the report")
```

This uses Telegram's `sendDocument`, `sendPhoto`, `sendAudio`, or `sendVideo` API depending on the file type.

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

> **Tip:** When both `transcription` and `fileUpload` are enabled, audio/voice messages are transcribed first. If the transcription fails, the audio file is saved to temp as a fallback so the LLM can still access it.

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
| `send` | `adapter`, (`text` or `json`) | Send a text message via an adapter name or route alias |
| `send_file` | `adapter`, `filePath` | Send a file as an attachment (supports Telegram photos, audio, video, documents) |
| `list` | — | Show configured adapters and routes |
| `test` | `adapter` | Send a test ping |

**`send_file` parameters:**
- `adapter` — Adapter name or route alias (required)
- `filePath` — Absolute path to the local file (required)
- `fileName` — Override filename (optional, defaults to basename)
- `caption` — Caption for the file (optional)
- `recipient` — Chat ID (optional if using a route with a default recipient)

For webhook sends, `notify` supports:
- `payloadMode`: `"envelope"` (default) or `"raw"`
- `json`: raw request body (auto-enables raw mode if provided; required for body-carrying raw methods)
- `method`: HTTP method override for raw mode (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`)
- `contentType`: `Content-Type` override for raw mode (applies only when a request body is sent)
- `GET`/`HEAD` raw requests are bodyless (do not provide `json`)

## Event Bus API

| Event | Direction | Description |
|-------|-----------|-------------|
| `channel:send` | inbound | Send a message via adapter |
| `channel:receive` | outbound | Incoming message from adapter |
| `channel:register` | inbound | Register a custom adapter |
| `channel:remove` | inbound | Remove an adapter |
| `channel:list` | inbound | List adapters and routes |
| `channel:test` | inbound | Send a test ping |
| `channel:send_file` | inbound | Send a file via adapter (file sending) |

## Commands

| Command | Description |
|---------|-------------|
| `/chat-bridge` | Show bridge status (sessions, queue, active prompts) |
| `/chat-bridge on` | Start the chat bridge |
| `/chat-bridge off` | Stop the chat bridge |

## Message history

History requires pi-kysely with an available default **SQLite** database. Channels
subscribes to database readiness and probes the current registry, so either extension
may start first. Adapter and bridge startup does not wait for history initialization.

`channel_history` and `/channel-history` report "not ready" until initialization
succeeds. Incoming/outgoing logging begins then; earlier messages are not buffered.
If the default database is still unavailable after 10 seconds, channels warns but
continues listening for readiness. Initialization failures include the underlying
error and can retry on a later `kysely:ready` event. There is no polling retry loop.

Schema creation uses Kysely's migration API, followed by schema ownership registration
for query access. Existing `pi_channels__messages` data and the legacy
`pi_channels_migrations` table are preserved. New migration tracking is maintained
by pi-kysely. Shutdown removes readiness listeners, cancels local request timers,
and clears history consumers; SQL already submitted to Kysely cannot be recalled.

After installing updated code, use `/reload` or restart the relevant Pi session to
activate it. Existing running sessions are not changed automatically.

### Tests

With Node.js 24.19+ and dependencies installed in `extensions/pi-channels`:

```bash
npm test
npm run typecheck
```

The tests mock configuration to avoid loading real adapters or owner settings.
Node's experimental module-mocking and module-type warnings are expected.
For actual Kysely/SQLite integration tests, also install dependencies in the sibling
`extensions/pi-kysely`, then run `npm run test:integration` from pi-channels.
Integration tests use only in-memory databases, including a legacy-history fixture.

## Install

```bash
pi install npm:@e9n/pi-channels
```

## License

MIT