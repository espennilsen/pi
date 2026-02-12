# pi-dotenv

Loads `.env` files into `process.env` so other extensions can use environment-based configuration.

## Install

```bash
pi install /path/to/pi-dotenv
```

## How it works

On `session_start`, pi-dotenv reads env files from two locations and injects variables into `process.env`.

**Load order** (later files override earlier):

1. `~/.pi/agent/.env` — global defaults
2. `~/.pi/agent/.env.local` — global local overrides (gitignore this)
3. `<project>/.pi/.env` — project-specific defaults
4. `<project>/.pi/.env.local` — project-specific local overrides

Project-level files take precedence over global ones. **Existing env vars are never overwritten** — system/shell environment always wins.

## Example

```bash
# ~/.pi/agent/.env.local (global)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
OBSIDIAN_API_KEY=my-secret-key

# ~/Dev/my-project/.pi/.env (project-specific)
API_TOKEN=project-specific-token
PI_WEB_AUTH=admin:secret
```

These become available to:

- **pi-channels** — `"botToken": "env:TELEGRAM_BOT_TOKEN"`
- **pi-vault** — `OBSIDIAN_API_KEY`
- **pi-webserver** — `API_TOKEN`, `PI_WEB_AUTH`

## Configuration

None — just place `.env` or `.env.local` in `~/.pi/agent/` (global) or `<project>/.pi/` (project-specific).

## License

[MIT](../LICENSE)
