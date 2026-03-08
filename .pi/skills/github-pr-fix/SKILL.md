---
name: github-pr-fix
description: >
  Fix unresolved PR review threads — fetch feedback, assess each thread,
  apply surgical fixes, commit, push, resolve threads on GitHub, and post
  a summary comment.

  **Triggers — use this skill when:**
  - User says "fix PR", "fix review feedback", "address PR comments"
  - User pastes PR review threads or review bot output
  - User says "resolve review threads", "handle PR feedback"
  - User mentions "/gh-pr-fix" or "pr-fix" workflow
  - User asks to "go through PR comments and fix them"
  - User shares a GitHub PR URL with review feedback to address

  **Covers:** Any GitHub PR with unresolved review threads. Fetches threads
  via GraphQL, presents assessment, applies fixes, commits, pushes, resolves
  threads, and posts a summary comment.
---

# GitHub PR Fix — Review Thread Resolution

Fix unresolved review threads on a GitHub pull request. This is the manual
workflow equivalent of the `/gh-pr-fix` command from the `pi-github` extension.

## Prerequisites

- `gh` CLI installed and authenticated
- On the PR's feature branch (or in its worktree)
- Push access to the repo

## Workflow

### Step 1: Identify the PR

If the user hasn't provided a PR number, detect it:

```bash
# From current branch
gh pr view --json number,title,headRefName,url

# Or list open PRs with review feedback
gh pr list --state open --json number,title,headRefName
```

### Step 2: Fetch unresolved review threads

Use this GraphQL query to fetch all unresolved threads:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      number
      title
      headRefName
      url
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          path
          line
          comments(first: 20) {
            nodes {
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}' -F owner=OWNER -F repo=REPO -F prNumber=NUMBER
```

Filter to only unresolved threads (`isResolved: false`) with at least one comment.

### Step 3: Present assessment to user

For each unresolved thread, present:

1. **Location** — file path and line number
2. **Reviewer feedback** — the reviewer's comment (and any follow-ups)
3. **Your assessment** — agree / disagree / needs discussion
4. **Classification** if provided by reviewer:
   - 🔴 **BLOCKER** — must fix
   - 🟡 **WARNING** — fix if straightforward
   - ⚪ **SUGGESTION** — fix only if trivial

**Wait for user confirmation** before making any code changes. If any feedback
is ambiguous, subjective, or you disagree with it, flag it and ask the user.

### Step 4: Apply fixes

For each confirmed thread:

1. Read the referenced file and surrounding context
2. Understand the reviewer's concern
3. Apply the fix surgically — edit only what's needed, don't refactor surrounding code
4. Verify the fix compiles: `npx tsc --noEmit` or project-appropriate check

### Step 5: Commit and push

```bash
# Stage and commit with a descriptive message
git add <files>
git commit -m "fix: address review feedback — <brief summary>

- file1: description of change
- file2: description of change"

# Push to the PR branch
git push origin <branch>
```

### Step 6: Resolve threads on GitHub

For each addressed thread, reply with a summary then resolve:

```bash
# Reply to the thread
gh api graphql -f query='mutation {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "THREAD_ID",
    body: "Fixed — <brief description of what was done>"
  }) { comment { id } }
}'

# Resolve the thread
gh api graphql -f query='mutation {
  resolveReviewThread(input: {
    threadId: "THREAD_ID"
  }) { thread { isResolved } }
}'
```

**Thread disposition:**
- **Fixed** → reply with fix description, then resolve
- **WONTFIX** → reply with `WONTFIX: <reason>`, then resolve
- **Skipped** (SUGGESTION) → leave open, note in summary
- **Needs discussion** → leave open

### Step 7: Post summary comment on the PR

```bash
gh pr comment <NUMBER> -R <owner/repo> --body 'All N review threads addressed in <commit-hash>:

1. **`file:line` — issue**: Description of fix
2. **`file:line` — issue**: Description of fix
...'
```

### Step 8: Report to user

Provide a summary including:
- What was fixed per thread (one bullet each)
- Any WONTFIX threads and the reason
- Any SUGGESTION threads intentionally skipped
- Commit hash and branch pushed to
- Confirmation that GitHub threads were resolved

## Rules

- **Never fix without user confirmation** — always present assessment first
- **Surgical edits only** — don't refactor surrounding code or "improve" things not mentioned in feedback
- **Don't re-fix resolved threads** — skip threads already resolved or where WONTFIX was accepted
- **Verify compilation** — run typecheck before committing
- **One commit per fix round** — batch all fixes into a single commit unless logically separate
- **Keep changes minimal** — the reviewer will re-review only new commits, so minimize new surface area

## Tips

- If the PR branch is in a worktree, work in the worktree directory
- Use `git add -f` if files are in gitignored directories (some extensions gitignore `src/`)
- For multi-byte string safety in Node.js HTTP body parsing, always use `Buffer[]` collection + `Buffer.concat().toString('utf8')`
- For event-bus reply patterns, guard fallback `resolve()` with a `replied` flag
