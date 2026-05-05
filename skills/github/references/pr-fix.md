# PR Fix — Review Thread Resolution

Fix unresolved review threads on a GitHub pull request.

## ⚠️ MANDATORY CHECKLIST — Complete Every Step

After fixing code and pushing, you **MUST** resolve every review thread.
Do NOT skip this step. Do NOT hand off before all threads are resolved.

```
☐ 1. Get unresolved threads (GraphQL or /gh-pr-review)
☐ 2. Fix code issues one by one
☐ 3. Verify: npm run typecheck
☐ 4. Commit and push fixes
☐ 5. Resolve EVERY thread (GraphQL resolveReviewThread mutation)
☐ 6. Verify: all threads isResolved == true
☐ 7. Post summary comment
☐ 8. Ask user to mark as resolved via gh CLI
```

## ⚠️ Thread Resolution IS NOT Optional

**Preferred method: use the registered tools from pi-github** (no tokens needed, `gh` CLI handles auth):

```
# 1. Reply to thread (optional, but good practice)
tool: github_review_thread_reply
  thread_id: "PRRT_xxx"
  message: "Fixed — summary of change"

# 2. Resolve (MANDATORY)
tool: github_resolve_review_thread
  thread_id: "PRRT_xxx"
```

**Fallback: use gh CLI directly** (if tools aren't available):

```bash
# Resolve a single thread
gh api graphql -f query='
mutation {
  resolveReviewThread(input: {threadId: "PRRT_xxx"}) {
    thread { isResolved }
  }
}'

# Resolve all unresolved threads in one call
gh api graphql -f query='
mutation {
  t1: resolveReviewThread(input: {threadId: "PRRT_xxx"}) { thread { isResolved } }
  t2: resolveReviewThread(input: {threadId: "PRRT_yyy"}) { thread { isResolved } }
}'
```

> **Why gh CLI?** `gh api` inherits `gh auth login` credentials — no separate API
> tokens to manage. The REST API endpoints (`/repos/.../comments/.../replies`)
> sometimes return 404 for valid comment IDs; the GraphQL mutation is reliable.

## Quick Path

```
/gh-pr-fix [number | owner/repo#N | PR-URL]
```

Auto-detects PR from current branch. Fetches unresolved threads via GraphQL,
presents them with thread IDs, and provides fix instructions.

**After fixing code:** You MUST resolve threads using the GraphQL
`resolveReviewThread` mutation. Use `gh api` directly (not gh CLI wrappers
that may return 404). Verify with `isResolved == true` before finishing.

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

For each fixed thread, reply then resolve using the registered tools:

```
tool: github_review_thread_reply
  thread_id: "THREAD_ID"
  message: "Fixed — <description>"

tool: github_resolve_review_thread
  thread_id: "THREAD_ID"
```

Or use the shell scripts (legacy, still work):

```bash
bash scripts/reply-thread.sh "THREAD_ID" "Fixed — <description>"
bash scripts/resolve-thread.sh "THREAD_ID"
```

Split into two scripts for safe retries — if the reply succeeds but resolve
fails, re-run only `resolve-thread.sh` (idempotent) without posting a duplicate.

### Step 7: Post summary comment

```bash
gh pr comment <NUMBER> -R <owner/repo> --body '## Review feedback addressed ✅

All N threads resolved in <hash>:

| # | Issue | Fix |
|---|-------|-----|
| 1 | Description | What was done |'
```

## Rules

- **Interactive mode: confirm before fixing** — when working directly with a
  user, present your assessment and wait for confirmation before changing code
- **Parallel mode: auto-fix the obvious** — when running as a parallel worker,
  auto-fix straightforward threads (suggestions, warnings, clear bugs) and
  escalate ambiguous or risky ones. See [pr-fix-parallel.md](pr-fix-parallel.md).
- **Surgical edits only** — don't refactor surrounding code
- **Verify compilation** before committing
- **One commit per fix round** — batch all fixes together
- **Always use worktrees** — never checkout in main working directory
