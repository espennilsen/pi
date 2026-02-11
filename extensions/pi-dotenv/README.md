# pi-dotenv

Loads `.env` files from the pi agent home directory (`~/.pi/agent/`) into `process.env` so other extensions can use environment-based configuration.

## Install

```bash
pi install /path/to/pi-dotenv
```

## How it works

On `session_start`, pi-dotenv reads env files from the agent home directory and injects variables into `process.env`.

**Load order** (later files override earlier):

1. `~/.pi/agent/.env` — shared defaults
2. `~/.pi/agent/.env.local` — local overrides (gitignore this)

**Existing env vars are never overwritten** — system/shell environment always wins.

## Example

```bash
# ~/.pi/agent/.env.local
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
OBSIDIAN_API_KEY=my-secret-key
API_TOKEN=my-web-api-token
```

These become available to:

- **pi-channels** — `"botToken": "env:TELEGRAM_BOT_TOKEN"`
- **pi-vault** — `OBSIDIAN_API_KEY`
- **pi-webserver** — `API_TOKEN`, `PI_WEB_AUTH`

## Configuration

None — just place `.env` or `.env.local` in your agent home directory (`~/.pi/agent/`).

## License

[MIT](../LICENSE)
