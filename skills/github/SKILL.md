---
name: github
description: Manage GitHub repos, issues, PRs, releases, and workflows using the gh CLI. Use for creating repos, managing issues/PRs, checking CI status, browsing notifications, and repo administration.
---

# GitHub — gh CLI

Manage Espen's GitHub account (`espennilsen`) via the `gh` CLI.

## Prerequisites

- `gh` is installed at `/opt/homebrew/bin/gh`
- Authenticated to `github.com` as `espennilsen`
- Default protocol: HTTPS

## ⚠️ Safety

- **Confirm before destructive operations:** deleting repos, closing issues/PRs, force-pushing, changing visibility.
- **Confirm before creating public repos.** Default to private unless Espen says otherwise.
- **Never expose tokens or secrets** in commands or output.

## Quick Reference

### Repos

```bash
# List repos (sorted by update, shows visibility)
gh repo list espennilsen --limit 20 --json name,isPrivate,updatedAt,description \
  --jq '.[] | "\(.name) \(if .isPrivate then "🔒" else "🌐" end) \(.updatedAt[:10]) \(.description // "")"'

# View current repo info
gh repo view

# Create repo (default private — confirm before public)
gh repo create <name> --private --source=. --push
gh repo create <name> --public --source=. --push

# Clone
gh repo clone espennilsen/<repo>

# Set description / topics
gh repo edit --description "New description"
gh repo edit --add-topic ai,typescript

# Delete (⚠️ confirm first)
gh repo delete espennilsen/<repo> --yes

# Fork an external repo
gh repo fork <owner/repo> --clone
```

### Issues

```bash
# List open issues
gh issue list
gh issue list --state all --limit 20
gh issue list --label "bug" --assignee "@me"

# View issue details
gh issue view <number>

# Create issue
gh issue create --title "Title" --body "Description"
gh issue create --title "Title" --body "Description" --label "bug,priority:high" --assignee "@me"

# Create from file (for longer descriptions)
gh issue create --title "Title" --body-file issue.md

# Close / reopen
gh issue close <number> --reason "completed"
gh issue reopen <number>

# Comment
gh issue comment <number> --body "Comment text"

# Edit
gh issue edit <number> --title "New title" --add-label "enhancement"

# Transfer to another repo
gh issue transfer <number> <destination-repo>
```

### Pull Requests

```bash
# List PRs
gh pr list
gh pr list --state all --limit 20
gh pr list --author "@me"

# View PR details (diff, checks, reviews)
gh pr view <number>
gh pr diff <number>
gh pr checks <number>

# Create PR
gh pr create --title "Title" --body "Description"
gh pr create --title "Title" --body "Description" --base main --head feature-branch
gh pr create --fill  # Auto-fill from commits
gh pr create --draft

# Review
gh pr review <number> --approve
gh pr review <number> --request-changes --body "Changes needed"
gh pr review <number> --comment --body "Looks good overall"

# Merge
gh pr merge <number> --merge    # merge commit
gh pr merge <number> --squash   # squash and merge
gh pr merge <number> --rebase   # rebase and merge
gh pr merge <number> --auto     # auto-merge when checks pass

# Close without merging
gh pr close <number>
```

### Workflows & CI

```bash
# List workflows
gh workflow list

# View recent runs
gh run list --limit 10
gh run list --workflow "ci.yml" --limit 5

# View run details
gh run view <run-id>
gh run view <run-id> --log-failed  # Only failed step logs

# Watch a run in progress
gh run watch <run-id>

# Re-run failed jobs
gh run rerun <run-id> --failed

# Trigger a workflow manually
gh workflow run <workflow-name> --ref main
```

### Releases

```bash
# List releases
gh release list --limit 10

# View release
gh release view <tag>

# Create release
gh release create <tag> --title "v1.0.0" --notes "Release notes"
gh release create <tag> --generate-notes   # Auto-generate from commits
gh release create <tag> --draft             # Draft release

# Upload assets to existing release
gh release upload <tag> ./dist/binary.tar.gz

# Delete release (⚠️ confirm)
gh release delete <tag> --yes
```

### Notifications

```bash
# List unread notifications
gh api notifications --jq '.[] | "\(.subject.type): \(.subject.title) (\(.repository.full_name))"'

# Mark all as read
gh api -X PUT notifications

# Mark specific thread as read
gh api -X PATCH notifications/threads/<id>
```

### Gists

```bash
# List gists
gh gist list --limit 10

# Create gist
gh gist create <file> --desc "Description"
gh gist create <file> --public --desc "Description"

# View gist
gh gist view <id>

# Edit gist
gh gist edit <id>
```

### Search

```bash
# Search repos
gh search repos "query" --owner espennilsen
gh search repos "topic:ai language:typescript"

# Search issues/PRs across repos
gh search issues "bug" --owner espennilsen --state open
gh search prs "review-requested:@me"

# Search code
gh search code "function name" --owner espennilsen
```

### API (for anything not covered above)

```bash
# Generic API calls
gh api repos/espennilsen/<repo>
gh api repos/espennilsen/<repo>/contributors --jq '.[].login'

# GraphQL
gh api graphql -f query='{ viewer { login repositories(first: 5) { nodes { name } } } }'

# Paginated results
gh api repos/espennilsen/<repo>/issues --paginate --jq '.[].title'
```

## Repo ↔ Dev Folder Mapping

When working with a specific project, `cd` into its Dev folder first so `gh` picks up the repo context automatically:

```bash
cd /Users/espen/Dev/<project>
gh repo view
gh issue list
gh pr list
```

If the local repo doesn't have a GitHub remote, use the explicit form:

```bash
gh issue list --repo espennilsen/<repo>
gh pr list --repo espennilsen/<repo>
```

## Common Workflows

### Start a feature (use git worktrees — never checkout in main dir)
```bash
# Create an isolated worktree for the feature branch
git worktree add ../pi-worktrees/<task-id>/<name> -b <task-id>/<name>
cd ../pi-worktrees/<task-id>/<name>
# ... work ...
git push -u origin <task-id>/<name>
gh pr create --fill --draft
```

### Ship it
```bash
gh pr ready <number>          # Mark as ready for review
gh pr merge <number> --squash # Squash-merge after checks pass
# Clean up the worktree after merge
git worktree remove ../pi-worktrees/<task-id>/<name>
git branch -d <task-id>/<name>
gh release create v<x.y.z> --generate-notes
```

### Triage issues
```bash
gh issue list --label "triage" --json number,title,createdAt \
  --jq '.[] | "#\(.number) \(.title) (\(.createdAt[:10]))"'
```

### Check what needs attention
```bash
# PRs waiting for my review
gh search prs "review-requested:espennilsen is:open" --json repository,title,url \
  --jq '.[] | "\(.repository.nameWithOwner): \(.title)"'

# My open PRs across all repos
gh search prs "author:espennilsen is:open" --json repository,title,url \
  --jq '.[] | "\(.repository.nameWithOwner): \(.title)"'

# Failed CI runs today
gh run list --limit 20 --json status,name,conclusion,updatedAt \
  --jq '.[] | select(.conclusion == "failure") | "\(.name) — \(.updatedAt[:10])"'
```

## Conventions

- Default new repos to **private** unless explicitly told otherwise
- Use **squash merge** as default merge strategy
- Tag releases as `v<semver>` (e.g., `v1.0.0`)
- Use `--json` + `--jq` for structured output when processing results
- For multi-line issue/PR bodies, write to a temp file and use `--body-file`
