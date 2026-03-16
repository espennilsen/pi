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

## Resolving Merge Conflicts

When a PR has merge conflicts (GitHub shows "CONFLICTING" / "DIRTY"):

### Step 1: Go to the PR's worktree

```bash
cd ../pi-worktrees/<task-id>/<name>
```

### Step 2: Fetch and merge main

```bash
git fetch origin main
git merge origin/main
```

### Step 3: Resolve conflicts

For each conflicted file:

1. Read the file — look for `<<<<<<<`, `=======`, `>>>>>>>` markers
2. Understand both sides: HEAD (PR branch) vs origin/main
3. Decide which version to keep, or combine both
4. Remove all conflict markers
5. Repeat for all conflicted files

**Resolution strategy:**
- Take main's version for improvements that landed after the PR (bug fixes,
  refactors, security hardening)
- Keep the PR's version for the feature being added
- Combine when both sides changed the same area for different reasons
- Watch for duplicate code left after conflict blocks (git leaves both sides)

### Step 4: Verify and commit

```bash
# Check no conflict markers remain
bash scripts/check-conflicts.sh <files>

# Typecheck
npx tsc --noEmit

# Stage and commit
git add <files>
git commit -m "fix: resolve merge conflicts with main"
git push origin <branch>
```

**Never merge without user confirmation** after resolving conflicts.

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
