---
name: a2a
description: >
  Communicate with remote agents via A2A protocol, discover available agents,
  and ask the human owner for clarification via the A2A Hub. Use when asked
  to send messages to other agents, discover what agents are available, or
  when you need human input to proceed.

  **Triggers — use this skill when:**
  - You need human input to proceed (approval, decision, clarification)
  - User asks to "send a message to another agent"
  - User asks to "discover agents" or "what agents are available"
  - You're stuck and need to escalate to the owner
  - A long-running task needs human approval before continuing
---

# A2A — Agent-to-Agent Communication & Human-in-the-Loop

## Tools

| Tool | Purpose |
|------|---------|
| `a2a_discover` | Find remote agents on the hub or static registry |
| `a2a_send` | Send a message to a remote agent by name, ID, or URL |
| `ask_owner` | Ask the human owner a question (non-blocking) |

---

## ask_owner — Human-in-the-Loop

Use `ask_owner` when you **genuinely cannot proceed** without human input.
The tool submits your question to the hub and **returns immediately** — it
does NOT block your session. When the owner responds, a **fresh pi
subprocess** is automatically spawned with your handoff context + the
owner's answer to continue the work.

### How It Works

1. You call `ask_owner` with a question + handoff context
2. The question is submitted to the A2A Hub — you get an immediate confirmation
3. You continue with other work or end your session
4. The owner answers through the hub's web UI (could be minutes or hours later)
5. A background poller detects the response
6. A fresh `pi` subprocess is spawned with a self-contained prompt containing:
   - The original question
   - The owner's response
   - Your full handoff context (done, remaining, decisions, etc.)
7. The new session picks up where you left off — no prior conversation context needed

### When to Use

- **Approval needed** — destructive operations, merging PRs, deploying
- **Ambiguous requirements** — multiple valid approaches, unclear scope
- **Escalation** — blocked on something outside your control
- **Design decisions** — architectural choices with significant trade-offs

### When NOT to Use

- You can make a reasonable decision yourself
- The answer is in the codebase, docs, or context
- It's a minor style/formatting choice

### Always Include Handoff Context

**Every `ask_owner` call MUST include the `handoff` parameter.** The response
will be handled by a completely fresh session with zero prior context. Without
handoff context, the new session has no idea what to do.

```json
{
  "question": "The PR has conflicting review feedback — reviewer A wants JWT, reviewer B wants session tokens. Which approach should I take?",
  "handoff": {
    "done": [
      "Implemented Express server with route scaffolding",
      "Added user model with Kysely migrations",
      "PR #45 created on branch td-abc123/auth"
    ],
    "remaining": [
      "Implement auth middleware (blocked on JWT vs sessions decision)",
      "Write integration tests for auth endpoints",
      "Update API docs"
    ],
    "decisions": [
      "Using PostgreSQL via Kysely (not SQLite) for production readiness",
      "Argon2 for password hashing over bcrypt"
    ],
    "uncertain": [
      "JWT vs session tokens — conflicting reviewer feedback",
      "Whether to support OAuth2 providers in this PR or defer"
    ],
    "project": "my-api",
    "branch": "td-abc123/auth",
    "taskId": "td-abc123"
  },
  "priority": "normal"
}
```

### Handoff Fields

| Field | Required | Description |
|-------|----------|-------------|
| `done` | Yes | What's been completed — be specific (files, commits, PRs) |
| `remaining` | Yes | What still needs to be done — ordered by priority |
| `decisions` | If any | Key choices made and why |
| `uncertain` | If any | Open questions beyond the one being asked |
| `project` | Yes | Project name or absolute path to project root |
| `branch` | If applicable | Git branch being worked on |
| `taskId` | If applicable | td task ID |

### Priority Levels

| Priority | When to use |
|----------|-------------|
| `low` | Nice-to-know, no urgency |
| `normal` | Default — standard question |
| `urgent` | Blocking critical work, needs fast response |

### Poller Configuration

The background poller must be enabled in `settings.json` for responses to be
automatically processed:

```json
{
  "pi-a2a": {
    "poller": {
      "enabled": true,
      "intervalSeconds": 60,
      "extensions": ["extensions/pi-github", "extensions/pi-memory"],
      "skills": ["td", "github", "code-review"],
      "model": "claude-sonnet-4-5"
    }
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Enable the poller |
| `intervalSeconds` | `60` | Poll interval (15–600) |
| `extensions` | `[]` | Extension paths for spawned subprocesses |
| `skills` | `[]` | Skill paths for spawned subprocesses |
| `model` | (default) | Model override for spawned subprocesses |

---

## a2a_discover — Find Agents

```json
{ "q": "search query", "tags": ["coding"], "category": ["development-tools"] }
```

All parameters are optional. Omit everything to list all agents.
Returns agent names, descriptions, skills, availability, and health status.

---

## a2a_send — Message an Agent

```json
{ "agent": "Agent Name", "message": "Your request here" }
```

The `agent` field accepts:
- Agent name (from `a2a_discover` results)
- Agent ID (UUID from hub)
- Direct URL (`https://...`)

The response arrives asynchronously — you'll see it when it comes back.
If the remote agent acknowledges but needs time, you'll get an ACK and the
full response arrives later as an inbound message.
