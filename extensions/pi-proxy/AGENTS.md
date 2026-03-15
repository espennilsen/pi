---
name: pi-proxy
description: Route LLM API calls through a configurable proxy server
---

## Overview

Lightweight extension that overrides provider `baseUrl` for all known LLM providers when `pi-proxy.baseUrl` is set in settings.json. No-op when not configured.

## Architecture

- **`src/index.ts`** — Entry point. Reads settings, calls `pi.registerProvider()` for each known provider with the proxy URL. Runs at extension load time (not on session_start) since `registerProvider` is queued and applied during runner init.
- **`src/settings.ts`** — Settings loader. Reads `pi-proxy` key from global + project settings.json, merges them (project overrides global per-key).

## Key Design Decisions

- Providers are overridden at load time via `pi.registerProvider()`, not per-request
- Only `baseUrl` (and optionally `headers`) are overridden — all models, API keys, and API types are preserved
- Each provider maps to `{baseUrl}/{provider}` by default, customizable via `providers` config
- A provider can be excluded from proxying by setting it to `false`
- If `baseUrl` is empty/missing, the extension is completely inert

## Settings Schema

```json
{
  "pi-proxy": {
    "baseUrl": "string",
    "headers": { "key": "value-or-env-var-name" },
    "providers": {
      "provider-name": "string (custom path) | false (skip)"
    }
  }
}
```
