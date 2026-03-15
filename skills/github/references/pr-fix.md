# PR Fix — Review Thread Resolution

Fix unresolved review threads on a GitHub pull request.

## Quick Path

```
/gh-pr-fix [number | owner/repo#N | PR-URL]
```

Auto-detects PR from current branch. Fetches unresolved threads via GraphQL,
presents them with thread IDs, and provides fix instructions.

## Manual Workflow

Use when threads are already provided (pasted by user or from a review bot).

### Step 1: Get unresolved threads

```bash
bash scripts/fetch-threads.sh <owner> <repo> <pr-number>
```

Returns JSON with PR info and unresolved threads (id, path, line, author, body).
Only includes threads that are unresolved and have comments.

### Step 2: Present assessment

For each thread:

1. **Location** — file path and line
2. **Feedback** — reviewer's comment
3. **Assessment** — agree / disagree / needs discussion
4. **Severity** if provided: 🔴 BLOCKER · 🟡 WARNING · ⚪ SUGGESTION

**Wait for user confirmation before making any changes.**

### Step 3: Work in the right worktree

```bash
git worktree list                    # Find existing worktree
# Or create one:
git worktree add ../pi-worktrees/<task-id>/<name> <branch>
cd ../pi-worktrees/<task-id>/<name>
```

### Step 4: Apply fixes

- Read the file and surrounding context
- Apply surgical edits — only what the reviewer asked for
- Don't refactor surrounding code
- Verify: `npx tsc --noEmit` or project-appropriate check

### Step 5: Commit and push

```bash
git add <files>
git commit -m "fix: address review feedback — <brief summary>"
git push origin <branch>
```

### Step 6: Resolve threads

For each fixed thread:

```bash
bash scripts/resolve-thread.sh "THREAD_ID" "Fixed — <description>"
```

Replies and resolves in one step. Exits non-zero if resolution fails.

### Step 7: Post summary comment

```bash
gh pr comment <NUMBER> -R <owner/repo> --body '## Review feedback addressed ✅

All N threads resolved in <hash>:

| # | Issue | Fix |
|---|-------|-----|
| 1 | Description | What was done |'
```

## Rules

- **Never fix without user confirmation** — present assessment first
- **Surgical edits only** — don't refactor surrounding code
- **Verify compilation** before committing
- **One commit per fix round** — batch all fixes together
- **Always use worktrees** — never checkout in main working directory
