# Agent Integration Guide

## Install as pi package

```bash
pi install git@github.com:espennilsen/pi-webserver.git
```

The extension auto-discovers via the `pi` manifest in `package.json`.

## What it provides

**Command:** `/web [port|stop|status|auth]` — Manage the shared HTTP server.

**Auth:** `/web auth <password|user:pass|off>` — Optional Basic auth for all endpoints. Also configurable via `PI_WEB_AUTH` env var.

**API routes:** `/web api <token|read <token>|off|status>` — Token-protected `/api/*` namespace. Env vars: `API_TOKEN` (full access), `API_READ_TOKEN` (GET/HEAD only). When a token is set, `/api/*` requires `Authorization: Bearer <token>`. When not set, `/api/*` is open.

**Events (via `pi.events`):**
- Listens for `web:mount`, `web:unmount`, `web:mount-api`, `web:unmount-api` from other extensions
- Emits `web:ready` on session start

**Dashboard:** Root URL (`/`) shows all mounted extensions with links.

## Mounting routes from another extension

```typescript
import { mount } from "pi-webserver/src/server.ts";
import { json, readBody } from "pi-webserver/src/helpers.ts";

mount({
  name: "my-ext",
  label: "My Extension",
  prefix: "/my-ext",
  handler: (req, res, path) => {
    // path has prefix stripped
    json(res, 200, { hello: "world" });
  },
});
```

Or via the event bus (no import needed):

```typescript
pi.events.on("web:ready", () => {
  pi.events.emit("web:mount", { name: "my-ext", prefix: "/my-ext", handler: ... });
});
```

## Mounting API routes (token-protected)

API routes live under `/api/*` and use Bearer token auth (when `API_TOKEN` is set).

```typescript
import { mountApi } from "pi-webserver/src/server.ts";
import { json, readBody } from "pi-webserver/src/helpers.ts";

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

Or via the event bus:

```typescript
pi.events.on("web:ready", () => {
  pi.events.emit("web:mount-api", { name: "my-ext-api", prefix: "/my-ext", handler: ... });
});
```

**Auth behavior:**
- `API_TOKEN` → full access (all methods)
- `API_READ_TOKEN` → read-only access (GET/HEAD only)
- Neither set → `/api/*` is open

**Custom auth:** Extensions can bypass built-in token auth and handle authentication themselves by setting `skipAuth: true`:

```typescript
mountApi({
  name: "my-ext-api",
  label: "My Extension API",
  prefix: "/my-ext",
  skipAuth: true,
  handler: (req, res, path) => {
    // Extension handles its own auth here
    if (!myCustomAuthCheck(req)) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    json(res, 200, { hello: "world" });
  },
});
```
