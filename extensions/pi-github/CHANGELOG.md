# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-02-17

### Changed

- `/gh-pr-create` now gathers commits and diff, has the LLM draft a PR title and description, asks the user for input, and only creates the PR after confirmation. Replaces the previous `--fill` shortcut.

### Removed

- `/gh-pr-open` / `/github-pr-open` — removed before first publish.

## [0.1.0] - 2026-02-17 (7839f93)

### Added

- Initial release
- All commands accept repo refs (`owner/repo#N`, PR URLs, plain numbers) — no longer limited to cwd repo
- `defaultOwner` setting in `settings.json` under `pi-github` — enables short refs like `repo#N`
- Smart PR discovery: `/gh-pr-fix` without args scans all open PRs for unresolved review threads
- Local clone resolution: auto-finds `~/Dev/<repo>` when targeting remote repos
- `/gh-pr-fix` presents thread IDs and `gh api graphql` commands for the agent to resolve threads directly
- `.npmignore` and npm publish metadata (`files`, `repository`)
- `AGENTS.md` with architecture docs

### Changed

- `/gh-pr-fix` simplified to single-step flow — no more two-phase resolve workflow
- `/gh-pr-fix` replies to each thread with fix summary before resolving
- All commands (`/gh-status`, `/gh-issues`, `/gh-actions`, `/gh-pr-review`, `/gh-pr-merge`) now accept `owner/repo` refs
- Removed stateful `activePrFix` session tracking — agent handles resolution via CLI commands
