# pi-github

GitHub integration for pi via the `gh` CLI. Provides `/gh-*` and `/github-*` commands for PR management, issue tracking, CI status, and automated review feedback resolution.

## Commands

All commands are available as both `/gh-*` (short) and `/github-*` (long) variants.

| Command | Description |
|---------|-------------|
| `/gh-prs [mine\|review-requested\|all]` | List open pull requests |
| `/gh-issues [mine\|label:name\|all]` | List open issues |
| `/gh-status` | Repo status: PRs, issues, CI, current branch PR |
| `/gh-notifications [all]` | Show unread GitHub notifications |
| `/gh-pr-create [title]` | Create PR for current branch (pushes first) |
| `/gh-pr-review [pr-number]` | Show PR review feedback and decision |
| `/gh-pr-fix [pr-number]` | Fetch unresolved review threads, checkout PR branch, send to agent |
| `/gh-pr-resolve` | Resolve threads on GitHub, push, post summary comment |
| `/gh-actions [branch]` | List recent workflow runs |

## PR Fix Workflow

The `/gh-pr-fix` → `/gh-pr-resolve` flow automates PR review feedback resolution:

1. **`/gh-pr-fix [pr-number]`** — Fetches unresolved review threads via GraphQL
   - Auto-detects PR from current branch, or accepts a PR number (with or without `#` prefix)
   - On `main`/`master`, finds the most recent PR with changes requested
   - Checks for dirty working tree before switching branches
   - Safely checks out the PR branch (fetches + creates tracking branch if needed)
   - Formats all threads with file paths, line numbers, and reviewer comments
   - Sends structured prompt to the agent for fixing

2. **Fix & commit** — Agent reads the feedback, fixes the code, and commits

3. **`/gh-pr-resolve`** — After the agent commits:
   - Verifies current branch matches the PR branch
   - Pushes with `git push origin HEAD` (works without upstream tracking)
   - Resolves each review thread on GitHub via GraphQL mutation
   - Posts a summary comment listing resolved threads and fix commit SHA

### Example

```
/gh-pr-fix 5        # fetches unresolved threads from PR #5, checks out branch
# ... agent fixes the code, commits ...
/gh-pr-resolve      # pushes, resolves threads, posts summary
```

## Architecture

| File | Purpose |
|------|---------|
| `index.ts` | Extension lifecycle — session cwd tracking, command registration |
| `commands.ts` | All `/gh-*` commands: prs, issues, status, notifications, pr-create, actions, pr-review |
| `pr-fix.ts` | `/gh-pr-fix` and `/gh-pr-resolve` — thread fetching, branch checkout, resolution, summary comments |
| `gh.ts` | `gh` CLI wrapper — exec, JSON parsing, GraphQL helper, git helpers |
| `logger.ts` | Structured logging via pi-logger event bus |

## Requirements

- `gh` CLI installed and authenticated (`gh auth login`)
- Git repository with GitHub remote

## Development

```bash
npm install
npm run typecheck
```
