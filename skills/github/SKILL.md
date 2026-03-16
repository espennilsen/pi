---
name: github
description: >
  Interact with GitHub repos, PRs, issues, CI, and notifications via the
  pi-github extension commands and gh CLI. Use when asked to check PRs,
  list issues, view repo status, check CI, browse notifications, create or
  merge PRs, fix review feedback, or perform any GitHub operation.

  **Triggers:** "open PRs", "repo status", "CI status", "merge PR",
  "fix PR feedback", "create PR", "GitHub notifications", any /gh-* command,
  or when a GitHub PR URL is shared.
---

# GitHub — pi-github Extension

The `pi-github` extension provides `/gh-*` commands for common GitHub
operations. All commands also work as `/github-*` variants.

## Prerequisites

- `gh` CLI installed and authenticated
- For repo-scoped commands: run from a git repo, or specify the repo

## Commands

| Command | What it does |
|---------|-------------|
| `/gh-prs [mine\|review-requested] [repo]` | List open PRs |
| `/gh-issues [mine\|label:name] [repo]` | List open issues |
| `/gh-status [repo]` | Repo dashboard: PRs, issues, CI, branch PR |
| `/gh-actions [branch] [repo]` | Recent workflow runs |
| `/gh-notifications` | Unread GitHub notifications |
| `/gh-pr-create [base]` | Create PR with LLM-generated summary |
| `/gh-pr-review [number\|repo#N\|URL]` | Show PR review feedback |
| `/gh-pr-fix [number\|repo#N\|URL]` | Fix unresolved review threads |
| `/gh-pr-merge [number\|repo#N\|URL] [--squash\|--merge\|--rebase]` | Merge PR + full cleanup |

## Repo Reference Syntax

Commands accept flexible repo/PR references anywhere in args:

| Format | Example |
|--------|---------|
| GitHub URL | `https://github.com/owner/repo/pull/123` |
| Owner/repo#N | `espennilsen/pi#96` |
| Repo#N (with default owner) | `pi#96` |
| Owner/repo | `espennilsen/pi` |
| Plain number | `96` |
| No args | Auto-detect from current branch |

### Default Owner

Set in `settings.json` to skip typing the owner:

```json
{ "pi-github": { "defaultOwner": "espennilsen" } }
```

## Detailed Workflows

For complex PR operations, see the reference docs:

- **Fixing PR review threads** — [references/pr-fix.md](references/pr-fix.md)
  Read when fixing unresolved review feedback, resolving threads, or using `/gh-pr-fix`.

- **Parallel PR fixes** — [references/pr-fix-parallel.md](references/pr-fix-parallel.md)
  Read when fixing review feedback across multiple PRs simultaneously using
  parallel subagents (pool or orchestrator mode).

- **Merging PRs** — [references/pr-merge.md](references/pr-merge.md)
  Read when merging a PR, resolving merge conflicts, cleaning up branches/worktrees, or using `/gh-pr-merge`.

- **Creating PRs** — [references/pr-create.md](references/pr-create.md)
  Read when creating a PR with a generated summary, or using `/gh-pr-create`.

## Raw gh CLI

For anything the commands don't cover:

```bash
# Structured output
gh pr list --json number,title --jq '.[] | "#\(.number) \(.title)"'

# GraphQL
gh api graphql -f query='{ viewer { login } }'

# API calls
gh api repos/owner/repo/contributors --jq '.[].login'
```

## Conventions

- Default merge strategy: **squash**
- Tag releases as `v<semver>`
- Use `--json` + `--jq` for structured output
- Always use **worktrees** for feature branches — never `git checkout` in main dir
