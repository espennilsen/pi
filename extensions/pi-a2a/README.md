# pi-a2a

A2A (Agent-to-Agent) protocol extension for [Pi](https://github.com/mariozechner/pi-coding-agent). Makes your Pi agent discoverable and callable by other A2A-compliant agents.

## What It Does

- **Serves an A2A Agent Card** at `/.well-known/agent.json` — the standard way for other agents to discover your capabilities
- **Handles A2A JSON-RPC 2.0 requests** — other agents can send messages and get responses
- **Runs its own HTTP server** — fully self-contained, no dependency on pi-webserver or other extensions
- **Optional hub registration** — register with an [A2A Discovery Hub](https://github.com/a2aproject/A2A) for centralized discovery

## Quick Start

1. Install the extension:
   ```bash
   pi -e extensions/pi-a2a
   ```

2. The A2A server starts automatically on port 3100. Verify:
   ```bash
   curl http://localhost:3100/.well-known/agent.json
   ```

3. Send a message:
   ```bash
   curl -X POST http://localhost:3100/ \
     -H 'Content-Type: application/json' \
     -d '{
       "jsonrpc": "2.0",
       "method": "message/send",
       "params": {
         "message": {
           "role": "user",
           "parts": [{"type": "text", "text": "What files are in the current directory?"}]
         }
       },
       "id": 1
     }'
   ```

## Configuration

Add to `~/.pi/agent/settings.json`:

```json
{
  "pi-a2a": {
    "port": 3100,
    "publicUrl": "http://localhost:3100",
    "name": "Pi Agent",
    "description": "Personal AI coding agent",
    "version": "1.0.0",
    "organization": "e9n",
    "contactEmail": "hi@e9n.dev",
    "skills": [
      {
        "id": "coding",
        "name": "Coding",
        "description": "Write, edit, and debug code across languages"
      }
    ],
    "hub": {
      "url": "http://localhost:3001/api",
      "apiKey": "your-hub-api-key",
      "categories": ["development-tools"],
      "tags": ["coding", "agent"],
      "visibility": "public",
      "autoRegister": true
    }
  }
}
```

### Config Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `port` | number | `3100` | HTTP server port |
| `publicUrl` | string | `http://localhost:{port}` | Public-facing URL for the Agent Card |
| `name` | string | `"Pi Agent"` | Agent display name |
| `description` | string | — | Agent description |
| `version` | string | `"1.0.0"` | Agent version |
| `organization` | string | `"Pi"` | Provider organization |
| `contactEmail` | string | — | Contact email |
| `website` | string | — | Website URL |
| `skills` | array | default set | Skills to advertise |
| `hub` | object | — | Hub registration config (see below) |

### Hub Config

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `hub.url` | string | — | Hub API base URL |
| `hub.apiKey` | string | — | Hub API key |
| `hub.categories` | string[] | `["development-tools"]` | Registration categories |
| `hub.tags` | string[] | `[]` | Freeform tags |
| `hub.visibility` | string | `"public"` | `public`, `unlisted`, or `private` |
| `hub.autoRegister` | boolean | `true` | Auto-register on session start |

## Commands

| Command | Description |
|---------|-------------|
| `/a2a status` | Show server status and Agent Card URL |
| `/a2a register` | Manually register with the configured A2A Hub |

## A2A Protocol Methods

| Method | Description |
|--------|-------------|
| `message/send` | Send a message, get a completed task with the agent's response |
| `tasks/get` | Get a task by ID |
| `tasks/cancel` | Cancel a running task |

## How It Works

1. On session start, pi-a2a launches an HTTP server on the configured port
2. It serves an A2A Agent Card describing Pi's capabilities
3. When a `message/send` request arrives, it spawns an isolated `pi --mode rpc` subprocess
4. The subprocess processes the prompt and streams text deltas back
5. The collected response is returned as a completed A2A task
6. If hub config is present, it registers with the A2A Discovery Hub on startup

## License

MIT
