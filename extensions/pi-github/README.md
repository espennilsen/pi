# @e9n/pi-github

GitHub integration for [pi](https://github.com/espennilsen/pi) via the `gh` CLI — PR management, issue tracking, CI status, and automated review resolution.

## Features

- List and manage PRs, issues, and notifications
- Create and merge PRs from the current branch
- Automated PR review fix flow: fetch unresolved threads → fix → resolve on GitHub
- All commands available as both `/gh-*` and `/github-*` variants

## Requirements

- [`gh` CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)
- Git repository with a GitHub remote

## Commands

| Command | Description |
|---------|-------------|
| `/gh-prs [mine\|review-requested\|all]` | List open pull requests |
| `/gh-issues [mine\|label:name\|all]` | List open issues |
| `/gh-status` | Repo status: open PRs, issues, CI, current branch PR |
| `/gh-notifications [all]` | Show unread GitHub notifications |
| `/gh-pr-create [title]` | Create a PR for the current branch (pushes first) |
| `/gh-pr-review [pr-number]` | Show PR review feedback and decision |
| `/gh-pr-fix [pr-number]` | Fetch unresolved review threads and send to agent for fixing; run again with thread numbers to push, resolve, and post summary |
| `/gh-pr-merge [pr-number]` | Merge a PR, delete remote branch, pull base, clean up local branch |
| `/gh-actions [branch]` | List recent workflow runs |

### PR fix workflow

1. **`/gh-pr-fix [pr-number]`** — fetches unresolved review threads, checks out the PR branch, and sends a structured prompt to the agent
2. Agent reads the feedback, fixes the code, and commits
3. **`/gh-pr-fix 1 2 3`** (with thread numbers) — pushes, resolves the listed threads on GitHub via GraphQL, and posts a summary comment

## Install

```bash
pi install npm:@e9n/pi-github
```

## License

MIT
