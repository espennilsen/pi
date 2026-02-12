# pi-workon

Project context switching extension for [pi](https://github.com/badlogic/pi-mono). Switch between projects, detect tech stacks, and scaffold project configs.

## Install

```bash
pi install /path/to/pi-workon
```

## Features

- **`workon` tool** — switch project context (loads AGENTS.md, git status, td issues)
- **`project_init` tool** — detect tech stack and scaffold AGENTS.md, `.pi/`, td config
- **Auto-discovery** — scans `~/Dev` (or custom directory) for projects

## Settings

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-workon": {
    "devDir": "~/Dev"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `devDir` | `"~/Dev"` | Base directory to scan for projects. |

## Architecture

```
src/
├── index.ts       # Extension entry — registers tools on session start
├── settings.ts    # Settings loader
├── tool.ts        # workon + project_init tool registration
├── resolver.ts    # Project resolution (find project by name in devDir)
├── detector.ts    # Tech stack detection (languages, frameworks, tools)
└── scaffold.ts    # AGENTS.md and .pi/ scaffolding
```

## License

MIT
