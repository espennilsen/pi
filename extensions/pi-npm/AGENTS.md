---
name: pi-npm
description: NPM workflow tool for pi — wraps common npm CLI commands via child_process with a single multi-action LLM tool
---

## Overview

Minimal pi extension exposing a single `npm` LLM tool that runs npm commands via `child_process.spawn`. No database, no web UI, no commands — just a clean tool interface for the LLM to perform npm operations in the current project or a specified directory.

**Stack:** TypeScript · `child_process.spawn` · `@sinclair/typebox`

## Architecture

- `src/index.ts` — Extension entry point and complete implementation. Registers the `npm` tool, tracks `cwd` via `session_start`, runs commands via `runNpm()`.
- `src/logger.ts` — Extension logger (emits to pi-logger via `log` event).

## Tool: `npm`

Single tool with 15 actions, an optional `args` string, an optional `path` override, and an optional `dry_run` flag.

| Action | npm command | Notes |
|--------|-------------|-------|
| `init` | `npm init` | |
| `install` | `npm install` | Pass package names in `args` |
| `uninstall` | `npm uninstall` | Pass package names in `args` |
| `update` | `npm update` | |
| `outdated` | `npm outdated` | |
| `run` | `npm run` | Script name in `args` |
| `test` | `npm test` | |
| `build` | `npm run build` | Maps to `run build` |
| `publish` | `npm publish` | Supports `dry_run` |
| `pack` | `npm pack` | Supports `dry_run` |
| `version` | `npm version` | Semver bump in `args`; supports `dry_run` |
| `info` | `npm info` | Package name in `args` |
| `list` | `npm list` | |
| `audit` | `npm audit` | |
| `link` | `npm link` | |

**Parameters:**
- `action` — Required. One of the 15 actions above.
- `args` — Optional. Extra arguments appended to the command (e.g. `"lodash"`, `"patch"`, `"--workspace=."`)
- `path` — Optional. Working directory relative to `cwd` (default: current project root).
- `dry_run` — Optional boolean. Appends `--dry-run` to `publish`, `pack`, and `version` commands.

## Key Patterns

- **`build` mapping** — `action: "build"` becomes `npm run build` (not `npm build`).
- **Output truncation** — stdout and stderr are each truncated to 8 000 chars to stay within context limits.
- **Exit code in output** — Tool result always includes `**Exit: 0 ✓**` or `**Exit: N ✗**` so the LLM can detect failures.
- **Shell mode** — `spawn` uses `shell: true` so npm resolves correctly across platforms.
- **No confirmation gates** — Unlike destructive tools in other extensions, `publish` and `version` do not require `ctx.ui.confirm()`. The `dry_run` flag is the safety mechanism.

## Output Format

```
`npm <cmd>` in `/path/to/cwd`

**Exit: 0 ✓**

```
<stdout>
```

**stderr:**
```
<stderr>
```
```

## Conventions

- No `console.log` — use `createLogger(pi)`.
- `cwd` is captured from `ctx.cwd` in `session_start`; all commands run there unless `path` overrides it.
- `path` is resolved with `path.resolve(cwd, params.path)` so relative paths work correctly.
- Logging via `log("run", { action, args, cwd, exitCode }, code === 0 ? "INFO" : "ERROR")`.
