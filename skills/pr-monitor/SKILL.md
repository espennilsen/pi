---
name: pr-monitor
description: |
  Monitor open GitHub PRs across all repos in ~/Dev. Checks PR age, flags stale PRs,
  and optionally alerts via Aivena/Telegram. Uses `gh pr list` for accurate GitHub data.

  **TRIGGERS - Use this skill when:**
  - User asks about open PRs, pull requests, or PR status
  - User says "check PRs", "any stale PRs?", "PR review status"
  - Cron job `pr-monitor` fires
  - User asks "what needs review?" or "what's waiting for merge?"
  - User wants a PR dashboard or PR age report
---

# PR Monitor Skill

Scan all GitHub-hosted repos in `~/Dev` for open pull requests. Flag stale PRs and report status.

## Procedure

### Step 1: Scan all repos for open PRs

Run this exact command to collect all open PRs:

```bash
for dir in ~/Dev/*/; do
  if [ -d "$dir/.git" ]; then
    cd "$dir"
    remote=$(git remote get-url origin 2>/dev/null)
    if echo "$remote" | grep -q github.com; then
      repo=$(echo "$remote" | sed 's/.*github.com[:/]\(.*\)\.git/\1/' | sed 's/.*github.com[:/]\(.*\)/\1/')
      prs=$(gh pr list --repo "$repo" --state open --json number,title,createdAt,headRefName,author,isDraft,reviewDecision 2>/dev/null)
      pr_count=$(echo "$prs" | jq 'length' 2>/dev/null || echo "0")
      if [ "$pr_count" -gt 0 ]; then
        echo "=== $(basename "$dir") ($repo) ==="
        echo "$prs" | jq -r '.[] | "  #\(.number) [\(.headRefName)] \(.title) (by \(.author.login), created \(.createdAt[:10]), draft: \(.isDraft), review: \(.reviewDecision // "none"))"'
        echo ""
      fi
    fi
  fi
done
```

### Step 2: Calculate PR age

For each PR, calculate age from `createdAt` to today. Classify as:
- **🟢 Fresh** — 0–1 days old
- **🟡 Aging** — 2–3 days old
- **🔴 Stale** — 4+ days old

### Step 3: Format the report

Output a table with columns:

| Repo | PR | Branch | Title | Author | Age | Status | Review |
|------|-----|--------|-------|--------|-----|--------|--------|

Group by repo. Show age badge (🟢/🟡/🔴). Include draft status and review decision.

### Step 4: Summary

End with:
- **Total open PRs** across all repos
- **Stale count** (4+ days) — these need attention
- **Aging count** (2–3 days) — these are approaching stale
- **Action items** — specific PRs that need review or merge

### Step 5: Deduplication check (before alerting)

**Before sending any Telegram alert**, check today's daily memory log for PRs already covered:

```
memory_read(target: "daily")
```

Scan the result for PR references matching `[repo] #[number]`. Any stale PR already mentioned in today's standup or a prior pr-monitor alert should be **excluded** from the new alert.

- If **all** stale PRs were already reported today → skip the alert entirely (no noise)
- If **some** are new → send alert only for the new ones
- If **none** were previously reported → send the full alert

### Step 6: Alert (only for net-new stale PRs)

If net-new stale PRs remain after dedup, send an alert to Aivena via `a2a_send`:

```
Hey Aivena — PR staleness alert for Espen. Please relay to Telegram.

⚠️ [N] stale PR(s) found (4+ days old, not yet reported today):
- [repo] #[number]: [title] ([age] days)
...

These need review or merge.
— Fury
```

If no stale PRs exist, or all were already covered today, do nothing (no noise).

## Notes

- Requires `gh` CLI authenticated (`gh auth status`)
- Requires `jq` for JSON parsing
- Only scans repos with GitHub remotes
- Draft PRs are included but noted — they're expected to age longer
- The `reviewDecision` field shows: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or none
