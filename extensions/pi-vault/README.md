# pi-vault

Obsidian vault tool and health dashboard extension for [pi](https://github.com/badlogic/pi-mono).

## Features

- **`obsidian` tool** — 16-action vault management tool for the LLM (read, write, search, patch, daily notes, templates, etc.)
- **Health dashboard** — Web UI showing daily note streak, project health, task breakdown, tag usage, recent activity
- **API-first** — Uses Obsidian's Local REST API when available, filesystem fallback otherwise
- **Deep links** — Click notes/tags to open directly in Obsidian

## Install

```bash
pi install git@github.com:espennilsen/pi-vault.git
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/path/to/pi-vault"]
}
```

## Configuration

Add to `~/.pi/agent/settings.json`:

```json
{
  "pi-vault": {
    "vaultPath": "~/Library/CloudStorage/.../Obsidian/e9n",
    "vaultName": "e9n",
    "apiUrl": "http://127.0.0.1:27123"
  }
}
```

Set the API key as an env var:

```bash
export OBSIDIAN_API_KEY="your-api-key-here"
```

### settings.json keys

| Key | Required | Description |
|-----|----------|-------------|
| `vaultPath` | Yes | Path to vault root (`~` expansion supported) |
| `vaultName` | No | Vault name for `obsidian://` deep links (defaults to basename) |
| `apiUrl` | No | REST API URL (default: `http://127.0.0.1:27123`) |

### Environment variables

| Env Var | Required | Description |
|---------|----------|-------------|
| `OBSIDIAN_API_KEY` | Yes | API key for Obsidian Local REST API plugin |

Project-level `.pi/settings.json` overrides global settings.

## Requirements

- **pi-webserver** extension (for web dashboard)
- **Obsidian** with [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin (for full feature set; filesystem fallback works without it)

## Usage

### Web Dashboard

Start the web server with `/web`, then visit `http://localhost:4100/vault`.

### Tool Actions

The `obsidian` tool supports:

| Action | Description | API Required |
|--------|-------------|:---:|
| `read` | Read a note by path | No |
| `write` | Create or update a note | No |
| `append` | Append content to a note | No |
| `patch` | Insert at heading/block/frontmatter | Partial |
| `delete` | Delete a note | No |
| `search` | Full-text search | No |
| `dataview` | Run Dataview DQL query | Yes |
| `search_jsonlogic` | JsonLogic structured query | Yes |
| `list` | Directory listing | No |
| `create_from_template` | Create from vault template | No |
| `frontmatter` | Read/update YAML frontmatter | No |
| `recent` | Recently modified notes | No |
| `daily` | Read/create daily note | No |
| `open` | Open file in Obsidian UI | Yes |
| `commands` | List/execute Obsidian commands | Yes |
| `document_map` | List headings/blocks/frontmatter | No |

## License

MIT
