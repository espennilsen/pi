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

Environment variables can be provided in `.env` / `.env.local` files — see `.env.example` for all supported variables.

## Extensions

Each extension lives in `extensions/<name>/` with its own `README.md` and settings documentation.

| Extension | Description |
|---|---|
| **pi-calendar** | Calendar tool, web dashboard, and event reminders |
| **pi-channels** | Two-way messaging (Telegram, webhooks) with chat bridge |
| **pi-cron** | Cron scheduler for recurring agent prompts |
| **pi-dotenv** | Deprecated — kept as no-op for backwards compatibility |
| **pi-heartbeat** | Periodic health checks with web dashboard and alerts |
| **pi-jobs** | Agent run telemetry and cost tracking |
| **pi-kysely** | Shared Kysely database registry with table-level RBAC |
| **pi-logger** | Centralized structured JSONL logging via event bus |
| **pi-memory** | Persistent memory — long-term facts, daily logs, search |
| **pi-npm** | NPM workflow tool (install, publish, version, audit, etc.) |
| **pi-personal-crm** | Personal CRM with contacts, companies, interactions |
| **pi-projects** | Project tracking dashboard with git status |
| **pi-subagent** | Parallel task delegation via isolated subprocesses |
| **pi-td-webui** | Task dashboard for the `td` CLI |
| **pi-telemetry** | Local-only privacy-safe event telemetry |
| **pi-vault** | Obsidian vault tool and health dashboard |
| **pi-web-dashboard** | Web dashboard landing page |
| **pi-webnav** | Web navigation and scraping tool |
| **pi-webserver** | Shared HTTP server with auth for all web extensions |
| **pi-workon** | Project context switching and scaffolding |

## Skills

| Skill | Description |
|---|---|
| `npm` | Manage npm packages — install, publish, version bump, audit, and run scripts |
| `workon` | Switch working context to a project — loads AGENTS.md, git status, and td issues |
| `sample-skill` | Template skill for creating new skills |

## License

[MIT](./LICENSE)
