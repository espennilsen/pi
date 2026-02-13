# pi-kysely

Shared Kysely extension for pi with **table-level RBAC** between extensions.

By default, pi-kysely creates a shared SQLite database at `$PI_CODING_AGENT_DIR/db/kysely.db` (defaults to `~/.pi/agent/db/kysely.db`, or `<project>/.pi/db/kysely.db` when configured in project settings) and only exposes table operations (no DB lifecycle API to consumers).

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
    "sqlitePath": "db/kysely.db",
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

## Migrations

pi-kysely provides a migration system so extensions can distribute portable schema changes. Two flows:

### Development: Generate a migration

The extension declares its desired schema. pi-kysely diffs against the live DB, applies changes, and returns the migration SQL. The extension stores it in its repo.

```ts
pi.events.emit("kysely:migration:generate", {
  actor: "pi-calendar",
  tables: {
    calendar_events: {
      columns: {
        id:         { type: "integer", primaryKey: true, autoIncrement: true },
        title:      { type: "text", notNull: true },
        start_time: { type: "text", notNull: true },
        end_time:   { type: "text", notNull: true },
      },
      indexes: [
        { columns: ["start_time"], name: "idx_cal_events_start" },
      ],
    },
  },
  migrationName: "initial",
  reply: (result) => {
    if (result.statements.length === 0) return; // no changes
    // result.name  = "0001_initial"
    // result.sql   = "create table ... ;\ncreate index ...;"
    // Write result.sql to your migrations/ directory
    fs.writeFileSync(`migrations/${result.name}.sql`, result.sql);
  },
});
```

Supports `dropTables` and `dropColumns` for destructive changes:

```ts
pi.events.emit("kysely:migration:generate", {
  actor: "pi-calendar",
  tables: { /* current desired schema */ },
  dropTables: ["old_unused_table"],
  dropColumns: { calendar_events: ["legacy_field"] },
  migrationName: "drop_legacy",
  reply: (result) => { /* save to file */ },
});
```

### Runtime: Apply stored migrations

On startup, the extension reads its migration files and sends them to pi-kysely. Already-applied migrations are skipped (tracked by name + checksum in `_kysely_migrations` table).

```ts
import { readdirSync, readFileSync } from "node:fs";

const migrationDir = new URL("../migrations", import.meta.url).pathname;
const files = readdirSync(migrationDir).filter(f => f.endsWith(".sql")).sort();

const migrations = files.map(f => ({
  name: f.replace(/\.sql$/, ""),
  sql: readFileSync(`${migrationDir}/${f}`, "utf-8"),
}));

pi.events.emit("kysely:migration:apply", {
  actor: "pi-calendar",
  migrations,
  reply: (result) => {
    if (!result.ok) throw new Error(result.errors.join("; "));
    // result.applied  = ["0001_initial", "0002_add_color"]
    // result.skipped  = [] (already applied)
  },
});
```

### Check migration status

```ts
pi.events.emit("kysely:migration:status", {
  actor: "pi-calendar", // optional — omit for all actors
  reply: (records) => {
    // [{ id, actor, name, checksum, applied_at }]
  },
});
```

### Migration integrity

Each migration is checksummed (SHA-256, first 16 hex chars). If a migration file is modified after being applied, `apply` reports a checksum mismatch error. Migrations are applied in sorted name order and stop on first error to prevent out-of-order execution.

## Event bus API

- `kysely:ready` (emitted on session start)
- `kysely:migration:generate`
- `kysely:migration:apply`
- `kysely:migration:status`
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
- `/kysely migrations [actor]`: list applied migrations (optionally filtered by actor)

## Security note

RBAC here is an in-process policy guard for cooperative extensions. Since extensions run in one runtime with full code execution, this is not an OS-level sandbox.

## Development

```bash
npm install
npm run typecheck
```
