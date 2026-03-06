---
description: Fix unresolved PR review threads — read code, apply fixes, commit, push, and report
---
Fix the unresolved review threads on this PR. For each thread:

1. Read the referenced file(s) and surrounding context
2. Understand the reviewer's concern
3. Check the thread classification:
   - 🔴 **BLOCKER** — must fix. Do not skip or defer.
   - 🟡 **WARNING** — fix if straightforward. If the fix is risky or out of scope, respond `WONTFIX: [reason]` in your report instead.
   - ⚪ **SUGGESTION** — fix only if trivial. Otherwise skip and note it in your report.
4. Apply the fix surgically (edit only what's needed — do not refactor surrounding code)
5. Verify the fix compiles (`tsc --noEmit` or equivalent)
6. **Leave a GitHub comment on the thread** describing what was done:
   - If fixed: briefly describe the change made and why it resolves the concern
   - If `WONTFIX`: explain why the fix was not applied
   - If skipped (SUGGESTION): note that it has been logged to the backlog
7. **Resolve the thread on GitHub** if the fix was applied or a `WONTFIX` was given. Leave threads open only if the fix is partial or requires further discussion.

**Do not re-fix threads already marked resolved or where a previous `WONTFIX` was accepted by the reviewer.**

After all threads are handled:

8. Stage, commit (use a descriptive conventional commit message referencing the PR), and push to the current branch
9. Verify the push succeeded

Report a summary to the user that includes:
- What was fixed per thread (one bullet each), with its classification (BLOCKER/WARNING/SUGGESTION)
- Any threads responded to with `WONTFIX` and the reason
- Any SUGGESTION threads intentionally skipped
- Confirmation that GitHub comments were left and threads resolved where applicable
- The commit hash and branch pushed to
- Confirmation the push succeeded

The reviewer will re-review only the commits pushed since its last pass and all open threads — so keep changes surgical to avoid introducing new surface area for review.