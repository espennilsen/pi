---
description: Fix unresolved PR review threads — read code, apply fixes, commit, push, and report
---
Fix the unresolved review threads on this PR. For each thread:

1. Read the referenced file(s) and surrounding context
2. Understand the reviewer's concern
3. Apply the fix surgically (edit only what's needed)
4. Verify the fix compiles (`tsc --noEmit` or equivalent)

After all fixes are applied:

5. Stage, commit (use a descriptive conventional commit message referencing the PR), and push to the current branch
6. Verify the push succeeded

Report a summary to the user that includes:
- What was fixed per thread (one bullet each)
- The commit hash and branch pushed to
- Confirmation the push succeeded

$@
