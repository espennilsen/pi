# Pi Agent Home

This repository is my Pi coding agent home directory. I keep it under version control and symlink it to `~/.pi/agent` so Pi loads configuration, extensions, skills, and runtime state from here.

```bash
ln -s /path/to/this/repo ~/.pi/agent
```

## Contents

- `agents/` — agent profile prompt overrides (`planner`, `reviewer`, `scout`, `worker`).
- `extensions/` — local extensions (see below).
- `skills/` — custom agent skills (`npm`, `workon`, `sample-skill`).
- `settings.json` — provider/model defaults and extension config.

Runtime and sensitive files (`auth.json`, `cache/`, `sessions/`, `crm/`, `db/`, `telemetry/`, `*.db`, `*.tab`) are gitignored.

## Settings

Copy `settings.json.example` to `settings.json` and customize. The top-level keys configure Pi itself, while extension-specific blocks are documented below.

```jsonc
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "high",
  "packages": []
}
```

## Extensions

### pi-dotenv

Loads `.env` files from the pi agent home directory (`~/.pi/agent/`) into `process.env` on session start, so other extensions can use environment-based config.

| | |
|---|---|
| **Settings** | None |

Load order (later overrides earlier):

1. `~/.pi/agent/.env` — shared defaults
2. `~/.pi/agent/.env.local` — local overrides (gitignore this)

Existing env vars are never overwritten — system/shell environment always wins. Useful for providing `TELEGRAM_BOT_TOKEN`, `OBSIDIAN_API_KEY`, `API_TOKEN`, `PI_WEB_AUTH`, etc. without exporting them in your shell profile.

---

### pi-webserver

Shared HTTP server that other extensions mount route handlers on — one port, one dashboard, shared auth.

| | |
|---|---|
| **Web UI** | Dashboard at `http://localhost:4100/` |
| **Commands** | `/web`, `/web <port>`, `/web stop`, `/web status`, `/web auth`, `/web api` |
| **Settings** | None (env vars only) |

Environment variables:

| Variable | Description |
|---|---|
| `PI_WEB_AUTH` | Basic auth — `password` or `user:password` |
| `API_TOKEN` | API bearer token (full access to `/api/*`) |
| `API_READ_TOKEN` | API read-only bearer token (GET/HEAD only) |

---

### pi-td-webui

Task dashboard for the `td` CLI, served via pi-webserver. Board, table, and tree views with issue CRUD, review flows, and activity logs.

| | |
|---|---|
| **Web UI** | `/tasks` |
| **API** | `/api/td/*` |
| **Requires** | `td` CLI in `$PATH`, pi-webserver |

Settings (`tdWebui` key):

```jsonc
{
  "tdWebui": {
    "crossProjectRoot": "~/Dev",   // Root dir for cross-project issue view
    "crossProjectDepth": 1         // How many levels deep to scan (default: 1)
  }
}
```

---

### pi-calendar

Calendar tool, web dashboard, and event reminders. Sends reminder notifications via pi-channels.

| | |
|---|---|
| **Web UI** | `/calendar` |
| **API** | `/api/calendar` |
| **Tool** | `calendar` — actions: `list`, `create`, `update`, `delete`, `today`, `upcoming` |
| **Data** | `~/.pi/agent/db/calendar.db` (default) |

Settings (`pi-calendar` key):

```jsonc
{
  "pi-calendar": {
    "dbPath": "db/calendar.db"   // Relative to agent dir, absolute, or ~/...
  }
}
```

---

### pi-personal-crm

Personal CRM with contacts, companies, groups, interactions, reminders, and CSV import/export.

| | |
|---|---|
| **Web UI** | `/crm` (6 pages: Contacts, Companies, Groups, Interactions, Reminders, Upcoming) |
| **API** | `/api/crm/*` |
| **Tool** | `crm` — 16 actions: `search`, `contact`, `add_contact`, `update_contact`, `delete_contact`, `log_interaction`, `add_reminder`, `upcoming`, `add_relationship`, `list_companies`, `add_company`, `list_groups`, `add_to_group`, `remove_from_group`, `export_csv`, `import_csv` |
| **Data** | `~/.pi/agent/db/crm.db` (default) |

Settings (`pi-personal-crm` key):

```jsonc
{
  "pi-personal-crm": {
    "dbPath": "db/crm.db"   // Relative to agent dir, absolute, or ~/...
  }
}
```

---

### pi-channels

Two-way messaging — routes messages between the agent and external services (Telegram, webhooks, custom adapters). Used by pi-cron and pi-calendar for notifications.

| | |
|---|---|
| **Tool** | `notify` — actions: `send`, `list`, `test` |
| **Settings** | `pi-channels` key |

Settings (`pi-channels` key):

