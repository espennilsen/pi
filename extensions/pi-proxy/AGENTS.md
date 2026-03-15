---
name: pi-proxy
description: Route LLM API calls through a configurable proxy server
---

## Overview

Lightweight extension that overrides provider `baseUrl` for all known LLM providers when `pi-proxy.baseUrl` is set in global settings.json. No-op when not configured.

## Architecture

- **`src/index.ts`** — Entry point. Reads settings, validates URL scheme, calls `pi.registerProvider()` for each known provider with the proxy URL. Runs at extension load time (not on session_start) since `registerProvider` is queued and applied during runner init.
- **`src/settings.ts`** — Settings loader. Reads `pi-proxy` key from global + project settings.json. Returns `{ settings, error? }` so callers can distinguish config errors from intentional non-configuration.

## Key Design Decisions

- Providers are overridden at load time via `pi.registerProvider()`, not per-request
- Only `baseUrl` (and optionally `headers`) are overridden — all models, API keys, and API types are preserved
- Each provider maps to `{baseUrl}/{provider}` by default, customizable via `providers` config
- A provider can be excluded from proxying by setting it to `false`
- If `baseUrl` is empty/missing, the extension is completely inert

## Security Model

- `baseUrl` and `headers` are **global-only** — project settings cannot override them (prevents malicious repos from hijacking LLM traffic)
- `baseUrl` must use `https://` — `http://` is only allowed for localhost/127.0.0.1 (local dev)
- Project settings can only configure `providers` (per-provider path overrides or exclusions)
- `registerProvider()` calls are wrapped in try/catch to prevent partial proxy state

## Settings Schema

```json
{
  "pi-proxy": {
    "baseUrl": "string (global only, https required)",
    "headers": { "key": "value-or-env-var-name (global only)" },
    "providers": {
      "provider-name": "string (custom path) | false (skip)"
    }
  }
}
```
