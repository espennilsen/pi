# @e9n/pi-vault

Obsidian vault integration for [pi](https://github.com/badlogic/pi-mono) — read, write, search, and manage notes with a 16-action tool and a web health dashboard.

## Features

- **`obsidian` tool** — read, write, append, patch, search, daily notes, templates, frontmatter, and more
- **API-first with filesystem fallback** — uses the Obsidian Local REST API when running, falls back to the filesystem otherwise
- **Web dashboard** at `/vault` — daily note streak, project health, task breakdown, tag usage, recent activity
- **Deep links** — click notes and tags to open directly in Obsidian

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-vault": {
    "vaultPath": "~/Library/CloudStorage/.../Obsidian/MyVault",
    "vaultName": "MyVault",
    "apiUrl": "http://127.0.0.1:27123"
  }
}
```

Set the API key as an environment variable:

```bash
export OBSIDIAN_API_KEY="your-api-key-here"
```

| Setting | Required | Default | Description |
|---------|----------|---------|-------------|
| `vaultPath` | Yes | — | Path to vault root (`~` expansion supported) |
| `vaultName` | No | basename of `vaultPath` | Vault name for `obsidian://` deep links |
| `apiUrl` | No | `http://127.0.0.1:27123` | Obsidian Local REST API URL |
| `OBSIDIAN_API_KEY` (env) | Yes (for API) | — | API key for Obsidian Local REST API plugin |

## Tool: `obsidian`

| Action | API Required | Description |
|--------|:---:|-------------|
| `read` | No | Read a note by path |
| `write` | No | Create or overwrite a note |
| `append` | No | Append content to a note |
| `patch` | Partial | Insert at heading, block ref, or frontmatter field |
| `delete` | No | Delete a note |
| `search` | No | Full-text search (grep fallback without API) |
| `dataview` | Yes | Run a Dataview DQL query |
| `search_jsonlogic` | Yes | JsonLogic structured search |
| `list` | No | Directory listing |
| `create_from_template` | No | Create a note from a vault template |
| `frontmatter` | No | Read or update YAML frontmatter |
| `recent` | No | List recently modified notes |
| `daily` | No | Read or create a daily note |
| `open` | Yes | Open a file in the Obsidian UI |
| `commands` | Yes | List or execute Obsidian commands |
| `document_map` | No | List headings, block refs, and frontmatter fields |

## Web UI

Start the web server with `/web`, then open `http://localhost:4100/vault`. Requires [pi-webserver](../pi-webserver).

## Install

```bash
pi install npm:@e9n/pi-vault
```

## License

MIT
