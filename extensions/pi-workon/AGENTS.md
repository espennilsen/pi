---
name: pi-workon
description: Project context switching for pi — resolves project names, detects stacks, loads AGENTS.md/git/td, and scaffolds new projects
---

## Overview

Provides two LLM tools for project management: `workon` (switch context, show status, list projects) and `project_init` (detect stack, scaffold AGENTS.md/.pi/td). Exports `getActiveProject`, `detectStack`, and `resolveProject` for use by other extensions.

**Stack:** TypeScript · Node.js `fs`/`child_process` · TypeBox · pi-ai `StringEnum`

## Architecture

- `src/index.ts` — Entry point. Registers both tools on `session_start` after resolving settings.
- `src/tool.ts` — `registerWorkonTool` and `registerProjectInitTool`. Holds module-level `activeProject` state. Contains git helpers (`getGitStatus`, `getGitLog`, `getGitStash`), td helper (`getTdIssues`), and `buildProjectContext()` (assembles markdown context for LLM).
- `src/detector.ts` — `detectStack(path)` → `ProjectProfile`. Scans filesystem for language, package manager, frameworks, test framework, linting, workspaces, Docker, CI, git branch.
- `src/resolver.ts` — `resolveProject(input, devDir)` → `ResolveResult`. Tries: absolute path → exact dir match → alias lookup → case-insensitive → fuzzy contains. `listProjectDirs()` scans devDir, excludes `.`, `!`, `Archive`.
- `src/scaffold.ts` — `generateAgentsMd(profile)` → string, `generatePiSettings(profile)` → object, `initProject(path, profile, options)` → `InitResult`. Creates AGENTS.md, `.pi/settings.json`, runs `td init`.
- `src/settings.ts` — `resolveSettings(cwd)` merges global (`~/.pi/agent/settings.json`) and project (`.pi/settings.json`) under key `"pi-workon"`. Expands `~` paths.
- `src/logger.ts` — Log helper emitting to `log` event with channel `"workon"`.

## Tools

### `workon`

| Action | Behaviour |
|--------|-----------|
| `switch` | Resolves project name, calls `buildProjectContext()`, sets `activeProject` |
| `status` | Re-builds context for current `activeProject` |
| `list` | Lists all dirs in devDir with git branch / AGENTS.md / td badges |

`buildProjectContext()` returns a markdown block with: stack summary, full AGENTS.md content (truncated at 4000 chars), git status + log + stash, td issue summary.

### `project_init`

| Action | Behaviour |
|--------|-----------|
| `detect` | Dry-run: returns `ProjectProfile` + preview of what would be generated |
| `init` | Writes AGENTS.md, `.pi/settings.json`, runs `td init` |
| `batch` | Scans all devDir projects, returns readiness table (needs AGENTS.md / .pi / td) |

Options: `force` (overwrite AGENTS.md), `skip_td`, `skip_agents_md`, `skip_pi_dir`.

## Stack Detection (`ProjectProfile`)

`detectStack()` scans the filesystem and returns: `language` (ts/js/python/rust/go), `packageManager` (pnpm/yarn/bun/npm/poetry/cargo/go), `frameworks` (30+ dep checks: Next.js, React, Eleventy, Hono, Drizzle, Tailwind, Vitest…), `monorepo` + `workspaces`, `testFramework`, `linting` (ESLint/Prettier/Biome/Ruff), `docker`, `ci`, `git`, `gitBranch`, `hasAgentsMd`, `hasPiDir`, `hasTd`.

## Project Resolution

`resolveProject()` resolution order:
1. Absolute / `~/` / `./` path → direct stat
2. Exact directory name in `devDir`
3. Alias lookup (hardcoded in `resolver.ts` — e.g. `hannah → pi`, `blog → e9n.dev`, `hovdan → Hovdan Seil AS`)
4. Case-insensitive match
5. Fuzzy substring match (errors if ambiguous)

To add a new alias, edit the `PROJECT_ALIASES` map in `src/resolver.ts`.

## Settings

```jsonc
// settings.json (global or project .pi/settings.json)
{
  "pi-workon": {
    "devDir": "~/Dev"   // Base dir scanned for projects. Default: ~/Dev
  }
}
```

Project-level `.pi/settings.json` overrides global. Settings resolved once on `session_start`.

## Scaffold Output

`generateAgentsMd()` produces a structured AGENTS.md with: td mandate, project overview, quick-start commands, directory layout, conventions (linting/test/language), key config files.

`generatePiSettings()` writes `{ "skills": ["td", "code-review", "github", ...] }` — skills auto-selected based on detected stack (e.g. Eleventy → adds `blog-post`).

## Exports

`getActiveProject()`, `detectStack()`, `resolveProject()` are re-exported from `index.ts` for consumption by other extensions that need active-project state or stack info without registering their own tools.
