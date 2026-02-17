# @e9n/pi-npm

NPM workflow extension for [pi](https://github.com/mariozechner/pi-coding-agent). Gives the agent a single `npm` tool covering the full package management lifecycle.

## Features

- **15 actions** — everything from `init` to `publish` in one tool
- **Safe dry-run** — `dry_run: true` adds `--dry-run` to publish/pack/version
- **Custom working directory** — target any subdirectory with the `path` parameter
- **Truncated output** — long outputs are capped at 8 000 chars to keep context clean

## Tool: `npm`

Run common npm commands. The `action` field maps to the npm CLI; `args` passes through extra flags or package names.

### Actions

| Action | npm command | Example `args` |
|--------|-------------|----------------|
| `init` | `npm init` | `-y` |
| `install` | `npm install` | `express`, `--save-dev tsx` |
| `uninstall` | `npm uninstall` | `lodash` |
| `update` | `npm update` | `react` |
| `outdated` | `npm outdated` | |
| `run` | `npm run` | `dev`, `lint` |
| `test` | `npm test` | |
| `build` | `npm run build` | |
| `publish` | `npm publish` | `--tag beta` |
| `pack` | `npm pack` | |
| `version` | `npm version` | `patch`, `minor`, `major` |
| `info` | `npm info` | `react versions` |
| `list` | `npm list` | `--depth=0` |
| `audit` | `npm audit` | `--fix` |
| `link` | `npm link` | `../my-lib` |

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | npm action to perform (required) |
| `args` | string | Additional CLI arguments (package names, script names, flags) |
| `path` | string | Working directory — defaults to current project root |
| `dry_run` | boolean | Appends `--dry-run` to `publish`, `pack`, or `version` |

## Install

```bash
pi install npm:@e9n/pi-npm
```

## License

MIT
