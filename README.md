# Pi Agent Home

This repository is my Pi coding agent home directory. I keep it under version control and symlink it to `~/.pi/agent` so Pi loads configuration, extensions, skills, and runtime state from here.

```bash
ln -s /path/to/this/repo ~/.pi/agent
```

## Contents

- `agents/` — agent profile prompt overrides (`planner`, `reviewer`, `scout`, `worker`).
- `extensions/` — local extensions (see below).
- `skills/` — custom agent skills (`npm`, `workon`, `sample-skill`).


## Extensions

Each extension lives in `extensions/<name>/` with its own `README.md` and settings documentation.

| Extension | Description |
|---|---|
| [**pi-calendar**](https://github.com/espennilsen/pi/tree/main/extensions/pi-calendar) | Calendar tool, web dashboard, and event reminders |
| [**pi-channels**](https://github.com/espennilsen/pi/tree/main/extensions/pi-channels) | Two-way messaging (Telegram, webhooks) with chat bridge |
| [**pi-cron**](https://github.com/espennilsen/pi/tree/main/extensions/pi-cron) | Cron scheduler for recurring agent prompts |
| [**pi-dotenv**](https://github.com/espennilsen/pi/tree/main/extensions/pi-dotenv) | Deprecated — kept as no-op for backwards compatibility |
| [**pi-heartbeat**](https://github.com/espennilsen/pi/tree/main/extensions/pi-heartbeat) | Periodic health checks with web dashboard and alerts |
| [**pi-jobs**](https://github.com/espennilsen/pi/tree/main/extensions/pi-jobs) | Agent run telemetry and cost tracking |
| [**pi-kysely**](https://github.com/espennilsen/pi/tree/main/extensions/pi-kysely) | Shared Kysely database registry with table-level RBAC |
| [**pi-logger**](https://github.com/espennilsen/pi/tree/main/extensions/pi-logger) | Centralized structured JSONL logging via event bus |
| [**pi-memory**](https://github.com/espennilsen/pi/tree/main/extensions/pi-memory) | Persistent memory — long-term facts, daily logs, search |
| [**pi-npm**](https://github.com/espennilsen/pi/tree/main/extensions/pi-npm) | NPM workflow tool (install, publish, version, audit, etc.) |
| [**pi-personal-crm**](https://github.com/espennilsen/pi/tree/main/extensions/pi-personal-crm) | Personal CRM with contacts, companies, interactions |
| [**pi-projects**](https://github.com/espennilsen/pi/tree/main/extensions/pi-projects) | Project tracking dashboard with git status |
| [**pi-subagent**](https://github.com/espennilsen/pi/tree/main/extensions/pi-subagent) | Parallel task delegation via isolated subprocesses |
| [**pi-td-webui**](https://github.com/espennilsen/pi/tree/main/extensions/pi-td-webui) | Task dashboard for the `td` CLI |
| [**pi-telemetry**](https://github.com/espennilsen/pi/tree/main/extensions/pi-telemetry) | Local-only privacy-safe event telemetry |
| [**pi-vault**](https://github.com/espennilsen/pi/tree/main/extensions/pi-vault) | Obsidian vault tool and health dashboard |
| [**pi-web-dashboard**](https://github.com/espennilsen/pi/tree/main/extensions/pi-web-dashboard) | Web dashboard landing page |
| [**pi-webnav**](https://github.com/espennilsen/pi/tree/main/extensions/pi-webnav) | Web navigation and scraping tool |
| [**pi-webserver**](https://github.com/espennilsen/pi/tree/main/extensions/pi-webserver) | Shared HTTP server with auth for all web extensions |
| [**pi-workon**](https://github.com/espennilsen/pi/tree/main/extensions/pi-workon) | Project context switching and scaffolding |

## Skills

| Skill | Description |
|---|---|
| `npm` | Manage npm packages — install, publish, version bump, audit, and run scripts |
| `workon` | Switch working context to a project — loads AGENTS.md, git status, and td issues |
| `sample-skill` | Template skill for creating new skills |

## Disclaimer

These are my personal extensions, catered to my own workflow and needs — they might not suit everyone. Feedback is welcome via [GitHub issues](https://github.com/espennilsen/pi/issues) or reach out to me on [X](https://x.com/espennilsen).

## License

[MIT](./LICENSE)
