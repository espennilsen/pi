# @e9n/pi-kysely

Shared Kysely database registry for [pi](https://github.com/mariozechner/pi-mono). Provides a single managed database connection (SQLite, PostgreSQL, or MySQL) that other extensions access via the event bus, with table-level RBAC and a built-in migration system.

## Features

- **Shared database** — one connection pool for all extensions in a session
- **Multi-driver** — SQLite (default), PostgreSQL, and MySQL
- **Table-level RBAC** — extensions own prefixed tables and grant selective access to others
- **Migration system** — generate SQL diffs and apply versioned migrations with checksum integrity
- **Event bus API** — extensions interact via `kysely:*` events (no direct import needed)
- **`/kysely` command** — inspect registered databases and applied migrations at runtime

## Setup / Settings

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project):

**SQLite (default)**
```json
{
  "kysely": {
    "driver": "sqlite",
    "sqlitePath": "db/kysely.db",
    "databaseName": "default",
    "autoCreateDefault": true
  }
}
```

**PostgreSQL**
```json
{
  "kysely": {
    "driver": "postgres",
    "databaseUrl": "postgres://user:pass@localhost:5432/app"
  }
}
```

**MySQL**
```json
{
  "kysely": {
    "driver": "mysql",
    "databaseUrl": "mysql://user:pass@localhost:3306/app"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `driver` | `"sqlite"` | Database driver: `sqlite`, `postgres`, or `mysql`. |
| `sqlitePath` | `"db/kysely.db"` | SQLite file path (relative to agent dir or `.pi/`). Supports `~`. |
| `databaseName` | `"default"` | Name for the default registered database. |
| `databaseUrl` | — | Connection URL for postgres/mysql. Falls back to `DATABASE_URL` env var. |
| `autoCreateDefault` | `true` | Auto-create the default database on session start. |

`sqlitePath` is resolved relative to the settings file's directory (`~/.pi/agent` for global, `.pi/` for project). Absolute paths and `~` are supported.

## Event Bus API

Other extensions communicate with pi-kysely entirely via events. No direct imports required.

### Schema & Queries

| Event | Description |
|-------|-------------|
| `kysely:schema:register` | Apply DDL via Kysely schema builder (create tables, indexes) |
| `kysely:query` | Execute a parameterised raw SQL query |

### Migrations

| Event | Description |
|-------|-------------|
| `kysely:migration:generate` | Diff desired schema vs live DB and return migration SQL |
| `kysely:migration:apply` | Apply stored migration files (skips already-applied by name + checksum) |
| `kysely:migration:status` | List applied migrations, optionally filtered by actor |

### RBAC

| Event | Description |
|-------|-------------|
| `kysely:grant` | Grant table operations to another extension |
| `kysely:revoke` | Revoke previously granted access |
| `kysely:grants` | List current grants |

### Lifecycle

| Event | Direction | Description |
|-------|-----------|-------------|
| `kysely:ready` | emitted | Database is initialised and ready; payload contains registered databases and default driver |
| `kysely:info` | listened | Probe whether pi-kysely is available; reply callback receives the ready payload |
| `kysely:ack` | emitted | Write confirmation when a `requestId` is included in the payload |

### RBAC model

Each extension owns tables prefixed with `<extensionId>__` (e.g. `notes__items`). Owners can grant `select`, `insert`, `update`, or `delete` on their tables to other extensions. RBAC is an in-process cooperative guard — not an OS-level sandbox.

### Migration integrity

Migrations are identified by actor + name and checksummed (SHA-256, first 16 hex chars). Modifying a migration file after it has been applied causes a checksum mismatch error. Migrations are applied in sorted name order and stop on first error.

## Commands

| Command | Description |
|---------|-------------|
| `/kysely` or `/kysely status` | List registered databases (name, driver, label) |
| `/kysely close <name>` | Unregister and destroy one database connection |
| `/kysely close-all` | Unregister and destroy all database connections |
| `/kysely migrations [actor]` | List applied migrations, optionally filtered by actor |

## Install

```bash
pi install npm:@e9n/pi-kysely
```

Database drivers (`better-sqlite3`, `pg`, `mysql2`) are bundled as dependencies.

## License

MIT
