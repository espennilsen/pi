---
name: pi-web-dashboard
description: Live agent dashboard for pi — SSE event stream, prompt submission, and agent status via pi-webserver
---

## Overview

Web dashboard extension that streams live agent activity to a browser UI. Mounts routes on pi-webserver, forwards pi lifecycle events over Server-Sent Events, and accepts prompts via a rate-limited HTTP endpoint.

**Stack:** TypeScript · Node.js `http` · SSE · pi-webserver event bus

## Architecture

- `src/index.ts` — Extension entry point. Subscribes to pi events (`agent_start/end`, `turn_start/end`, `tool_call`, `tool_result`) and calls `broadcast()`. Mounts/unmounts on `web:ready` and `session_start`. Unmounts on `session_shutdown`.
- `src/web.ts` — All HTTP logic: SSE client registry, rate limiter, `handlePage()`, `handleApi()`, `mountDashboard()`, `unmountDashboard()`.
- `src/logger.ts` — Thin log helper that emits to `log` event with channel `"dashboard"`.
- `dashboard.html` — Self-contained UI (vanilla JS + inline CSS). Read from disk at module load with `fs.readFileSync`. No build step.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard` | Serves `dashboard.html` |
| GET | `/api/dashboard/events` | SSE stream (`text/event-stream`) |
| POST | `/api/dashboard/prompt` | Submit a prompt to the agent |
| GET | `/api/dashboard/config` | Returns `{ sseClients, time }` |

## SSE Event Types

```ts
{ type: "connected", time }
{ type: "agent_start", time }
{ type: "agent_end", time }
{ type: "turn_start", turn }
{ type: "turn_end", turn, text?, toolResults }  // text = assistant markdown
{ type: "tool_start", toolName, toolCallId }
{ type: "tool_end", toolName, isError, preview? } // preview truncated to 200 chars
```

## Prompt Submission

`POST /api/dashboard/prompt` with `{ "prompt": "..." }`. Rate-limited to 10 requests/minute per IP. Calls `_pi.sendUserMessage(prompt)`. Returns 202 immediately; response arrives over SSE.

## Integration Points

| Extension | Integration | Mechanism |
|-----------|------------|-----------|
| **pi-webserver** | Page + API mounts | `web:mount`, `web:mount-api`, `web:unmount`, `web:unmount-api`, `web:ready` |
| **pi-logger** | Structured logging | `log` event |

## Key Patterns

- **Module-level SSE registry** — `sseClients: Set<ServerResponse>` in `web.ts`. `broadcast()` iterates and swallows write errors.
- **`_pi` reference** — `mountDashboard()` captures the `ExtensionAPI` instance; cleared on `unmountDashboard()`.
- **Rate limiter** — Simple sliding window (`RateLimiter` class) keyed by `req.socket.remoteAddress`.
- **HTML from disk** — `dashboard.html` read once at import time via `fs.readFileSync`. Edit the file directly to change the UI.
- **No DB, no state persistence** — All state is in-memory; clears on shutdown.
