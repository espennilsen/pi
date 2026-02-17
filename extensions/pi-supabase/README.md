# @e9n/pi-supabase

Supabase integration for [pi](https://github.com/badlogic/pi-mono) — query tables, describe schemas, call RPC functions, and stream realtime change notifications.

## Features

- **`supabase` tool** — query, describe, count, rpc, and status actions with filter support
- **Realtime subscriptions** — subscribe to table change events, forwarded as [pi-channels](../pi-channels) notifications
- **Dual key support** — anon key or service role key, switchable per project
- **Optional query audit log** — persistent log via [pi-kysely](../pi-kysely)

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
      "enabled": false,
      "route": "ops",
      "tables": ["users", "orders"]
    },
    "rpc": {
      "allowList": ["get_dashboard_stats"]
    }
  }
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `url` | `string` | — | Supabase project URL (required) |
| `anonKey` | `string` | — | Supabase anon/public key |
| `serviceRoleKey` | `string` | — | Service role key for elevated access |
| `useServiceRole` | `boolean` | `false` | Use service role key instead of anon key |
| `useKysely` | `boolean` | `false` | Log queries via pi-kysely |
| `notifications.enabled` | `boolean` | `false` | Enable realtime table change notifications |
| `notifications.route` | `string` | `"ops"` | pi-channels route for notifications |
| `notifications.tables` | `string[]` | `[]` | Tables to subscribe to |
| `rpc.allowList` | `string[]` | `[]` | Allowed RPC function names (empty = all blocked) |

## Tool: `supabase`

| Action | Description |
|--------|-------------|
| `query` | Select rows with filters, ordering, and pagination |
| `describe` | Show column names and types for a table |
| `tables` | List all tables in the public schema |
| `count` | Count rows matching optional filters |
| `rpc` | Call a Postgres function (must be on allow-list) |
| `status` | Show connection status and current config |

**Filter operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`

## Install

```bash
pi install npm:@e9n/pi-supabase
```

## License

MIT