```jsonc
{
  "pi-channels": {
    "adapters": {
      "telegram": {
        "type": "telegram",
        "botToken": "env:TELEGRAM_BOT_TOKEN",  // "env:" prefix resolves env vars
        "polling": false,                       // Enable incoming message polling
        "parseMode": "Markdown",                // Telegram parse mode
        "pollingTimeout": 30,                   // Long-poll timeout in seconds
        "allowedChatIds": ["-100123456"]        // Restrict incoming to these chat IDs
      },
      "alerts": {
        "type": "webhook",
        "method": "POST",                       // HTTP method (default: POST)
        "headers": {
          "Authorization": "env:WEBHOOK_SECRET"
        }
      }
    },
    "routes": {
      "ops": { "adapter": "telegram", "recipient": "-100987654321" },
      "cron": { "adapter": "telegram", "recipient": "123456789" }
    }
  }
}
```

Routes let cron jobs and other extensions use friendly names instead of raw adapter + recipient pairs.

---

### pi-cron

Cron scheduler — runs recurring prompts as isolated `pi -p` subprocesses.

| | |
|---|---|
| **Tool** | `cron` — actions: `list`, `add`, `update`, `remove`, `enable`, `disable`, `run` |
| **Commands** | `/cron on`, `/cron off`, `/cron` (status) |
| **Data** | `~/.pi/agent/pi-cron.tab` (plain text crontab) |
| **Settings** | None |

The scheduler is **off by default**. Start with `pi --cron` or `/cron on` at runtime. Only one Pi instance can run the scheduler (lock file at `~/.pi/agent/pi-cron.lock`). Job output is delivered via pi-channels.

---

### pi-telemetry

Local-only telemetry — records lightweight, privacy-safe events (no prompts or file contents) to per-day JSONL files.

| | |
|---|---|
| **Commands** | `/telemetry`, `/telemetry on`, `/telemetry off`, `/telemetry on WARN` |
| **Data** | `~/.pi/agent/telemetry/YYYY-MM-DD.jsonl` |

Settings (`telemetry` key):

```jsonc
{
  "telemetry": {
    "mode": "on",     // "on" | "off"
    "level": "INFO"   // "NONE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL"
  }
}
```

---

### pi-kysely

Shared Kysely database registry with table-level RBAC between extensions. Supports SQLite, Postgres, and MySQL.

| | |
|---|---|
| **Data** | `~/.pi/agent/db/kysely.db` (default) |

Settings (`kysely` key):

```jsonc
{
  "kysely": {
    "databaseName": "default",        // Logical database name
    "driver": "sqlite",               // "sqlite" | "postgres" | "mysql"
    "sqlitePath": "db/kysely.db",     // Relative to settings file dir, or absolute
    "autoCreateDefault": true          // Auto-create default DB on startup
  }
}
```

For Postgres/MySQL, use `databaseUrl` instead of `sqlitePath`:

```jsonc
{
  "kysely": {
    "driver": "postgres",
    "databaseUrl": "postgres://user:pass@localhost:5432/app"
  }
}
```

Env var fallbacks: `DATABASE_URL`, `PGDATABASE_URL` (Postgres), `MYSQL_URL` (MySQL). Project-level `.pi/settings.json` overrides global settings.

---

### pi-vault

Obsidian vault tool and health dashboard. Uses the Obsidian Local REST API when available, with filesystem fallback.

| | |
|---|---|
| **Web UI** | `/vault` (health dashboard: streak, project health, tasks, tags, activity) |
| **Tool** | `obsidian` — 16 actions (read, write, search, patch, daily notes, templates, etc.) |

Settings (`pi-vault` key):

```jsonc
{
  "pi-vault": {
    "vaultPath": "~/path/to/obsidian/vault",   // Absolute or ~ path to vault root
    "vaultName": "my-vault",                    // Vault name for Obsidian deep links
    "apiUrl": "http://127.0.0.1:27123"          // Local REST API URL (default)
  }
}
```

| Variable | Description |
|---|---|
| `OBSIDIAN_API_KEY` | API key for the Obsidian Local REST API plugin |

---

### pi-npm

NPM workflow tool — gives the agent common package management commands including publish.

| | |
|---|---|
| **Tool** | `npm` — actions: `init`, `install`, `uninstall`, `update`, `outdated`, `run`, `test`, `build`, `publish`, `pack`, `version`, `info`, `list`, `audit`, `link` |
| **Settings** | None |

Parameters: `action` (required), `args`, `path` (working directory), `dry_run` (for publish/pack/version).

---

### web-fetch

Standalone fetch tool — lets the agent retrieve web pages and API responses. Output is truncated to avoid overwhelming the context window; full output saved to temp file when truncated.

| | |
|---|---|
| **Tool** | `web_fetch` — params: `url`, `method`, `headers`, `body` |
| **Settings** | None |

## Skills

| Skill | Description |
|---|---|
| `npm` | Manage npm packages — install, publish, version bump, audit, and run scripts |
| `workon` | Switch working context to a project — loads AGENTS.md, git status, and td issues |
| `sample-skill` | Template skill for creating new skills |

## License

[MIT](./LICENSE)
