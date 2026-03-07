---
name: pi-a2a
description: A2A protocol extension — self-contained server for agent-to-agent communication with optional hub registration
---

## Overview

pi-a2a makes Pi a compliant A2A (Agent-to-Agent) protocol server. It runs its own HTTP server (no dependency on pi-webserver or other extensions), serves an Agent Card at `/.well-known/agent.json`, handles JSON-RPC 2.0 requests, and optionally registers with an A2A Discovery Hub.

## Architecture

```
src/
├── index.ts          # Extension entry point — lifecycle, commands
├── types.ts          # All type definitions (config, A2A protocol, JSON-RPC)
├── config.ts         # Settings.json loader via SettingsManager
├── logger.ts         # Structured logger via pi-logger event bus
├── agent-card.ts     # Agent Card builder from config
├── server.ts         # Self-contained HTTP server (node:http)
├── rpc-handler.ts    # JSON-RPC 2.0 method dispatcher
├── subprocess.ts     # Isolated pi subprocess runner (pi --mode rpc)
├── task-store.ts     # In-memory task store with TTL eviction
└── hub.ts            # A2A Hub registration client
```

## Key Design Decisions

- **Self-contained HTTP server** — Uses `node:http` directly. No dependency on pi-webserver, pi-kysely, or any other extension.
- **Subprocess isolation** — Each `message/send` spawns a fresh `pi --mode rpc -ne` process. No shared state, no extension leakage.
- **In-memory task store** — Tasks expire after 1 hour, max 100. Personal agent = low volume.
- **Settings-driven** — All config via `pi-a2a` key in settings.json. No env vars.

## Config

Settings key: `pi-a2a` in `~/.pi/agent/settings.json` or `.pi/settings.json`.

Key fields: `port` (default 3100), `publicUrl`, `name`, `description`, `version`, `organization`, `skills[]`, `hub` (url, apiKey, categories, tags, visibility, autoRegister).

## A2A Protocol Compliance

Implements A2A spec v1.0 core methods:
- `message/send` — Synchronous message processing via subprocess
- `tasks/get` — Task retrieval by ID  
- `tasks/cancel` — Task cancellation

Agent Card served at `GET /.well-known/agent.json` per A2A discovery convention.

## Hub Integration

When `hub` config is present with a valid `apiKey`, the extension calls `agents.register` on the hub's JSON-RPC API at session start. The hub API follows the pattern: `POST {hub.url}/rpc` with `Authorization: Bearer {apiKey}`.
