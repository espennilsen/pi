# pi-web-dashboard

Live agent dashboard with SSE streaming, telemetry stats, and prompt submission for pi.

## Features

- **Stats grid** — Jobs, errors, tokens, cost, tool calls, avg duration (from pi-jobs)
- **Live stream** — Watch agent activity in real-time via SSE (turns, tool calls, responses)
- **Prompt submission** — Send prompts to the agent from the browser
- **Events feed** — Recent jobs with status, channel, and cost (from pi-jobs)
- **Model breakdown** — Which models are used, token counts, and costs
- **Tool breakdown** — Tool call frequency, error rates, average execution time
- **SSE connection status** — Live indicator with connected/disconnected/busy states + uptime

## Dependencies

- **pi-webserver** — Provides the shared HTTP server and mount system
- **pi-jobs** (optional) — Provides stats, events, model and tool breakdowns. Dashboard degrades gracefully if pi-jobs is not loaded.

## Routes

Mounts on pi-webserver:

| Route | Method | Description |
|-------|--------|-------------|
| `/dashboard` | GET | Dashboard UI |
| `/api/dashboard/events` | GET | SSE event stream |
| `/api/dashboard/prompt` | POST | Submit a prompt (`{ "prompt": "..." }`) |
| `/api/dashboard/config` | GET | Status info |

Also reads from pi-jobs API (if available):

| Route | Description |
|-------|-------------|
| `/api/jobs/stats` | Totals (jobs, errors, tokens, cost) |
| `/api/jobs/recent` | Recent jobs for events feed |
| `/api/jobs/models` | Model usage breakdown |
| `/api/jobs/tools` | Tool call breakdown |

## Usage

Place in `~/.pi/agent/extensions/pi-web-dashboard/` and start pi with `/web`.

Navigate to `http://localhost:4100/dashboard` (or whatever port pi-webserver uses).

## Events streamed via SSE

| Event | Fields | Description |
|-------|--------|-------------|
| `connected` | `time` | Initial connection |
| `agent_start` | `time` | Agent loop started |
| `agent_end` | `time` | Agent loop finished |
| `turn_start` | `turn` | New turn began |
| `turn_end` | `turn`, `text`, `toolResults` | Turn finished with response text |
| `tool_start` | `toolName`, `toolCallId` | Tool execution started |
| `tool_end` | `toolName`, `isError`, `preview` | Tool execution finished |

## Rate Limits

Prompt endpoint: 10 requests per minute per IP.

## Auto-refresh

- Stats, events, models, tools: every 15 seconds
- SSE uptime counter: every second
- Stats also refresh immediately when an `agent_end` event is received
