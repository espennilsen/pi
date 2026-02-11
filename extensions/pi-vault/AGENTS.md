# Agent Integration Guide

## Install as pi package

```bash
pi install git@github.com:espennilsen/pi-vault.git
```

The extension auto-discovers via the `pi` manifest in `package.json`.

## What it provides

**Tool:** `obsidian` — 16-action vault tool (read, write, append, patch, delete, search, dataview, search_jsonlogic, list, create_from_template, frontmatter, recent, daily, open, commands, document_map).

**Web dashboard:** `/vault` — Vault health dashboard with daily note streak, project health, task breakdown, tag usage, and recent activity.

**API endpoint:** `GET /api/vault/health` — JSON vault health data.

## Configuration

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (project):

```json
{
  "pi-vault": {
    "vaultPath": "~/Library/CloudStorage/.../Obsidian/e9n",
    "vaultName": "e9n",
    "apiUrl": "http://127.0.0.1:27123"
  }
}
```

API key via env var: `OBSIDIAN_API_KEY`

| Key | Required | Description |
|-----|----------|-------------|
| `vaultPath` | Yes | Path to vault root (`~` expansion supported) |
| `vaultName` | No | Vault name for `obsidian://` deep links (defaults to basename of vaultPath) |
| `apiUrl` | No | REST API URL (default: `http://127.0.0.1:27123`) |

Project settings override global settings.

## Dependencies

- **pi-webserver** — Required for web dashboard. Tool works without it.
- **Obsidian Local REST API plugin** — Required for API features (search, dataview, jsonlogic, open, commands). Tool falls back to filesystem without it.

## Architecture

```
src/
├── index.ts        — Extension entry point
├── api-client.ts   — Shared Obsidian REST API client + settings.json config loader
├── tool.ts         — The `obsidian` tool (16 actions, API + filesystem fallback)
├── health.ts       — Vault health data computation (streak, projects, tasks, tags)
├── web.ts          — Web route mounting (integrates with pi-webserver)
└── vault.html      — Health dashboard page
```

## Using from other extensions

The vault health data endpoint is available at `/api/vault/health` when pi-webserver is running:

```typescript
const res = await fetch("http://localhost:4100/api/vault/health");
const data = await res.json();
```
