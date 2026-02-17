# @e9n/pi-web-dashboard

Live agent dashboard with SSE streaming for [pi](https://github.com/mariozechner/pi-coding-agent) — watch agent activity in real-time and submit prompts from the browser.

## Features

- **Live event stream** — SSE feed of agent lifecycle events (start/end, turns, tool calls, responses)
- **Prompt submission** — send prompts to the agent from the browser (rate-limited: 10/min per IP)
- **Status endpoint** — check SSE client count and server time
- **Auto-cleanup** — closes all SSE connections on shutdown
- **Requires [pi-webserver](../pi-webserver)** — mounts automatically when pi-webserver is ready

## Web UI

Mounts on pi-webserver at session start (listens for `web:ready`):

| Route | Method | Description |
|-------|--------|-------------|
| `/dashboard` | GET | Dashboard HTML (`dashboard.html`) |
| `/api/dashboard/events` | GET | SSE event stream |
| `/api/dashboard/prompt` | POST | Submit a prompt `{ "prompt": "..." }` |
| `/api/dashboard/config` | GET | Status: SSE client count, server time |

### SSE events

| Event type | Fields | Description |
|------------|--------|-------------|
| `connected` | `time` | Initial connection handshake |
| `agent_start` | `time` | Agent loop started |
| `agent_end` | `time` | Agent loop finished |
| `turn_start` | `turn` | New turn began |
| `turn_end` | `turn`, `text`, `toolResults` | Turn completed with response text |
| `tool_start` | `toolName`, `toolCallId` | Tool execution started |
| `tool_end` | `toolName`, `isError`, `preview` | Tool execution finished (first 200 chars of output) |

## Install

```bash
pi install npm:@e9n/pi-web-dashboard
```

## License

MIT
