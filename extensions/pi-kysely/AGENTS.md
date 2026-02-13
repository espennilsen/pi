# Agent Integration Guide

## Install

```bash
pi install git@github.com:espennilsen/pi-kysely.git
```

## What this package exposes to other extensions

- Table-level API with RBAC
- Migration system: `kysely:migration:generate` / `kysely:migration:apply` / `kysely:migration:status`
- Write operations support ack callbacks / `kysely:ack` events
- Default DB is auto-created from `kysely` settings (sqlite by default)

## Migrations

Extensions generate migration SQL via `kysely:migration:generate` (diffs desired schema vs live DB), store the resulting `.sql` files in their own repo, then apply them on startup via `kysely:migration:apply`. Applied migrations are tracked in `_kysely_migrations` table with checksums. See README.md for full examples.

## Ownership + RBAC

- Extension `foo` owns tables named `foo__*`
- `foo` can grant specific table ops (`select|insert|update|delete`) to another extension
- Grants are denied if owner tries to grant outside its namespace

## Consumer usage

```ts
import { createExtensionTableClient } from "pi-kysely";

const client = createExtensionTableClient("notes");
const table = client.ownTable("items"); // notes__items

await client.insert({ table, values: { id: 1, text: "hello" } });
const rows = await client.select({ table });

client.grant("search", table, ["select"]);
```

## Settings

Use `$PI_CODING_AGENT_DIR/settings.json` (defaults to `~/.pi/agent/settings.json`) or `.pi/settings.json`:

`sqlitePath` is resolved relative to the settings file directory (global -> `$PI_CODING_AGENT_DIR` (defaults to `~/.pi/agent`), project -> `.pi`). Absolute paths and `~` are supported.

```json
{
  "kysely": {
    "databaseName": "default",
    "driver": "sqlite",
    "sqlitePath": "db/sqlite.db",
    "databaseUrl": "postgres://... or mysql://...",
    "autoCreateDefault": true
  }
}
```
