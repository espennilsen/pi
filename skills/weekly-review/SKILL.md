---
name: weekly-review
description: Run a structured weekly review covering projects, habits, goals, and planning. Use when asked for a weekly review, week summary, or weekly planning session.
---

# Weekly Review

## Purpose

Help Espen reflect on the past week and plan the next one. Covers professional projects, personal development, health, and learning goals.

## Process

### 1. Gather Context

Read recent activity to build a picture of the week:

```bash
# Recent daily notes (last 7)
VAULT="/Users/espen/Library/CloudStorage/OneDrive-Espennilsen.net/2-Areas/Digital_Life/Obsidian/e9n"
ls -t "$VAULT/Notes/Daily/" | head -7
```

```bash
# Recent git activity across projects
for d in /Users/espen/Dev/e9n.dev /Users/espen/Dev/pi /Users/espen/Dev/Starheim /Users/espen/Dev/x10s-pi; do
  echo "=== $(basename $d) ==="
  git -C "$d" log --oneline --since="7 days ago" --no-merges 2>/dev/null | head -5
done
```

```bash
# Hannah job stats for the week
sqlite3 /Users/espen/Dev/pi/hannah.db "
  SELECT COUNT(*) as jobs, printf('\$%.4f', SUM(cost_total)) as cost, SUM(total_tokens) as tokens
  FROM jobs WHERE created_at >= datetime('now', '-7 days');
"
```

### 2. Review Structure

Present findings organized as:

**🏆 Wins** — What went well, what was accomplished
**📋 Active Projects** — Status of each active project, progress this week
**🎯 Goals Check-in** — Health, learning, personal development progress
**⚡ Blockers** — What's stuck and why
**📅 Next Week** — Top 3 priorities, scheduled commitments, experiments to try

### 3. Ask Espen

After presenting the review, ask:
- "Anything I missed or got wrong?"
- "What should be the #1 priority next week?"
- "Any new projects or ideas to capture?"

### 4. Capture (with permission)

If Espen wants, create a weekly review note in the vault:
```
Weekly Reviews/YYYY-WNN Review.md
```

**Always confirm before writing to the vault.**

## Tone

Supportive but honest. Celebrate wins. Don't sugarcoat missed goals — frame them as data for adjustment, not failure. Channel stoic philosophy: focus on what's within control, let go of what isn't.
