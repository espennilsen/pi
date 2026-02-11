# Pi Agent Home

This repository is my Pi coding agent home directory. I keep it under version control and symlink it to `~/.pi/agent` so Pi loads configuration, extensions, skills, and runtime state from here.

```bash
ln -s /path/to/this/repo ~/.pi/agent
```

## Contents

- `agents/` — agent profile prompt overrides (planner/reviewer/scout/worker).
- `extensions/` — local extensions and packages:
  - `pi-channels`, `pi-cron`, `pi-kysely`, `pi-personal-crm`, `pi-td-webui`, `pi-telemetry`, `pi-webserver`
  - standalone scripts: `sample-tools.ts`, `web-fetch.ts`
- `skills/` — custom agent skills (`workon`, `sample-skill`).
- `settings.json` — default provider/model settings and package config.

Runtime and sensitive files (`auth.json`, `cache/`, `sessions/`, `crm/`, `db/`, `telemetry/`, `*.db`, `*.tab`) are gitignored.
