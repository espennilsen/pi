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

## ⚠️ Inbound A2A: Respond Directly — Never Call `a2a_send` Back to the Caller

This is the most important rule for A2A agent behaviour:

**When your agent receives an inbound A2A request, respond by completing your turn. Do NOT call `a2a_send` to send a reply back to the requester.**

### Why

Inbound A2A tasks work via the task lifecycle, not message passing:

1. The remote caller sends `message/send` → your agent ACKs with `state: working`
2. Your agent processes the request (your turn runs)
3. The result is stored in the SQLite TaskStore automatically on turn completion
4. The remote caller polls `tasks/get` (or SSE) and retrieves the result

If you call `a2a_send` back to the caller mid-task:
- The caller's loop-guard fires (cycle detection: it's already in `visitedAgents`)
- The call fails with a `Loop control` error
- You've wasted a round-trip and confused the protocol state

### What to do instead

| Situation | Correct approach |
|-----------|------------------|
| Normal reply | Just complete your turn. Your final message is stored as the task result. |
| Need more info | Use `a2a_request_input` — it pauses the task and asks the caller via the `input-required` state |
| Sending to a *different* agent | `a2a_send` is fine — just not back to the requester |

### Runtime detection

The extension emits a `⚠️ A2A anti-pattern` warning in the chat if it detects an `a2a_send` call targeting the same URL as the agent that sent the current inbound task. Heed the warning and abort the send.

---

## Key Design Decisions

- **@a2a-js/sdk v0.3.10 integration** — Uses the SDK's `DefaultRequestHandler`, `JsonRpcTransportHandler`, `SQLiteTaskStore`, `InMemoryPushNotificationStore`, and `DefaultPushNotificationSender` for spec-compliant A2A protocol handling. The extension implements the `AgentExecutor` interface with pi-specific main-process delegation.
- **Async-first task lifecycle** — Inbound: the executor ACKs with "working" immediately (unblocking the HTTP response), then processes in the background. On completion, results are saved directly to the SQLite TaskStore (artifact + completed/failed status). Outbound: `a2a_send` sends with `blocking: false` (fire-and-forget), gets back a taskId, then polls `tasks/get` every 5s until completed/failed/timeout. A sliding-window rate limiter (10 triggers/60s) prevents response injection storms. No result messages are sent back — this eliminates bidirectional loops.
- **Multi-turn conversations** — `a2a_send` tracks `contextId` and `taskId` per remote agent. Follow-up messages to the same agent automatically continue the previous conversation (reusing contextId/taskId). Use `newConversation: true` to start fresh. Context is in-memory and resets on session restart.
- **Input-required multi-turn** — Full support for the A2A `input-required` task state. **Inbound**: the `a2a_request_input` tool allows the agent to pause mid-turn and ask the caller for more information. The tool's `execute()` parks on a promise; when the follow-up `message/send` arrives with the same taskId, the executor bypasses the serial queue, resolves the parked promise, and the agent turn continues with full context. **Outbound**: when polling sees `input-required`, the question is injected into the local chat (triggering a turn), the agent's response is captured, and a follow-up is sent automatically. Configurable via `inputRequiredTimeoutMs` (default 10min) and `maxInputRounds` (default 5).
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

Key fields: `port` (default 3100), `bind` (default "127.0.0.1"), `apiKey`, `publicUrl`, `name`, `description`, `version`, `organization`, `iconUrl` (URL to agent icon for hub/discovery UIs), `documentationUrl` (URL to agent documentation), `skills[]`, `maxHops` (default 10 — loop control hop limit), `taskTtlMs` (default 86400000/24h — task expiry TTL, 0 to disable), `inputRequiredTimeoutMs` (default 600000/10min — how long to wait for follow-up input), `maxInputRounds` (default 5 — max input-required rounds per task), `hub` (url, apiKey, categories, tags, visibility, autoRegister), `staticAgents[]` (name, url, apiKey, description).

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
- `message/send` — Message processing via main agent process (supports input-required multi-turn)
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
