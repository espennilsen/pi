---
name: pi-a2a
description: A2A protocol extension — self-contained server for agent-to-agent communication with optional hub registration
---

## Overview

pi-a2a makes Pi a compliant A2A (Agent-to-Agent) protocol server. It runs its own HTTP server (no dependency on pi-webserver or other extensions), serves an Agent Card at `/.well-known/agent.json`, handles JSON-RPC 2.0 requests via the `@a2a-js/sdk`, and optionally registers with an A2A Discovery Hub.

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
├── subprocess.ts     # Isolated pi subprocess runner (pi --mode rpc)
└── hub.ts            # A2A Hub registration client
```

## Key Design Decisions

- **@a2a-js/sdk integration** — Uses the SDK's `DefaultRequestHandler`, `JsonRpcTransportHandler`, and `InMemoryTaskStore` for spec-compliant A2A protocol handling. The extension implements the `AgentExecutor` interface with pi-specific subprocess logic.
- **Self-contained HTTP server** — Uses `node:http` directly. No dependency on pi-webserver, pi-kysely, or any other extension. Binds to `127.0.0.1` by default; optional API key auth for external access.
- **Dynamic agent card** — Starts with a basic card from config, then enriches it with registered extension tools after all extensions load. Uses a two-phase approach: `queueMicrotask` after `session_start` catches most tools, `agent_start` catches stragglers.
- **Subprocess isolation** — Each `message/send` spawns a fresh `pi --mode rpc -ne` process. No shared state, no extension leakage. Cancellation kills the subprocess via `AbortController`.
- **Settings-driven** — All config via `pi-a2a` key in settings.json. No env vars.

## Config

Settings key: `pi-a2a` in `~/.pi/agent/settings.json` or `.pi/settings.json`.

Key fields: `port` (default 3100), `bind` (default "127.0.0.1"), `apiKey`, `publicUrl`, `name`, `description`, `version`, `organization`, `skills[]`, `hub` (url, apiKey, categories, tags, visibility, autoRegister).

## A2A Protocol Compliance

Uses @a2a-js/sdk v0.3.10 for protocol handling. Implements A2A spec methods:
- `message/send` — Synchronous message processing via subprocess
- `tasks/get` — Task retrieval by ID
- `tasks/cancel` — Task cancellation with subprocess kill

Agent Card served at both `GET /.well-known/agent.json` and `GET /.well-known/agent-card.json` per A2A discovery conventions.

## Hub Integration

When `hub` config is present with a valid `apiKey`, the extension calls `agents.register` on the hub's JSON-RPC API at session start. The hub API follows the pattern: `POST {hub.url}/rpc` with `Authorization: Bearer {apiKey}`.
