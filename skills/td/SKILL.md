---
name: td
description: Manage tasks and issues with the td CLI. Use for creating, tracking, querying, and handing off work items. Covers task lifecycle, session management, structured handoffs, epics, dependencies, and boards.
---

# td — Task & Session Management

td is a local-first task management CLI optimized for AI-assisted development workflows. It tracks issues, sessions, structured handoffs, and progress logs.

## Session Workflow

Every session follows this pattern:

1. **Start** — Load context and begin a new session:
   ```bash
   td usage --new-session    # Full context dump (issues, logs, handoffs)
   td status                 # Quick dashboard: focus, reviews, blocked, ready
   ```

2. **Pick work** — Find what to work on:
   ```bash
   td next                   # Highest-priority open issue
   td ready                  # All open issues sorted by priority
   td list --mine            # Issues assigned to current session
   ```

3. **Start an issue** — Set focus and mark in-progress:
   ```bash
   td start <issue-id>       # Sets focus + status to in_progress
   ```

4. **Log progress** — Track decisions, blockers, attempts:
   ```bash
   td log "Implemented auth middleware"              # Progress (default)
   td log --blocker "Waiting on API key from team"   # Blocker
   td log --decision "Using JWT over session tokens"  # Decision
   td log --tried "Attempted Redis caching"           # Attempted approach
   td log --result "Redis too complex, using in-memory" # Result
   td log --hypothesis "Rate limiting might fix 429s"   # Hypothesis
   ```

5. **Handoff** — Capture structured state before ending session:
   ```bash
   td handoff <issue-id> \
     --done "Implemented login endpoint" \
     --done "Added JWT validation" \
     --remaining "Add refresh token flow" \
     --remaining "Write tests for auth middleware" \
     --decision "Using RS256 for JWT signing" \
     --uncertain "Should we support OAuth2 providers?"
   ```

6. **Submit for review** — When work is complete:
   ```bash
   td review <issue-id>      # Submit for review (preferred)
   ```

7. **Review** — Different session approves or rejects:
   ```bash
   td reviewable             # What can I review?
   td approve <issue-id>     # Ship it → closed
   td reject <issue-id> --reason "Need tests"  # Back to in_progress
   ```

## Creating Issues

```bash
# Basic
td create "Fix login redirect bug"

# Full options
td create "Add OAuth2 support" \
  --type feature \
  --priority P1 \
  --description "Support Google and GitHub OAuth2 providers" \
  --labels "auth,backend" \
  --parent <epic-id>

# Types: task (default), bug, feature, epic, chore
# Priorities: P0 (critical) → P4 (minimal)
# Points: Fibonacci — 1, 2, 3, 5, 8, 13, 21
```

## Querying Issues

### Quick filters
```bash
td list                           # All open issues
td list --all                     # Include closed
td list --type bug                # Only bugs
td list --priority P0             # Only critical
td list --status in_progress      # In progress
td list --labels auth             # By label
td list --epic <epic-id>          # All tasks in an epic
td list --sort priority            # Sort by field
td list --long                    # Detailed output
td list --json                    # JSON output
```

### TDQ query language
```bash
td query "status = open AND type = bug"
td query "priority <= P1"                    # P0 and P1
td query "created >= -7d"                    # Last 7 days
td query "title ~ auth OR description ~ auth"
td query "log.type = blocker"                # Issues with blockers
td query "implementer = @me AND is(in_progress)"
td query "descendant_of(<epic-id>)"          # All children of epic
td query "rework()"                          # Rejected issues
```

### Saved boards
```bash
td board create "Active Bugs" "type = bug AND is(open)"
td board create "My Work" "implementer = @me AND NOT is(closed)"
td board list                                # Show all boards
td board show "Active Bugs"                  # Run saved query
```

## Issue Lifecycle

```
open → in_progress → in_review → closed
  ↕        ↕            ↕
blocked  blocked      rejected → in_progress (rework)
```

### Review workflow (preferred for non-trivial work)
```bash
td start <id>           # open → in_progress (sets focus)
# ... do work, log progress ...
td handoff <id> --done "..." --remaining "..."   # capture state
td review <id>          # in_progress → in_review (requires handoff)

# Different session reviews:
td reviewable           # what can I review?
td approve <id>         # in_review → closed (ship it)
td reject <id> --reason "Missing error handling"  # in_review → in_progress (back to work)
```

### Other transitions
```bash
td block <id>           # → blocked
td unblock <id>         # → open
td close <id>           # → closed (skip review, for admin closes only)
td reopen <id>          # → open
```

### Guidelines
- **Always use `review` → `approve`/`reject`** for non-trivial work — don't skip to `close`
- `close` is for admin purposes only: duplicates, won't-fix, trivial/minor tasks
- Session isolation: the session that implements can't approve its own work
- `reject` sends work back to `in_progress` for rework — always include a `--reason`

## Dependencies

```bash
td dep add <id> <depends-on-id>     # A depends on B
td dep rm <id> <depends-on-id>      # Remove dependency
td depends-on <id>                  # What does this issue need?
td blocked-by <id>                  # What's waiting on this issue?
td critical-path <id>               # Longest dependency chain
```

## Epics & Hierarchy

```bash
# Create an epic
td create "Auth System" --type epic --priority P1

# Add child tasks
td create "Login endpoint" --parent <epic-id>
td create "JWT validation" --parent <epic-id>

# View hierarchy
td tree <epic-id>                   # Visual tree
td list --epic <epic-id>            # All descendants
td epic list                        # List all epics with progress
```

## Session Management

```bash
td session "working on auth"        # Name current session
td session --new                    # Start fresh session
td whoami                           # Show current session identity
td focus <id>                       # Set focus without starting
td unfocus                          # Clear focus
td resume <id>                      # Show context + set focus
```

## Inspecting Issues

```bash
td show <id>                        # Full detail with logs, handoffs, comments
td show <id> --children             # Include child issues
td comments <id>                    # List comments
td comment <id> "Note about this"   # Add a comment
```

## Useful Shortcuts

```bash
td status                # Dashboard: session, focus, reviews, blocked, ready
td next                  # Highest-priority open issue
td ready                 # Open issues sorted by priority
td blocked               # All blocked issues
td in-review             # Issues awaiting review
td reviewable            # Issues you can review
td deleted               # Soft-deleted issues
td restore <id>          # Restore deleted issue
```

## Guidelines

- **Always start sessions** with `td usage --new-session` or `td status`
- **Log as you go** — decisions, blockers, and attempts are valuable for future sessions
- **Handoff before stopping** — structured handoffs make resumption seamless
- **Use epics** to group related work and track progress
- **Use dependencies** to make blocking relationships explicit
- **Use boards** to save frequently-used queries
- **P0 = drop everything**, P1 = do next, P2 = default, P3 = backlog, P4 = someday
