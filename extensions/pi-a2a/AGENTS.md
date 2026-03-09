---
name: pi-a2a
description: A2A protocol extension — full A2A v0.3.0 server with streaming, push notifications, task lifecycle, and optional hub registration
---

## Overview

pi-a2a makes Pi a fully compliant A2A (Agent-to-Agent) protocol v0.3.0 server. It runs its own HTTP server (no dependency on pi-webserver or other extensions), serves an Agent Card at `/.well-known/agent-card.json`, handles JSON-RPC 2.0 requests via the `@a2a-js/sdk`, and optionally registers with an A2A Discovery Hub.

## Architecture

```
src/
├── index.ts          # Extension entry point — lifecycle, commands, SDK wiring
├── types.ts          # Extension config types (A2A protocol types from SDK)
├── config.ts         # Settings.json loader via SettingsManager
├── logger.ts         # Structured logger via pi-logger event bus
├── agent-card.ts     # Agent Card builder from config, dynamic tool enrichment
├── agent-executor.ts # AgentExecutor implementation — spawns pi subprocesses
├── server.ts         # Self-contained HTTP server (node:http) + SDK RPC handler
├── static-agents.ts  # Static agent registry — fetch/cache remote agent cards
├── subprocess.ts     # Isolated pi subprocess runner (pi --mode rpc)
└── hub.ts            # A2A Hub registration client
```

## Key Design Decisions

- **@a2a-js/sdk v0.3.10 integration** — Uses the SDK's `DefaultRequestHandler`, `JsonRpcTransportHandler`, `InMemoryTaskStore`, `InMemoryPushNotificationStore`, and `DefaultPushNotificationSender` for spec-compliant A2A protocol handling. The extension implements the `AgentExecutor` interface with pi-specific subprocess logic.
- **Full task lifecycle** — The executor follows the SDK's canonical pattern: publish initial Task (submitted) → status-update (working) → artifact-update → status-update (completed, final=true) → finished. This ensures `tasks/get` returns proper state and streaming/push notifications work.
- **Streaming support** — Capabilities declare `streaming: true`. The SDK's `sendMessageStream` returns an `AsyncGenerator`; the HTTP server detects this and responds with SSE (`text/event-stream`).
- **Push notifications** — Capabilities declare `pushNotifications: true`. `InMemoryPushNotificationStore` and `DefaultPushNotificationSender` are wired into the `DefaultRequestHandler`, enabling clients to register webhook URLs for async task updates.
- **Self-contained HTTP server** — Uses `node:http` directly. No dependency on pi-webserver, pi-kysely, or any other extension. Binds to `127.0.0.1` by default; optional API key auth for external access.
- **Dynamic agent card** — Starts with a basic card from config, then enriches it with registered extension tools after all extensions load. Uses a two-phase approach: `queueMicrotask` after `session_start` catches most tools, `agent_start` catches stragglers.
- **Subprocess isolation** — Each `message/send` spawns a fresh `pi --mode rpc -ne` process. No shared state, no extension leakage. Cancellation kills the subprocess via `AbortController`.
- **Settings-driven** — All config via `pi-a2a` key in settings.json. No env vars.
- **Static agent registry** — Manually configured remote agents in `staticAgents[]`. Agent cards are fetched from `/.well-known/agent-card.json` on session start and cached in memory. No hub required. Refresh via `/a2a agents refresh` command. Static agents are resolved first in `a2a_send`, before hub lookup.

## Config

Settings key: `pi-a2a` in `~/.pi/agent/settings.json` or `.pi/settings.json`.

Key fields: `port` (default 3100), `bind` (default "127.0.0.1"), `apiKey`, `publicUrl`, `name`, `description`, `version`, `organization`, `skills[]`, `hub` (url, apiKey, categories, tags, visibility, autoRegister), `staticAgents[]` (name, url, apiKey, description).

### Static Agents (no hub required)

Configure remote agents manually when you don't want to use a hub:

```json
{
  "pi-a2a": {
    "staticAgents": [
      {
        "name": "My Other Agent",
        "url": "http://192.168.1.50:3100",
        "apiKey": "secret-key",
        "description": "Agent on my local network"
      }
    ]
  }
}
```

Agent cards are fetched at session start and cached in memory. Use `/a2a agents refresh` to re-fetch. Static agents appear in `a2a_discover` results and can be targeted by name in `a2a_send`.

## A2A Protocol Compliance

Implements A2A Protocol Specification v0.3.0 via @a2a-js/sdk v0.3.10.

### Supported methods (via DefaultRequestHandler):
- `message/send` — Synchronous message processing via subprocess
- `message/send` (streaming) — SSE streaming with real-time status/artifact updates
- `tasks/get` — Task retrieval by ID with history
- `tasks/cancel` — Task cancellation with subprocess kill
- `tasks/pushNotificationConfig/set` — Register push notification webhook
- `tasks/pushNotificationConfig/get` — Retrieve push notification config
- `tasks/pushNotificationConfig/list` — List all push notification configs
- `tasks/pushNotificationConfig/delete` — Remove push notification config
- `tasks/resubscribe` — Re-subscribe to task SSE stream

### Agent Card features:
- Served at `GET /.well-known/agent-card.json` (canonical) and `GET /.well-known/agent.json` (compat)
- Declares `additionalInterfaces` with JSON-RPC transport URL
- Declares `securitySchemes` when API key is configured
- Protocol version: `0.3.0`

## Hub Integration

When `hub` config is present with a valid `apiKey`, the extension calls `agents.register` on the hub's JSON-RPC API at session start. Sends the full A2A-compliant agent card with all capabilities, skills (including tags and examples), and interfaces. The hub API follows the pattern: `POST {hub.url}/rpc` with `Authorization: Bearer {apiKey}`.
