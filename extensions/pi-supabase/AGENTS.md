---
name: pi-supabase
description: Read-only Supabase integration for pi — query tables, inspect schema, subscribe to realtime changes, and forward notifications via pi-channels
---

## Overview

Self-contained pi extension providing read-only access to a Supabase project. Uses the `@supabase/supabase-js` SDK directly. Supports realtime table subscriptions forwarded to pi-channels, optional query logging via pi-kysely, and an RPC allow-list for calling Postgres functions.

**Stack:** TypeScript · @supabase/supabase-js v2 · Supabase Realtime

## Architecture

- `src/index.ts` — Entry point. Registers tool (immediate), initializes client and store on `session_start`, starts realtime subscriptions.
- `src/tool.ts` — `supabase` LLM tool with 6 actions: query, describe, tables, count, rpc, status.
- `src/client.ts` — Thin wrapper around `createClient()`. Holds singleton `SupabaseClient`. `initClient()`, `resetClient()`, `getClient()`, `isClientReady()`.
- `src/realtime.ts` — Subscribes to `postgres_changes` events for configured tables and emits `channel:send` to pi-channels.
- `src/store.ts` — Optional query logging store (memory or Kysely). Logs table, action, filter summary, row count, duration.
- `src/db-kysely.ts` — Kysely backend for query log persistence via pi-kysely event bus.
- `src/settings.ts` — Reads `pi-supabase` from global + project settings. Handles url, keys, notifications, rpc allow-list.
- `src/logger.ts` — Extension logger.

## Tool: `supabase`

| Action | Required params | Description |
|--------|----------------|-------------|
| `query` | `table` | Select rows with optional filters, column selection, ordering, pagination |
| `describe` | `table` | List columns, types, nullability via `information_schema.columns` |
| `tables` | — | List all tables in public schema |
| `count` | `table` | Count rows with optional filters |
| `rpc` | `function_name` | Call an allow-listed Postgres function |
| `status` | — | Show connection status |

### Filters (for `query` and `count`)

Array of `{ column, operator, value }`. Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`. Invalid operators throw an error before the query.

### RPC

Empty `allowList` (default) blocks all RPC calls. Add function names to `pi-supabase.rpc.allowList` in settings to permit them. The allow-list is case-insensitive.

## Key Patterns

- **Read-only** — No insert, update, or delete. Tool only exposes SELECT and RPC.
- **Tool registered immediately** — not in `session_start`, guards readiness internally with `isClientReady()`.
- **Client requires both URL and at least one key** — silently skips init if not configured.
- **Service role key** — Optional. Set `useServiceRole: true` to use elevated access (bypasses RLS).
- **Realtime subscriptions** — One Supabase channel per table. On change, emits `channel:send` to pi-channels with a human-readable diff summary.
- **Kysely optional** — Query log persistence is best-effort; falls back to in-memory store if Kysely unavailable.
- **No direct imports** between extensions — all integration via event bus.

## Settings

```jsonc
// settings.json
{
  "pi-supabase": {
    "url": "https://xxx.supabase.co",    // Supabase project URL
    "anonKey": "eyJ...",                  // Anon/public key
    "serviceRoleKey": "eyJ...",           // Service role key (optional)
    "useServiceRole": false,              // Use service role key instead of anon key
    "useKysely": false,                   // Log queries to pi-kysely shared DB
    "notifications": {
      "enabled": false,                   // Enable realtime table subscriptions
      "route": "ops",                     // pi-channels route for notifications
      "tables": ["users", "orders"]       // Tables to subscribe to
    },
    "rpc": {
      "allowList": ["my_function"]        // Allowed Postgres function names (empty = all blocked)
    }
  }
}
```

## Integration Points

| Extension | Integration | Mechanism |
|-----------|------------|-----------|
| **pi-channels** | Table change notifications | `channel:send` event |
| **pi-kysely** | Optional query log persistence | `kysely:info`, `kysely:ready` events |
| **pi-logger** | Structured logging | `log` event |

## Conventions

- No console.log — use logger.
- Row output truncated: max 50 rows in markdown table, values truncated at 80 chars.
- Query logging is best-effort — store errors are silently ignored.
- `env:VAR_NAME` pattern supported for keys in settings.
