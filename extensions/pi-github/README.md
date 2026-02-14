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
| `/gh-pr-create [title]` | Create PR for current branch |
| `/gh-pr-review [pr-number]` | Show PR review feedback |
| `/gh-pr-fix [pr-number]` | Fetch unresolved review threads, send to agent |
| `/gh-pr-resolve` | Resolve threads on GitHub after fixing, post summary |
| `/gh-actions [branch]` | List recent workflow runs |

## PR Fix Workflow

The `/gh-pr-fix` → `/gh-pr-resolve` flow automates PR review feedback resolution:

1. **`/gh-pr-fix`** — Fetches unresolved review threads from the PR on the current branch
   - Presents all threads to the agent with file paths, line numbers, and reviewer comments
   - Agent reads the feedback and makes the necessary code changes

2. **Fix & commit** — Agent fixes the issues and commits

3. **`/gh-pr-resolve`** — After fixing:
   - Resolves each review thread on GitHub via GraphQL
   - Pushes the branch
   - Posts a summary comment on the PR listing what was fixed and the commit SHA

### Example

```
/gh-pr-fix          # fetches 3 unresolved threads, sends to agent
# ... agent fixes the code, commits ...
/gh-pr-resolve      # resolves threads, pushes, posts summary
```

## Requirements

- `gh` CLI installed and authenticated (`gh auth login`)
- Git repository with GitHub remote

## Development

```bash
npm install
npm run typecheck
```
