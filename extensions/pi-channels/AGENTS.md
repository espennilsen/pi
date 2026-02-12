# AGENTS.md — pi-channels

## Project Overview

Two-way channel extension for pi — routes messages between agents and external services (Telegram, webhooks, custom adapters). Includes a **chat bridge** with persistent RPC sessions for conversational Telegram bots.

**Stack:** TypeScript (strict mode)
**Package Manager:** npm

## Directory Layout

```
src/
├── index.ts              # Extension entry — lifecycle, flags, /chat-bridge command
├── types.ts              # All shared types (messages, adapters, config, bridge)
├── config.ts             # Settings loader (reads "pi-channels" from settings.json)
├── registry.ts           # Adapter registry + route resolution
├── events.ts             # channel:* event handlers + bridge wiring
├── tool.ts               # LLM tool (notify: list/send/test)
├── adapters/
│   ├── telegram.ts       # Telegram Bot API adapter (polling + typing)
│   └── webhook.ts        # Generic webhook adapter
└── bridge/
    ├── bridge.ts         # Core bridge — per-sender queues, concurrency, lifecycle
    ├── commands.ts       # Bot command registry (/start, /help, /abort, /status, /new)
    ├── rpc-runner.ts     # Persistent RPC session manager (pi --mode rpc)
    ├── runner.ts         # Stateless subprocess runner (pi -p --no-session)
    └── typing.ts         # Typing indicator manager
```

## Architecture

- **Event bus only** — no direct imports between extensions. All communication via `channel:send`, `channel:receive`, `channel:register`, etc.
- **Adapter pattern** — adapters implement `ChannelAdapter` interface (send, start, stop, sendTyping)
- **Bridge modes:**
  - `persistent: true` (default) — each sender gets a `pi --mode rpc` subprocess with conversation memory
  - `persistent: false` — each message spawns an isolated `pi -p --no-session` subprocess
- **Per-sender serialization** — one prompt at a time per sender, FIFO queue, concurrent across senders
- **No console.log** — use the logger module

## Conventions

- TypeScript strict mode
- No direct imports between extensions — all via event bus
- Config lives in settings.json under `"pi-channels"` key
- Use `"env:VAR_NAME"` for secrets in config

## Key Files

- `package.json` — dependencies, scripts
- `tsconfig.json` — TypeScript config
- `README.md` — Full documentation with config reference
