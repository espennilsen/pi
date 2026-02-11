# pi-kysely

Shared Kysely extension for pi with **table-level RBAC** between extensions.

By default, pi-kysely creates a shared SQLite database at `$PI_CODING_AGENT_DIR/db/sqlite.db` (defaults to `~/.pi/agent/db/sqlite.db`, or `<project>/.pi/db/sqlite.db` when configured in project settings) and only exposes table operations (no DB lifecycle API to consumers).

## Install

```bash
pi install git@github.com:espennilsen/pi-kysely.git
```

Database drivers are bundled as dependencies (`better-sqlite3`, `pg`, `mysql2`).
If you need a custom version, install it in your project and use npm overrides as needed.

## Settings (`settings.json`)

Global: `$PI_CODING_AGENT_DIR/settings.json` (defaults to `~/.pi/agent/settings.json`)  
Project: `.pi/settings.json` (overrides global)

`sqlitePath` is resolved relative to the settings file directory (global -> `$PI_CODING_AGENT_DIR` (defaults to `~/.pi/agent`), project -> `.pi`). Absolute paths and `~` are supported.

```json
{
  "kysely": {
    "databaseName": "default",
    "driver": "sqlite",
    "sqlitePath": "db/sqlite.db",
    "autoCreateDefault": true
  }
}
```

Postgres/MySQL default via URL:

```json
{
  "kysely": {
    "driver": "postgres",
    "databaseUrl": "postgres://user:pass@localhost:5432/app"
  }
}
```

```json
{
  "kysely": {
    "driver": "mysql",
    "databaseUrl": "mysql://user:pass@localhost:3306/app"
  }
}
```

URL env fallbacks:
- Postgres: `DATABASE_URL` or `PGDATABASE_URL`
- MySQL: `DATABASE_URL` or `MYSQL_URL`

## RBAC model

- Each extension owns tables prefixed with `"<extensionId>__"`
- Example: extension `notes` owns `notes__items`
- Owners can grant table rights to other extensions
- Allowed operations: `select`, `insert`, `update`, `delete`
- No DB-level operations are exposed to other extensions via package exports

## Use from another extension

```ts
import { createExtensionTableClient } from "pi-kysely";

const db = createExtensionTableClient("notes");

// your own table name helper
const notesTable = db.ownTable("items"); // "notes__items"

// CRUD on own table
await db.insert({
  table: notesTable,
  values: { id: 1, title: "Hello" },
});

const rows = await db.select({ table: notesTable });

// grant read access to another extension
// can only grant on your own table namespace
db.grant("search", notesTable, ["select"]);
```

## Event bus API

- `kysely:ready` (emitted on session start)
- `kysely:grant`
- `kysely:revoke`
- `kysely:grants`
- `kysely:table:select`
- `kysely:table:insert`
- `kysely:table:update`
- `kysely:table:delete`
- `kysely:ack` (emitted when payload includes `requestId`)

### Ack pattern for write confirmation

Use `ack` callback (or `kysely:ack` with `requestId`) to confirm writes completed:

```ts
const requestId = crypto.randomUUID();

pi.events.emit("kysely:table:insert", {
  actor: "notes",
  requestId,
  input: {
    table: "notes__items",
    values: { id: 1, title: "hello" }
  },
  ack: (ack) => {
    if (!ack.ok) throw new Error(ack.error);
    // confirmed written
    console.log("insert ack", ack.result);
  }
});
```

If you prefer event-based ack:

```ts
pi.events.on("kysely:ack", (ack) => {
  if (ack.requestId !== requestId) return;
  if (!ack.ok) throw new Error(ack.error);
});
```

## Command

- `/kysely` or `/kysely status`: list registered DB connections
- `/kysely close <name>`: close one DB connection
- `/kysely close-all`: close all DB connections

## Security note

RBAC here is an in-process policy guard for cooperative extensions. Since extensions run in one runtime with full code execution, this is not an OS-level sandbox.

## Development

```bash
npm install
npm run typecheck
```
