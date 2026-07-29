# pi-a2a

A2A (Agent-to-Agent) protocol v0.3.0 extension for [Pi](https://github.com/mariozechner/pi-coding-agent). Makes your Pi agent discoverable and callable by other A2A-compliant agents.

## What It Does

- **Full A2A v0.3.0 compliance** via [@a2a-js/sdk](https://github.com/a2aproject/a2a-js) — streaming, push notifications, task lifecycle
- **Serves an A2A Agent Card** at `/.well-known/agent-card.json` — the standard way for other agents to discover your capabilities
- **Handles A2A JSON-RPC 2.0 requests** — other agents can send messages and get responses
- **SSE streaming** — real-time task status and artifact updates
- **Push notifications** — async webhook-based task update delivery
- **Runs its own HTTP server** — fully self-contained, no dependency on pi-webserver
- **Optional hub registration** — register with an A2A Discovery Hub for centralized discovery

## Quick Start

1. Install the extension:
   ```bash
   pi -e extensions/pi-a2a
   ```

2. The A2A server starts automatically on port 3100. Verify:
   ```bash
   curl http://localhost:3100/.well-known/agent-card.json
   ```

3. Send a message (JSON-RPC):
   ```bash
   curl -X POST http://localhost:3100/ \
     -H 'Content-Type: application/json' \
     -d '{
       "jsonrpc": "2.0",
       "method": "message/send",
       "params": {
         "message": {
           "kind": "message",
           "messageId": "msg-1",
           "role": "user",
           "parts": [{"kind": "text", "text": "What files are in the current directory?"}]
         }
       },
       "id": 1
     }'
   ```

4. Stream a response (SSE):
   ```bash
   curl -X POST http://localhost:3100/ \
     -H 'Content-Type: application/json' \
     -d '{
       "jsonrpc": "2.0",
       "method": "message/stream",
       "params": {
         "message": {
           "kind": "message",
           "messageId": "msg-2",
           "role": "user",
           "parts": [{"kind": "text", "text": "Run the test suite"}]
         }
       },
       "id": 2
     }'
   ```

## Configuration

Add to `~/.pi/agent/settings.json`:

```json
{
  "pi-a2a": {
    "port": 3100,
    "name": "Pi Agent",
    "description": "Personal AI coding agent",
    "version": "1.0.0",
    "organization": "e9n",
    "owner": "Espen Nilsen <hi@e9n.dev>",
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

### Examples

**Localhost only (default):**

```json
{}
```

Server binds to `127.0.0.1:3100`, publicUrl auto-generates as `http://localhost:3100`.

**LAN access (auto-detects IP):**

```json
{
  "pi-a2a": {
    "bind": "0.0.0.0",
    "apiKey": "lan-secret"
  }
}
```

Server binds to all interfaces, publicUrl auto-detects primary IP (e.g., `http://192.168.1.100:3100`).

If you configure an external bind together with `hub.url` and omit `local.apiKey`, pi-a2a auto-generates a local API key automatically.
If you configure an external bind without a hub, set `local.requireApiKey: true` to auto-generate one and use `/a2a apikey` to view it later.

**LAN access (specific interface):**

```json
{
  "pi-a2a": {
    "bindInterface": "en1"
  }
}
```

Server binds to en1's IP and advertises it (e.g., binds to `192.168.50.25:3100`, advertises `http://192.168.50.25:3100`). Useful for multi-homed machines to control which interface is used.

**Reverse proxy:**

```json
{
  "pi-a2a": {
    "bind": "127.0.0.1",
    "publicUrl": "https://agent.mydomain.com"
  }
}
```

Server binds to localhost, but advertises external URL for reverse proxy setups.

### Config Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `port` | number | `3100` | HTTP server port |
| `bind` | string | `"127.0.0.1"` | Bind address (`"0.0.0.0"` for external access) |
| `bindInterface` | string | — | Network interface name or IP to bind to and advertise (e.g., `"en0"`, `"eth0"`, `"192.168.1.100"`). When set, the server binds to this interface's IP and uses it for the publicUrl. Overrides `bind`. |
| `apiKey` | string | — | API key for Bearer auth (required for external access) |
| `publicUrl` | string | auto-detected | Public-facing URL for the Agent Card. Auto-detects primary IP when `bind: "0.0.0.0"` or `bindInterface` is set. |
| `name` | string | `"Pi Agent"` | Agent display name |
| `description` | string | — | Agent description |
| `version` | string | `"1.0.0"` | Agent version |
| `organization` | string | `"Pi"` | Provider organization |
| `providerUrl` | string | — | Provider website URL |
| `owner` | string | — | Agent owner name or email (displayed in hub UIs and agent discovery) |
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

### Lease-aware Hub RPCs

pi-a2a now understands the lease-oriented hub contracts:

- `tasks.claim` — atomically claim a specific task or the next eligible task
- `tasks.heartbeat` — renew an active lease for the same `agentId` + `instanceId`
- `agents.reportTelemetry` — accepts optional `instanceId` to help the hub track lease ownership

Both `tasks.claim` and `tasks.heartbeat` accept optional `leaseDurationSeconds` (default 900 seconds; clamped to the 1-86400 second range). `agents.reportTelemetry` may include `instanceId`, but it does not change lease duration limits.

Task payloads include:
- `leaseOwnerAgentId`
- `leaseOwnerInstanceId`
- `leaseExpiresAt`

## Commands

| Command | Description |
|---------|-------------|
| `/a2a status` | Show server status, protocol version, and capabilities |
| `/a2a card` | Print the full Agent Card JSON |
| `/a2a refresh` | Re-discover tools and update the Agent Card |
| `/a2a register` | Manually register with the configured A2A Hub |
| `/a2a apikey` | Show the current effective local API key |

## A2A Protocol Methods

All methods are handled by the SDK's `DefaultRequestHandler`.

| Method | Description |
|--------|-------------|
| `message/send` | Send a message, receive task with response |
| `message/stream` | Send a message, receive SSE stream of task events |
| `tasks/get` | Get a task by ID (with optional history) |
| `tasks/cancel` | Cancel a running task (kills subprocess) |
| `tasks/resubscribe` | Re-subscribe to an active task's SSE stream |
| `tasks/pushNotificationConfig/set` | Register a webhook for task updates |
| `tasks/pushNotificationConfig/get` | Retrieve push notification config |
| `tasks/pushNotificationConfig/list` | List all push notification configs for a task |
| `tasks/pushNotificationConfig/delete` | Remove a push notification config |

## How It Works

1. On session start, pi-a2a launches an HTTP server on the configured port
2. It serves an A2A Agent Card describing Pi's capabilities and transport interfaces
3. When a `message/send` request arrives:
   - Creates a Task (state: `submitted`)
   - Publishes a `working` status update
   - Spawns an isolated `pi --mode rpc` subprocess
   - Publishes an artifact with the response
   - Publishes a `completed` status update (final)
4. For streaming (`message/stream`), the same events are streamed as SSE
5. Push notifications are sent to registered webhooks on each task state change
6. If hub config is present, registers with the A2A Discovery Hub on startup

## Authentication migration

Existing API-key installations need no changes. `local.apiKey`, `hub.apiKey`, and `staticAgents[].apiKey` retain their current `Authorization: Bearer <key>` behavior as the `legacy-api-key` mode.

Enable OAuth incrementally by explicitly opting the local agent in, then let Hub metadata or a peer Agent Card advertise the remote mode and authorization server. Modern modes are never inferred from a Hub URL alone.

```jsonc
{
  "pi-a2a": {
    "local": {
      "apiKey": "optional-legacy-key",
      "auth": {
        "supportedAuthModes": ["legacy-api-key", "oauth2"],
        "preferModern": true,
        "modernOnlySkills": ["deploy-production"],
        "oauth2": { "clientId": "client-id", "clientSecret": "stored-by-settings", "audience": "https://this-agent.example" }
      }
    },
    "staticAgents": [{
      "name": "modern-peer",
      "url": "https://peer.example",
      "auth": {
        "supportedAuthModes": ["oauth2"],
        "authorizationServer": "https://issuer.example/token",
        "resource": "https://peer.example"
      }
    }]
  }
}
```

Static-directory `auth` is an explicit override; otherwise pi-a2a reads only the authentication schemes it recognizes from the peer's Agent Card. A peer with missing or malformed metadata is denied rather than guessed. `preferModern: false` permits legacy only when both peers explicitly support it; `modernOnlySkills` never permit legacy fallback.

For `oauth2+mtls`, configure `local.auth.mtls.certPath` and `keyPath` plus `local.auth.transport.mtls` and `clientCertificate`. Certificate paths are read locally and certificate/key **contents are never logged or published**. mTLS is unavailable when TLS is terminated by an untrusted proxy because pi-a2a cannot verify the peer certificate binding.

Hub operators must expose each peer's supported modes and, for OAuth peers, an authorization-server/token endpoint and resource metadata. The Hub continues to use only `hub.apiKey` for its own API; it must not receive settings.json or OAuth credentials. Agent Cards and environment variables must never contain API keys, client secrets, tokens, or certificate/key content.

## Security

When `apiKey` is configured:
- All JSON-RPC requests require `Authorization: Bearer <apiKey>`
- The Agent Card declares `securitySchemes` with HTTP Bearer auth
- Agent Card endpoints (`/.well-known/agent-card.json`) remain unauthenticated for discovery

When binding to non-localhost (`bind: "0.0.0.0"`), an `apiKey` is strongly recommended.
If `hub.url` is configured, pi-a2a auto-generates a local API key for external binds when one is not explicitly provided.
If no hub is configured, set `pi-a2a.local.requireApiKey: true` to opt into auto-generation for external binds.

## License

MIT
