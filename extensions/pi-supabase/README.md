# pi-supabase

Read-only Supabase integration for pi. Query tables, describe schemas, call RPC functions, and get realtime change notifications via pi-channels.

## Features

- **`supabase` tool** — query, describe, tables, count, rpc, status
- **Realtime subscriptions** — subscribe to table changes, forwarded as pi-channels notifications
- **Query logging** — optional persistent audit log via pi-kysely

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-supabase": {
    "url": "https://xxx.supabase.co",
    "anonKey": "eyJ...",
    "serviceRoleKey": "eyJ...",
    "useServiceRole": false,
    "useKysely": false,
    "notifications": {
      "enabled": true,
      "route": "ops",
      "tables": ["users", "orders"]
    }
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `url` | `string` | — | Supabase project URL (required) |
| `anonKey` | `string` | — | Supabase anon/public key (required unless using service role) |
| `serviceRoleKey` | `string` | — | Supabase service role key (optional, elevated access) |
| `useServiceRole` | `boolean` | `false` | Use service role key instead of anon key |
| `useKysely` | `boolean` | `false` | Use pi-kysely shared DB for query audit log |
| `notifications.enabled` | `boolean` | `false` | Enable realtime table change notifications |
| `notifications.route` | `string` | `"ops"` | pi-channels route for notifications |
| `notifications.tables` | `string[]` | `[]` | Tables to subscribe to for realtime changes |

## Tool Actions

| Action | Description |
|--------|-------------|
| `query` | Select rows with filters, ordering, pagination |
| `describe` | Show table columns and types |
| `tables` | List all tables in the public schema |
| `count` | Count rows matching optional filters |
| `rpc` | Call a Postgres function (read-only) |
| `status` | Show connection status |

### Filter Operators

`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`

## Requirements

- Supabase project with API access enabled
- `pi-channels` extension (optional, for realtime notifications)
- `pi-kysely` extension (optional, for query audit log)

## Development

```bash
npm install
npm run typecheck
```
