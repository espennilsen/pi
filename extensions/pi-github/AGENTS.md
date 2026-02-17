---
name: pi-github
description: GitHub integration extension for pi — PR management, issue tracking, CI status, and review workflows via gh CLI commands
---

## Overview

Commands-only extension providing rich GitHub workflows via the `gh` CLI. No LLM tool — all interactions are triggered by the user from the TUI. Every command is registered under both a short `/gh-*` alias and a long `/github-*` alias. Key workflows: listing PRs/issues/notifications, creating PRs, showing review feedback, fixing unresolved review threads (with agentic implementation loop), merging PRs with branch cleanup, and checking CI status.

**Stack:** TypeScript · `gh` CLI · `execFile` (no SDK) · GraphQL (for PR thread resolution)

## Architecture

```
src/
├── index.ts     # Entry — registers all commands, handles lifecycle (cwd, session resets)
├── commands.ts  # All standard /gh-* commands (prs, issues, status, notifications, pr-create, pr-review, actions)
├── pr-fix.ts    # /gh-pr-fix — fetches unresolved review threads via GraphQL, launches agentic fix loop
├── pr-merge.ts  # /gh-pr-merge — squash/merge PR, post summary comment, delete branches, pull base
├── gh.ts        # gh CLI wrapper: gh(), ghJson(), ghGraphql(), gitExec(), getCurrentBranch(), getRepoSlug()
└── logger.ts    # Extension logger
prompts/
└── gh-pr-fix.md # Prompt template injected into the agentic PR-fix flow
```

## Key Files

- `src/index.ts` — Calls `registerCommands`, `registerPrFixCommand`, `registerPrMergeCommand`; tracks `cwd` across `session_start`, `session_switch`, `session_fork`.
- `src/commands.ts` — `registerDualCommand` helper; registers: `gh-prs`, `gh-issues`, `gh-status`, `gh-notifications`, `gh-pr-create`, `gh-pr-review`, `gh-actions`.
- `src/pr-fix.ts` — GraphQL query for unresolved review threads; presents threads to agent; agent reads, fixes, commits, pushes, resolves.
- `src/pr-merge.ts` — Fetches PR metadata, squash-merges (configurable), posts summary comment, deletes remote + local branch, pulls base.
- `src/gh.ts` — All `gh`/`git` subprocess calls. 30s timeout, 5 MB buffer.
- `prompts/gh-pr-fix.md` — Registered as a prompt template; injected into the PR-fix agentic flow with thread context.

## Tools

None — this extension registers no LLM tools.

## Commands

- `/gh-prs` / `/github-prs` — List open PRs (filters: `mine`, `review-requested`, `all`)
- `/gh-issues` / `/github-issues` — List open issues (filters: `mine`, `label:<name>`, `all`)
- `/gh-status` / `/github-status` — Repo overview: PR/issue counts, review status, CI, current branch PR
- `/gh-notifications` / `/github-notifications` — Unread GitHub notifications
- `/gh-pr-create` / `/github-pr-create` — Push branch, gather diff, have LLM draft title+description, confirm with user, then create PR
- `/gh-pr-review` / `/github-pr-review` — Show review feedback for current branch's PR (or specified number)
- `/gh-pr-fix` / `/github-pr-fix` — Fetch unresolved review threads and launch agentic fix+commit+push loop
- `/gh-pr-merge` / `/github-pr-merge` — Merge PR, delete branches, pull base (`--merge|--rebase|--squash`)
- `/gh-actions` / `/github-actions` — List recent workflow runs (optional branch filter)

## Events

- Emits: none
- Listens: none

## Settings

None — no settings block. Requires `gh` CLI installed and authenticated (`gh auth login`).

## Database

None.

## Conventions

- All GitHub calls go through `gh` CLI — never direct API fetch. Auth is handled by `gh`.
- `registerDualCommand` registers every command as both `/gh-*` and `/github-*` from one definition.
- `cwd` is captured per-session and passed to all `gh`/`git` subprocess calls.
- `resetPrFixState()` is called on `session_switch` / `session_fork` / `session_shutdown` to clear mid-flight state.
- `prompts/gh-pr-fix.md` uses frontmatter `description` and a `$@` placeholder for injected thread context.
- No `console.log` — use the logger.
