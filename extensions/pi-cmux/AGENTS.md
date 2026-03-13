---
name: pi-cmux
description: cmux terminal app integration — notifications, pane management, screen reading, and browser automation
---

## Overview

Integrates Pi with the [cmux](https://cmux.dev) macOS terminal app. Communicates via cmux's Unix socket JSON-RPC API at `/tmp/cmux.sock`. Auto-detects cmux via environment variables and no-ops gracefully outside cmux.

## Architecture

```
index.ts          Entry point — detection, lifecycle hooks, commands, shortcuts
client.ts         CmuxClient — Unix socket JSON-RPC client
tools.ts          Agent tools — cmux_list, cmux_split, cmux_read, cmux_send, etc.
logger.ts         Structured logger via pi-logger event bus
```

### Three integration layers:

1. **Passive (lifecycle hooks)**: Pushes notifications and status updates automatically via `agent_start`, `agent_end`, `tool_execution_start/end` hooks. No agent involvement.

2. **Agent tools**: Registers 7 tools so the LLM can drive cmux: `cmux_list`, `cmux_split`, `cmux_read`, `cmux_send`, `cmux_close`, `cmux_notify`, `cmux_browser`.

3. **Skill file**: `SKILL.md` teaches the agent orchestration patterns (dev server + code, parallel tests, sub-agent spawning).

### Detection

cmux injects these env vars into every terminal it spawns:
- `CMUX_WORKSPACE_ID` — current workspace ref
- `CMUX_SURFACE_ID` — current surface (pane) ref
- `CMUX_SOCKET_PATH` — socket path (default: `/tmp/cmux.sock`)

If any are missing or the socket doesn't exist, the extension does nothing.

### Socket protocol

Newline-terminated JSON-RPC over Unix domain socket:
```
→ {"id":"uuid","method":"surface.list","params":{}}\n
← {"id":"uuid","ok":true,"result":{"surfaces":[...]}}\n
```

## Conventions

- All cmux calls in lifecycle hooks are wrapped in `safe()` — never throw/crash from hooks
- Tools throw errors (standard Pi pattern) — the LLM gets structured error feedback
- Socket has 10s RPC timeout and 3s connect timeout
- No dependencies beyond Pi and Node.js built-ins
