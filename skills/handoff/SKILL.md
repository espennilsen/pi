---
name: handoff
description: >
  Generate a self-contained handoff prompt that lets the user continue work
  in a fresh coding agent session with empty context. The prompt captures
  everything a new agent needs: project, goal, progress, decisions, current
  state, and remaining work.

  **Triggers — use this skill when:**
  - User says "handoff", "hand off", "hand-off"
  - User asks to "generate a continuation prompt"
  - User says "give me a prompt to continue this"
  - User asks to "wrap up for a new session"
  - User says "context transfer", "session transfer"
  - User asks "how do I pick this up later"
  - User wants to "pass this to another agent"
---

# Handoff — Session Context Transfer

Generate a self-contained prompt that a fresh coding agent (with zero prior context) can use to seamlessly continue the current work.

## Philosophy

Context is expensive. When a session hits its limit, or you want to switch tools, the work-in-progress knowledge shouldn't evaporate. A good handoff prompt is:

- **Self-contained** — no references to "our earlier conversation"
- **Actionable** — the new agent knows exactly what to do next
- **Honest** — clearly states what's done, what's broken, and what's uncertain
- **Minimal** — includes only what's needed, not a transcript of the old session

---

## Workflow

### Step 1 — Gather State

Collect facts from the codebase. Do not rely on conversation memory alone — verify against the filesystem.

```bash
# Project identity
basename $(pwd)
git remote -v 2>/dev/null | head -2

# Branch and recent work
git branch --show-current 2>/dev/null
git log --oneline -10 2>/dev/null

# Uncommitted changes (critical for handoff)
git status --short 2>/dev/null
git diff --stat 2>/dev/null

# Stashed work
git stash list 2>/dev/null

# Any running processes or dev servers the user should know about
# (mention if relevant to the task)
```

### Step 2 — Synthesize Context from the Session

Review the conversation to extract:

| Element | Question to answer |
|---------|-------------------|
| **Goal** | What is the user ultimately trying to accomplish? |
| **Scope** | What specific task was this session focused on? |
| **Completed** | What has been done? (commits, files created/edited, commands run) |
| **In-progress** | What was being worked on when the handoff was requested? |
| **Remaining** | What still needs to be done? |
| **Decisions** | What architectural or design choices were made and why? |
| **Blockers** | Any issues, bugs, or unknowns that the next session should know about? |
| **Key files** | Which files are most relevant to the current task? |

### Step 3 — Generate the Handoff Prompt

Produce a single Markdown code block containing the prompt. The user copies this into their next session.

---

## Handoff Prompt Template

Use this structure. Adapt and omit sections as needed — a trivial task doesn't need architectural decisions. The prompt should be as short as possible while remaining complete.

````markdown
```
Project: <name> — <one-line description>
Path: <absolute path to project root>
Branch: <current branch>

## Goal

<What the user is trying to accomplish — the big picture.>

## Context

<Brief project context the new agent needs. Tech stack, relevant architecture,
anything non-obvious about the codebase.>

## What's Been Done

- <Completed item 1 — be specific: files changed, commits made>
- <Completed item 2>
- ...

## Current State

<What state is the codebase in right now? Clean? Dirty files? Failing tests?
Mention uncommitted changes explicitly — the new agent should not accidentally
discard or duplicate work.>

Dirty files:
- <path/to/file — what was changed and why>
- ...

## What's Left

1. <Next concrete step — this is what the new agent should do first>
2. <Subsequent step>
3. ...

## Key Decisions

- <Decision 1: what was chosen and why>
- <Decision 2>

## Key Files

- `<path>` — <why this file matters for the current task>
- `<path>` — <description>

## Gotchas

- <Anything surprising, non-obvious, or easy to get wrong>
```
````

---

## Guidelines

### Be Specific, Not Vague
- ❌ "We updated the config"
- ✅ "Added `pi-heartbeat` settings block to `settings.json.example` with all 6 fields"

### Include Dirty File Details
Uncommitted changes are the most fragile part of a handoff. List every dirty file with a brief note on what changed. If there's a large diff, summarize the intent rather than listing every line.

### State the Next Action Clearly
The first item under "What's Left" should be an unambiguous instruction the new agent can act on immediately. Not "continue the refactor" but "refactor `src/parser.ts` to use the new `TokenStream` class — the interface is defined in `src/types.ts:42`".

### Keep It Proportional
- Quick fix session → 10-15 line handoff
- Multi-file feature session → 30-50 line handoff
- Major refactor → up to 80 lines, but no more

### Don't Include
- Full file contents (the agent can read them)
- Conversation transcript or reasoning history
- Obvious project facts the agent will discover from `package.json` etc.
- Emotional context ("we struggled with this" — just state the facts)

---

## Output

1. Present the handoff prompt inside a single fenced code block so it's easy to copy
2. If there are uncommitted changes, mention this outside the code block as a reminder
3. Optionally suggest saving the prompt to a file: `pbcopy` or write to `.handoff.md`
