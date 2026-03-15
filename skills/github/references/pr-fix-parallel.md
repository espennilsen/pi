# Parallel PR Fixes — Multi-PR Review Resolution

Fix review feedback across multiple PRs simultaneously using parallel subagents.
Each PR gets a dedicated long-lived worker agent with its own worktree context.

## When to use

- Multiple PRs have pending review feedback
- Review bot (e.g. reviewbie) has posted threads across several PRs
- You want to batch-fix feedback without serial back-and-forth

## Architecture

```
Orchestrator agent (root)
  ├── has: ask_owner, spawn_agent, send_message, kill_agent, list_agents
  ├── pr-97-worker  (has: send_message to parent, full tool access)
  ├── pr-95-worker  (has: send_message to parent, full tool access)
  └── pr-93-worker  (has: send_message to parent, full tool access)
```

- **Orchestrator** — spawns workers with only PR identifiers (repo + number +
  worktree path), relays human questions via `ask_owner`, collects results,
  reports summary. Does NOT fetch threads — that's the worker's job.
- **Workers** — each owns one PR end-to-end. Fetches its own threads via
  `fetch-threads.sh`, triages, auto-fixes what's clear, escalates what's
  ambiguous, commits and pushes, resolves threads. Fully self-contained.

## Worker Triage Protocol

Workers do NOT block on every thread. They triage each thread and act
autonomously on straightforward fixes:

### Auto-fix immediately (no approval needed)

- ⚪ **SUGGESTION** — simple/mechanical: typos, naming, style, missing null
  checks, import cleanup, doc fixes
- 🟡 **WARNING** — clear correctness bugs with obvious fixes (e.g. bash compat,
  wrong regex dialect, missing error handling)
- Any thread where the reviewer provides **explicit fix code** or a clear
  before/after
- Threads that match well-known patterns: unused variables, missing types,
  off-by-one errors, missing edge case guards

### Escalate to orchestrator (needs human input)

- 🔴 **BLOCKER** — architectural changes, security concerns, design decisions
- **Ambiguous feedback** — "consider rethinking this approach", "this feels
  wrong", subjective style preferences beyond linting
- **Conflicting reviewers** — two reviewers disagree on the fix
- **Large refactors** — fix would touch many files or change public APIs
- **Genuine disagreement** — worker believes the reviewer is wrong (escalate
  with reasoning, let human decide)

### Escalation protocol

Workers escalate via `send_message` to their parent orchestrator:

```
send_message("orchestrator", "PR #97 thread 3: Reviewer says 'rethink the
caching approach' but doesn't specify what's wrong. The current implementation
uses LRU with 60s TTL. Should I skip this thread or attempt a change?")
```

The orchestrator:
1. Receives the escalation
2. Calls `ask_owner` to relay the question to the human
3. Waits for the human's response
4. Calls `send_message` back to the worker with the answer

Workers continue fixing other threads while waiting for escalation responses.
Don't block — fix everything you can, then wait only on the escalated items.

## Worker Workflow

Each worker follows this sequence:

```
1. cd into worktree (must already exist, or create it)
2. Fetch unresolved threads:
     bash scripts/fetch-threads.sh <owner> <repo> <pr-number>
3. Triage each thread → auto-fix / escalate / skip
4. Apply all auto-fixes surgically
5. Verify: typecheck / lint / test as appropriate
6. Commit and push:
     git commit -m "fix: address review feedback — <summary>"
     git push origin <branch>
7. Resolve auto-fixed threads:
     bash scripts/reply-thread.sh "THREAD_ID" "Fixed — <description>"
     bash scripts/resolve-thread.sh "THREAD_ID"
8. Post summary comment:
     gh pr comment <N> -R <owner/repo> --body '<summary table>'
9. Report back to orchestrator:
     send_message("orchestrator", "PR #97: fixed 5/7 threads, pushed.
     2 threads escalated, waiting for response.")
10. Wait for any escalation responses, apply remaining fixes if approved
11. Final push + resolve remaining threads
```

