# @e9n/pi-workon

Project context switching for [pi](https://github.com/badlogic/pi-mono) — switch between projects, load AGENTS.md and git status, detect tech stacks, and scaffold project configs.

## Features

- **`workon` tool** — switch project context, loading AGENTS.md, git status, and open td issues
- **`project_init` tool** — detect tech stack and scaffold AGENTS.md, `.pi/`, and `td` task tracking
- **Auto-discovery** — scans `~/Dev` (or a custom directory) for projects
- **Bundled skills** — includes a `workon` skill for use in prompt templates

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-workon": {
    "devDir": "~/Dev"
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `devDir` | `"~/Dev"` | Base directory scanned for projects |

## Tool: `workon`

| Action | Required params | Description |
|--------|----------------|-------------|
| `switch` | `project` | Switch to a project — loads AGENTS.md, git status, and td issues |
| `status` | — | Show current project context |
| `list` | — | List all projects in `devDir` with git branch, AGENTS.md, and td badges |

## Tool: `project_init`

| Action | Required params | Description |
|--------|----------------|-------------|
| `detect` | `project` | Scan project and preview what would be generated (dry run) |
| `init` | `project` | Scaffold AGENTS.md, `.pi/settings.json`, and run `td init` |
| `batch` | — | Scan all projects in `devDir` and report init status |

**Init options:** `force` (overwrite existing AGENTS.md), `skip_td`, `skip_agents_md`, `skip_pi_dir`

## Install

```bash
pi install npm:@e9n/pi-workon
```

## License

MIT
