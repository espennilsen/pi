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
    "host": "127.0.0.1",
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
| `host` | string | `"127.0.0.1"` | Bind interface for autostart, manual start and port changes (e.g. `::1`, a LAN IP, `0.0.0.0` or `::`) |
| `auth` | string \| null | `null` | Basic auth — `"password"` or `"user:password"` |
| `apiToken` | string \| null | `null` | Bearer token for full API access (all methods) |
| `apiReadToken` | string \| null | `null` | Bearer token for read-only API access (GET/HEAD) |

### Remote access and transport security

The default listener is loopback-only. To allow another computer to connect, explicitly set `host` to the server's LAN IP, or use `0.0.0.0` (all IPv4 interfaces) / `::` (all IPv6 interfaces; dual-stack behavior depends on the OS).

**The server speaks plain HTTP, not HTTPS.** Non-loopback startup emits a warning: Basic credentials, bearer tokens and session cookies can be exposed without transport encryption. Use an HTTPS reverse proxy with a protected backend (preferably loopback) or an encrypted tunnel, and restrict network access. Authentication is not encryption; a private LAN alone does not guarantee confidentiality. TLS enforcement, CIDR allowlists and additional authentication policy are not implemented here.

Authentication remains optional, including for explicitly configured remote listeners. With no authentication configured, reachable clients can access the dashboard and mounted routes unless an individual extension supplies its own protection. This is a deliberate deployment-policy choice, not an access-control safeguard; the operator accepts responsibility for network reachability and protection. Neither a configured host nor a startup warning provides authentication or encryption.

IPv6 URLs use brackets, for example `http://[::1]:4100`. Wildcard listeners advertise a same-machine URL (`127.0.0.1` for `0.0.0.0`, `[::1]` for `::`); remote clients must replace that loopback address with the server's reachable address. OAuth redirect URIs must match the origin used by the integration; wildcard binding does not discover an external proxy origin.

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
| `web:info` | → webserver replies synchronously when listening | `{ reply: ({ port, url }) => void }` |
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