## What the orchestrator passes to workers

The orchestrator (or main agent) passes **only identifiers** — never
pre-fetched thread content. Each worker is self-contained and fetches its
own data:

```
Worker receives:
  - repo owner + name (e.g. espennilsen/pi)
  - PR number (e.g. 97)
  - worktree path (e.g. /path/to/worktrees/td-b0c03c/github-skills)
  - skill reference (skills/github)

Worker does everything else:
  - Fetches threads via fetch-threads.sh
  - Reads code, understands context
  - Triages, fixes, commits, pushes, resolves
```

This keeps the orchestrator lightweight — it doesn't need to understand the
review content, just route PR identifiers to workers and relay escalations.

## Spawning with orchestrator mode

```json
{
  "orchestrator": {
    "agent": "worker",
    "task": "Fix review feedback on these PRs in parallel. For each PR, spawn a worker agent with the repo, PR number, and worktree path. Workers fetch their own threads, auto-fix straightforward ones, and escalate ambiguous threads to me — I'll relay to the human via ask_owner.\n\nPRs to fix:\n- PR #97: espennilsen/pi, worktree: /path/to/worktrees/td-b0c03c/github-skills\n- PR #95: espennilsen/pi, worktree: /path/to/worktrees/td-xyz/feature\n- PR #93: espennilsen/pi, worktree: /path/to/worktrees/td-abc/other",
    "skills": ["skills/github"]
  }
}
```

## Spawning with pool mode

For more manual control, use pool actions. Pass only identifiers — workers
pull their own threads:

```json
{ "action": "spawn", "id": "pr-97", "agent": "worker",
  "skills": ["skills/github"],
  "task": "Fix review feedback on PR #97 (espennilsen/pi). Worktree: /path/to/worktrees/td-b0c03c/github-skills. Fetch unresolved threads yourself using fetch-threads.sh, auto-fix straightforward ones, report back what you fixed and what needs human input." }

{ "action": "spawn", "id": "pr-95", "agent": "worker",
  "skills": ["skills/github"],
  "task": "Fix review feedback on PR #95 (espennilsen/pi). Worktree: /path/to/worktrees/td-xyz/feature. Fetch unresolved threads yourself using fetch-threads.sh, auto-fix straightforward ones, report back what you fixed and what needs human input." }
```

Then review and follow up:

```json
{ "action": "send", "id": "pr-97",
  "message": "Thread 3: yes, refactor the caching to use a Map. Thread 5: skip, WONTFIX." }

{ "action": "send", "id": "pr-95",
  "message": "All looks good, fix everything." }
```

Clean up after merge:

```json
{ "action": "kill", "id": "pr-97" }
{ "action": "kill", "id": "pr-95" }
```

### Pool vs orchestrator mode

| | Pool | Orchestrator |
|---|------|-------------|
| **Control** | Manual — you send each message | Autonomous — root agent manages workers |
| **Human input** | You see worker output, decide, send follow-ups | Root agent uses `ask_owner` to relay questions |
| **Best for** | Hands-on review, selective approval | Batch processing, "fix these and only bother me if stuck" |
| **Escalation** | Worker reports in output, you read and reply | Worker calls `send_message`, root calls `ask_owner` |

## Rules

- **Workers fetch their own threads** — the orchestrator passes only PR
  identifiers (repo, number, worktree path), never pre-fetched thread data
- **One worker per PR** — never share worktrees between workers
- **Auto-fix the obvious** — don't block on threads that have clear fixes
- **Escalate the ambiguous** — don't guess on architectural decisions or
  subjective feedback
- **Keep working while waiting** — fix other threads while an escalation is
  pending
- **Surgical edits only** — don't refactor surrounding code
- **Verify before pushing** — typecheck / lint / test as appropriate
- **Always use worktrees** — never checkout in main working directory
