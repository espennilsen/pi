# PR Merge — Merge + Cleanup

Merge a PR and clean up all associated branches and worktrees.

## Quick Path

```
/gh-pr-merge [number | owner/repo#N | PR-URL] [--squash|--merge|--rebase]
```

Default: `--squash`. Auto-detects PR from current branch.

The command handles the full workflow:

1. Fetches PR details, shows pre-merge summary
2. Merges via selected strategy
3. Verifies merge state (checks API after merge)
4. Posts summary comment (strategy, stats, changed files)
5. Deletes remote branch
6. Removes worktree (if safe — warns if running from inside it)
7. Checks out base branch, pulls latest
8. Deletes local branch (`-D` for squash/rebase since SHAs diverge)
9. Prunes stale remote refs

## Manual Workflow

### Merge

```bash
gh pr merge <number> --squash
```

### Verify

```bash
gh pr view <number> --json state --jq '.state'
# Must be "MERGED"
```

### Clean up

```bash
# Remote branch
git push origin --delete <branch>

# Worktree
git worktree list
git worktree remove ../pi-worktrees/<task-id>/<name>

# Base branch
git checkout main && git pull --ff-only

# Local branch
git branch -D <branch>

# Stale refs
git fetch --prune
```

## Edge Cases

| Situation | Behavior |
|-----------|----------|
| Already merged | Skips to cleanup |
| Running from worktree | Warns, can't auto-remove current worktree |
| Base branch in another worktree | Pulls in that worktree |
| Merge blocked | Reports whether approvals or CI are needed |
| Squash/rebase + local commits | Skips local-only commit warning (SHAs diverge) |

## Conventions

- Default strategy: **squash**
- Always verify merge state — `gh pr merge` can exit 0 without merging
- Post summary comment with strategy, stats, and file list
- Clean up empty worktree parent dirs after removal
