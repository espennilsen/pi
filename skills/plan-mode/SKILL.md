---
name: plan-mode
description: >
  Structured planning mode for AI agents working on coding and development tasks.
  Produces a comprehensive plan BEFORE any code is written or changed, including
  task decomposition, architecture decisions, risk assessment, and approval gates.
  Use this skill whenever the user says "/plan", "plan mode", "plan first",
  "think before coding", "make a plan", or asks the agent to plan before executing.
  Also trigger when the user describes a complex multi-step development task and
  would clearly benefit from structured planning before implementation — especially
  for tasks involving new features, refactors, migrations, infrastructure changes,
  or multi-file edits. When in doubt, plan. A few minutes of planning prevents
  hours of rework.
---

# Plan Mode

When triggered, switch into **planning mode**: analyze the task, produce a structured plan, and wait for explicit user approval before writing any code or making changes.

The core philosophy: **think deeply, communicate clearly, execute only when aligned.**

## When to Enter Plan Mode

- User explicitly requests it (`/plan`, "plan this", "think first", etc.)
- Task touches 3+ files or components
- Task involves architecture decisions, new patterns, or breaking changes
- Task is ambiguous and could be approached multiple ways
- Task involves infrastructure, CI/CD, database changes, or migrations
- You're unsure about the right approach

## Plan Output Structure

Produce a plan with these sections. Adapt depth to task complexity — a small bug fix needs a lighter plan than a new feature.

### 1. Understanding (What)

Restate the task in your own words to confirm understanding. Call out any ambiguities or assumptions you're making. This catches misalignment early.

```
## Understanding
[Restate the goal in 2-3 sentences]

**Assumptions:**
- [List anything you're assuming that wasn't explicitly stated]

**Open questions:**
- [List anything you need clarified before proceeding]
```

If there are open questions that would significantly change the approach, STOP here and ask the user before continuing with the plan. Don't build a full plan on shaky assumptions.

### 2. Approach Options (How)

For non-trivial tasks, present 2-3 distinct approaches. For simple tasks, present one recommended approach with brief justification.

For each option include:
- **Summary**: One-line description
- **How it works**: Key implementation steps (keep high-level, not line-by-line)
- **Pros**: Why this approach is good
- **Cons**: Tradeoffs and risks
- **Effort estimate**: Relative complexity (small / medium / large)

End with a clear recommendation and why.

```
## Approach Options

### Option A: [Name]
**Summary:** [One line]
**How it works:** [3-5 bullet points, high-level]
**Pros:** [What's good about this]
**Cons:** [Tradeoffs]
**Effort:** [small / medium / large]

### Option B: [Name]
...

**Recommendation:** Option [X] because [reason tied to project context].
```

### 3. Task Breakdown (Steps)

Break the chosen (or recommended) approach into concrete, ordered steps. Each step should be small enough to verify independently. Group related steps into phases.

```
## Task Breakdown

### Phase 1: [Name, e.g. "Setup / Preparation"]
- [ ] Step 1.1: [Concrete action]
- [ ] Step 1.2: [Concrete action]
  **Checkpoint:** [What should be true after this phase — a testable condition]

### Phase 2: [Name, e.g. "Core Implementation"]
- [ ] Step 2.1: [Concrete action]
- [ ] Step 2.2: [Concrete action]
  **Checkpoint:** [Testable condition]

### Phase 3: [Name, e.g. "Verification & Cleanup"]
- [ ] Step 3.1: [Concrete action]
- [ ] Step 3.2: [Concrete action]
  **Checkpoint:** [Testable condition]
```

Guidelines for good steps:
- Each step modifies 1-2 files at most
- Steps are ordered so the project stays in a working state after each phase
- Include test/verification steps, not just implementation
- Checkpoints are concrete and testable ("tests pass", "server starts", "endpoint returns 200")

### 4. Risk Assessment

