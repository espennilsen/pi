# pi-webserver

Shared web server extension for [pi](https://github.com/badlogic/pi-mono) coding agents.

Provides a single HTTP server that other pi extensions can mount route handlers on — one port, one dashboard, shared auth.

## Installation

```bash
pi install git@github.com:espennilsen/pi-webserver.git
```

## Usage

### Commands

| Command | Description |
|---|---|
| `/web` | Start on port 4100 (or stop if already running) |
| `/web <port>` | Start on a specific port |
| `/web stop` | Stop the server |
| `/web status` | Show status, auth, and mounted extensions |
| `/web auth <password>` | Enable Basic auth (username: `pi`) |
| `/web auth <user:pass>` | Enable Basic auth with custom username |
| `/web auth off` | Disable auth |
| `/web api <token>` | Set API bearer token (full access) |
| `/web api read <token>` | Set API read-only token (GET/HEAD only) |
| `/web api off` | Disable API token auth |
| `/web api` | Show API token status and mounts |

The dashboard at `http://localhost:4100/` lists non-API mounts with links.

### Auth

**Basic auth** protects all non-API endpoints. Browsers prompt natively; API clients send the `Authorization` header. CORS preflight requests pass through without auth.

**API token auth** protects `/api/*` routes with Bearer tokens, separate from Basic auth:

- `apiToken` grants access to all HTTP methods
- `apiReadToken` grants access to GET and HEAD only (403 on write attempts)
- Neither set → `/api/*` is open
- A read token on a POST/PUT/DELETE returns `403 Read-only token cannot be used for write requests`

Clients authenticate with `Authorization: Bearer <token>`.

**Cookie session auth** bridges the gap when only API tokens are configured (no Basic auth). When a browser visits any non-API page, the server redirects to a login page (`/_auth/login`) that prompts for the API token. On success, a signed `pi-session` cookie is set that authenticates both page requests and `/api/*` fetch calls from the browser. This means extensions' frontend code can use plain `fetch('/api/...')` without injecting Bearer headers.

- `/_auth/login` — Login page (GET) and token validation (POST)
- `/_auth/logout` — Clears the session cookie
- Session cookies are signed with a random secret regenerated on each server start

### Configuration via settings.json

All auth and server options are configured under the `"pi-webserver"` key in `settings.json`. Global settings go in `~/.pi/agent/settings.json`, project-level overrides in `<project>/.pi/settings.json`. Project settings are merged on top of global settings.

```jsonc
// ~/.pi/agent/settings.json
{
  "pi-webserver": {
    "autostart": true,          // start the server automatically on session start
    "port": 4100,               // server port (default: 4100)
    "auth": "mypassword",       // Basic auth — username defaults to "pi"
    // "auth": "admin:s3cret",  // or use "user:pass" for a custom username
    "apiToken": "my-secret",    // API bearer token (full access, all methods)
    "apiReadToken": "my-read"   // API read-only token (GET/HEAD only)
  }
}
```

| Setting | Type | Default | Description |
|---|---|---|---|
| `autostart` | `boolean` | `false` | Start the server on session start |
| `port` | `number` | `4100` | HTTP port |
| `auth` | `string \| null` | `null` | Basic auth — `"password"` or `"user:password"` |
| `apiToken` | `string \| null` | `null` | Bearer token for full API access |
| `apiReadToken` | `string \| null` | `null` | Bearer token for read-only API access (GET/HEAD) |

## Mounting routes

Extensions register handlers at a URL prefix. The prefix is stripped before calling the handler, so handlers see paths relative to their mount point.

### Direct import

```typescript
import { mount } from "pi-webserver/src/server.ts";
import { json, readBody, notFound } from "pi-webserver/src/helpers.ts";

mount({
  name: "my-ext",
  label: "My Extension",
  description: "Does cool things",
  prefix: "/my-ext",
  handler: (req, res, path) => {
    // /my-ext/api/items → path = "/api/items"
    if (req.method === "GET" && path === "/api/items") {
      json(res, 200, [{ id: 1, name: "Item" }]);
    } else {
      notFound(res);
    }
  },
});
```

### Event bus

No import needed — works even if pi-webserver loads after your extension:

```typescript
export default function (pi: ExtensionAPI) {
  pi.events.on("web:ready", () => {
    pi.events.emit("web:mount", {
      name: "my-ext",
      label: "My Extension",
      prefix: "/my-ext",
      handler: (req, res, path) => { ... },
    });
  });
}
```

## Mounting API routes

API routes live under `/api/*` and use Bearer token auth instead of Basic auth.

### Direct import

```typescript
import { mountApi } from "pi-webserver/src/server.ts";
import { json } from "pi-webserver/src/helpers.ts";

// Prefix is relative to /api — this mounts at /api/my-ext
mountApi({
  name: "my-ext-api",
  label: "My Extension API",
  prefix: "/my-ext",
  handler: (req, res, path) => {
    json(res, 200, { hello: "world" });
  },
});
```

### Event bus

```typescript
pi.events.on("web:ready", () => {
  pi.events.emit("web:mount-api", {
    name: "my-ext-api",
    prefix: "/my-ext",
    handler: (req, res, path) => { ... },
  });
});
```

### Custom auth

Extensions can bypass built-in token auth and handle authentication themselves:

```typescript
mountApi({
  name: "my-ext-api",
  prefix: "/my-ext",
  skipAuth: true,
  handler: (req, res, path) => {
    if (!myOwnAuthCheck(req)) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    json(res, 200, { data: "secret" });
  },
});
```

## API

### Server

```typescript
import {
  mount, unmount, getMounts,
  mountApi, unmountApi, getApiMounts,
  start, stop, isRunning, getUrl,
  setAuth, getAuth,
  setApiToken, setApiReadToken, getApiTokenStatus,
} from "pi-webserver/src/server.ts";
```

| Function | Description |
|---|---|
| `mount(config)` | Register a route handler at a prefix |
| `unmount(name)` | Remove a route handler |
| `getMounts()` | List all mounts (without handlers) |
| `mountApi(config)` | Mount under `/api` (prefix is relative) |
| `unmountApi(name)` | Remove an API mount |
| `getApiMounts()` | List only `/api/*` mounts |
| `start(port?)` | Start the server (default: 4100) |
| `stop()` | Stop the server |
| `isRunning()` | Check if the server is running |
| `getUrl()` | Get the server URL, or null |
| `setAuth(config)` | Enable/disable Basic auth |
| `getAuth()` | Get auth status (never exposes password) |
| `setApiToken(token)` | Set API bearer token (full access), null to disable |
| `setApiReadToken(token)` | Set API read-only token (GET/HEAD), null to disable |
| `getApiTokenStatus()` | Get API token status (`{ enabled, readEnabled }`) |

### Helpers

```typescript
import { readBody, json, html, csv, notFound, badRequest, serverError } from "pi-webserver/src/helpers.ts";
```

| Function | Description |
|---|---|
| `readBody(req)` | Read request body as string |
| `json(res, status, data)` | Send JSON response |
| `html(res, content, status?)` | Send HTML response |
| `csv(res, content, filename)` | Send CSV download |
| `notFound(res, message?)` | 404 JSON response |
| `badRequest(res, message?)` | 400 JSON response |
| `serverError(res, message?)` | 500 JSON response |

### Events

| Event | Direction | Payload |
|---|---|---|
| `web:ready` | ← webserver emits on session start | `{}` |
| `web:mount` | → webserver listens | `MountConfig` |
| `web:unmount` | → webserver listens | `{ name: string }` |
| `web:mount-api` | → webserver listens | `MountConfig` |
| `web:unmount-api` | → webserver listens | `{ name: string }` |

### MountConfig

```typescript
{
  name: string;         // Unique identifier
  label?: string;       // Display name (defaults to name)
  description?: string; // Shown on dashboard
  prefix: string;       // URL prefix (e.g. "/crm")
  handler: (req, res, path) => void | Promise<void>;
  skipAuth?: boolean;   // Skip built-in API token auth (handle your own)
}
```

## How routing works

- `/` serves the dashboard (Basic auth)
- `/_api/mounts` returns the full mount list as JSON (Basic auth)
- `/_api/mounts/dashboard` returns non-API mounts for the dashboard (Basic auth)
- `/api/*` routes use Bearer token auth (unless mount has `skipAuth: true`)
- All other routes use Basic auth (if configured)
- Requests match against mount prefixes (longest prefix wins)
- The prefix is stripped before calling the handler
- Unmatched requests get a 404

## Development

```bash
npm install
npm run typecheck
```

Test locally with pi:

```bash
pi -e ./
```

## License

[MIT](./LICENSE)
