# @e9n/pi-webserver

Shared HTTP server for [pi](https://github.com/mariozechner/pi-coding-agent) — one port, shared auth, and an event-bus mount system that other extensions plug into.

## Features

- **Single shared port** — all extensions serve from one HTTP server (default `4100`)
- **Basic auth** — protects page routes with HTTP Basic authentication
- **API bearer token auth** — separate full-access and read-only tokens for `/api/*` routes
- **Cookie session auth** — browser-friendly login page for API-token-only setups
- **Prefix routing** — longest-prefix match; prefix is stripped before calling the handler
- **Event bus mounting** — extensions mount via `pi.events.emit("web:mount", ...)` without importing
- **Built-in dashboard** — `/` lists all registered mounts with links
- **Autostart** — optionally start on session init via settings

## Setup / Settings

Add to `~/.pi/agent/settings.json` (project overrides in `<project>/.pi/settings.json`):

```json
{
  "pi-webserver": {
    "autostart": true,
    "port": 4100,
    "auth": "mypassword",
    "apiToken": "my-secret-token",
    "apiReadToken": "my-read-token"
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `autostart` | boolean | `false` | Start the server automatically on session start |
| `port` | number | `4100` | HTTP port |
| `auth` | string \| null | `null` | Basic auth — `"password"` or `"user:password"` |
| `apiToken` | string \| null | `null` | Bearer token for full API access (all methods) |
| `apiReadToken` | string \| null | `null` | Bearer token for read-only API access (GET/HEAD) |

## Commands

| Command | Description |
|---------|-------------|
| `/web` | Start on port 4100, or stop if already running |
| `/web <port>` | Start on a specific port |
| `/web stop` | Stop the server |
| `/web status` | Show URL, auth status, and all mounts |
| `/web port [number]` | Show or change the current port |
| `/web auth <password>` | Enable Basic auth (username: `pi`) |
| `/web auth <user:pass>` | Enable Basic auth with custom username |
| `/web auth off` | Disable Basic auth |
| `/web api <token>` | Set bearer token for full API access |
| `/web api read <token>` | Set read-only bearer token (GET/HEAD only) |
| `/web api off` | Disable API token auth |
| `/web api` | Show API token status and mounted API routes |

## Web UI

| Route | Description |
|-------|-------------|
| `/` | Dashboard listing all registered mounts |
| `/_api/mounts` | JSON: all mounts (Basic auth) |
| `/_api/mounts/dashboard` | JSON: non-API mounts (for nav shells) |
| `/_auth/login` | Browser login page (when only API tokens are set) |
| `/_auth/logout` | Clear session cookie |
| `/api/*` | API routes — Bearer token auth (or open if no token set) |

## For extension authors

Mount a page route via the event bus (no import needed):

```typescript
export default function (pi: ExtensionAPI) {
  pi.events.on("web:ready", () => {
    pi.events.emit("web:mount", {
      name: "my-ext",
      label: "My Extension",
      description: "Does cool things",
      prefix: "/my-ext",
      handler: (req, res, subPath) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Hello</h1>");
      },
    });
  });
}
```

Mount an API route under `/api/*`:

```typescript
pi.events.emit("web:mount-api", {
  name: "my-ext-api",
  label: "My Extension API",
  prefix: "/my-ext",           // mounts at /api/my-ext
  handler: (req, res, subPath) => { ... },
});
```

### Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `web:ready` | ← emitted by webserver on session start | `{}` |
| `web:mount` | → webserver listens | `MountConfig` |
| `web:unmount` | → webserver listens | `{ name: string }` |
| `web:mount-api` | → webserver listens | `MountConfig` |
| `web:unmount-api` | → webserver listens | `{ name: string }` |

## Install

```bash
pi install npm:@e9n/pi-webserver
```

## License

MIT
