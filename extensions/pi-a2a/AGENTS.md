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
├── agent-executor.ts # AgentExecutor — inline main-process delegation + TaskStore persistence
├── supervisor.ts     # Loop control supervisor — cycle detection, hop limits, budget enforcement
├── task-store.ts     # SQLite-backed TaskStore (persistent tasks, WAL mode)
├── server.ts         # Self-contained HTTP server (node:http) + SDK RPC handler
├── client.ts         # Outbound A2A messaging via SDK Client
├── static-agents.ts  # Static agent registry — fetch/cache remote agent cards
├── subprocess.ts     # Isolated pi subprocess runner (pi --mode rpc)
└── hub.ts            # A2A Hub registration client
```

## Key Design Decisions

- **@a2a-js/sdk v0.3.10 integration** — Uses the SDK's `DefaultRequestHandler`, `JsonRpcTransportHandler`, `SQLiteTaskStore`, `InMemoryPushNotificationStore`, and `DefaultPushNotificationSender` for spec-compliant A2A protocol handling. The extension implements the `AgentExecutor` interface with pi-specific main-process delegation.
- **Async-first task lifecycle** — Inbound: the executor ACKs with "working" immediately (unblocking the HTTP response), then processes in the background. On completion, results are saved directly to the SQLite TaskStore (artifact + completed/failed status). Outbound: `a2a_send` sends with `blocking: false` (fire-and-forget), gets back a taskId, then polls `tasks/get` every 5s until completed/failed/timeout. A sliding-window rate limiter (10 triggers/60s) prevents response injection storms. No result messages are sent back — this eliminates bidirectional loops.
- **Persistent SQLite TaskStore** — Tasks survive restarts. Schema: `a2a_tasks` with extracted `status`, `hop_count`, and `visited_agents` columns for efficient querying and loop control. WAL mode for concurrent reads during processing. DB at `{agentDir}/db/a2a.db`.
- **Loop control supervisor** — Prevents infinite A2A loops (A→B→A→B...) via spec-compliant metadata under `pi:` prefix. The supervisor runs before `execute()` and checks: (1) cycle detection — rejects if this agent already appears in `pi:visitedAgents`, (2) hop count — rejects if `pi:hopCount` exceeds `maxHops` (configurable, default 10). Metadata propagates on outbound messages so downstream agents inherit the chain. Pure-function design in `supervisor.ts` — testable and independent of the executor.
- **Streaming support** — Capabilities declare `streaming: true`. The SDK's `sendMessageStream` returns an `AsyncGenerator`; the HTTP server detects this and responds with SSE (`text/event-stream`).
- **Push notifications** — Capabilities declare `pushNotifications: true`. `SQLitePushNotificationStore` (persistent, shares DB with TaskStore) and `DefaultPushNotificationSender` are wired into the `DefaultRequestHandler`, enabling clients to register webhook URLs for async task updates. Push configs survive restarts.
- **Task expiry** — Periodic cleanup (every 5 minutes) prunes tasks older than `taskTtlMs` (default 24 hours). Configurable via settings; set to 0 to disable.
- **Self-contained HTTP server** — Uses `node:http` directly. No dependency on pi-webserver, pi-kysely, or any other extension. Binds to `127.0.0.1` by default; optional API key auth for external access.
- **Dynamic agent card** — Starts with a basic card from config, then enriches it with registered extension tools after all extensions load. Uses a two-phase approach: `queueMicrotask` after `session_start` catches most tools, `agent_start` catches stragglers.
- **Inline main-process delegation** — Incoming A2A messages are injected into the main pi conversation via `pi.sendMessage({ triggerTurn: true })`. Full TUI visibility — tool calls, file edits, thinking — all visible in the chat. Serial queue (max 1 concurrent), additional requests queued in arrival order.
- **Settings-driven** — All config via `pi-a2a` key in settings.json. No env vars.
- **Static agent registry** — Manually configured remote agents in `staticAgents[]`. Agent cards are fetched from `/.well-known/agent-card.json` on session start and cached in memory. No hub required. Refresh via `/a2a agents refresh` command. Static agents are resolved first in `a2a_send`, before hub lookup.

## Config

Settings key: `pi-a2a` in `~/.pi/agent/settings.json` or `.pi/settings.json`.

Key fields: `port` (default 3100), `bind` (default "127.0.0.1"), `apiKey`, `publicUrl`, `name`, `description`, `version`, `organization`, `skills[]`, `maxHops` (default 10 — loop control hop limit), `taskTtlMs` (default 86400000/24h — task expiry TTL, 0 to disable), `hub` (url, apiKey, categories, tags, visibility, autoRegister), `staticAgents[]` (name, url, apiKey, description).

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