Identify what could go wrong and how to mitigate it. Focus on risks specific to *this* task, not generic software risks.

```
## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [Specific thing that could go wrong] | low/med/high | low/med/high | [How to prevent or handle it] |
```

Always consider:
- **Breaking changes**: Will this break existing functionality? Which consumers/callers are affected?
- **Data implications**: Any database migrations, data loss risk, or state changes?
- **Rollback**: If this goes wrong, how hard is it to undo?
- **Dependencies**: External services, libraries, or team coordination needed?

### 5. Files & Scope

List the files that will be created, modified, or deleted. This helps the user understand the blast radius.

```
## Affected Files
- **Create:** `path/to/new-file.ts` — [purpose]
- **Modify:** `path/to/existing-file.ts` — [what changes]
- **Delete:** `path/to/old-file.ts` — [why]
```

### 6. Approval Gate

Always end the plan with an explicit request for approval. Never proceed to implementation without it.

```
## Ready to Execute?

Plan is complete. Please review and let me know:
- ✅ **Approve** — proceed with implementation
- 🔄 **Revise** — adjust the approach (tell me what to change)
- ❓ **Clarify** — answer open questions first
- ❌ **Cancel** — abort this task
```

## Saving the Plan

After generating the plan, save it to a `plans/` directory in the project root before requesting approval.

**File naming convention:** `plans/YYYY-MM-DD-<short-slug>.md`

Examples:
- `plans/2026-02-25-auth-refactor.md`
- `plans/2026-02-25-add-search-endpoint.md`
- `plans/2026-02-25-fix-race-condition.md`

The slug should be a concise, kebab-case summary of the task (3-5 words max).

**File contents:** The full plan output (all sections) as a markdown document. Add a YAML frontmatter block at the top:

```yaml
---
task: "[One-line task description]"
status: proposed  # proposed → approved → in-progress → completed → cancelled
created: YYYY-MM-DD
approach: "[Name of chosen/recommended approach]"
---
```

**Status updates:** Update the `status` field in the frontmatter as the task progresses. If the plan is revised after feedback, append a `## Revision Log` section at the bottom rather than overwriting the original plan — this preserves the decision history.

Create the `plans/` directory if it doesn't exist. If a `.gitignore` exists and the user hasn't indicated whether plans should be tracked in git, ask.

## Execution After Approval

Once approved, follow the task breakdown step by step. After each phase checkpoint:
- Briefly report what was completed
- Confirm the checkpoint condition is met
- Proceed to the next phase (or flag if something unexpected came up)

If during execution you discover something that contradicts the plan (unexpected complexity, a better approach, a blocker), **pause and re-plan** rather than silently deviating.

## Scaling the Plan to Task Size

Not every task needs a full plan. Scale the depth:

**Small tasks** (bug fix, config change, typo):
- Understanding + single approach + file list + approval gate
- Skip options comparison and risk table
- 1-2 minutes of planning

**Medium tasks** (new endpoint, component, small feature):
- Full plan structure
- 2 approach options
- Basic risk assessment
- 3-5 minutes of planning

**Large tasks** (new feature, refactor, migration, infrastructure):
- Full plan with detailed options
- Comprehensive risk table
- Consider suggesting the work be split into multiple PRs/phases
- Include dependency graph if components interact
- 5-10 minutes of planning

## Anti-Patterns to Avoid

- **Plan theater**: Don't produce a 500-line plan for renaming a variable. Match depth to complexity.
- **Vague steps**: "Implement the feature" is not a step. "Add `handleSubmit` function to `LoginForm.tsx` that validates inputs and calls `POST /api/auth`" is a step.
- **Optimistic risk assessment**: If a migration could lose data, say so plainly. Don't bury risks.
- **Planning in circles**: If you've laid out the plan and the user approved, execute. Don't re-plan unless something changes.
- **Assumption hiding**: Surface your assumptions explicitly. The most dangerous assumptions are the ones nobody stated.
