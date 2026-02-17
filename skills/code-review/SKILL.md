---
name: code-review
description: Review code for quality, security, performance, and maintainability. Use when reviewing PRs, auditing a codebase, or refactoring. Covers TypeScript, Node.js, infrastructure-as-code, and full-stack web apps.
---

# Code Review

Systematic code review for Espen's TypeScript/Node.js projects.

## Process

1. **Understand scope** — Read the changed files or the area under review:
   ```bash
   # For git changes
   git diff --name-only HEAD~1
   git diff HEAD~1

   # For a specific area
   find src/ -name "*.ts" -newer <reference-file>
   ```

2. **Read the code** — Use the `read` tool on each file. Don't guess.

3. **Analyze against checklist** — Score each category.

4. **Report** — Use the output format below.

## Review Checklist

### Correctness
- [ ] Logic handles edge cases (null, empty, boundary values)
- [ ] Error handling is explicit (no swallowed errors, no bare `catch {}`)
- [ ] Async code handles rejection/cancellation properly
- [ ] Types are accurate (no unnecessary `any`, proper narrowing)

### Security
- [ ] No secrets or credentials in code
- [ ] User input is validated/sanitized before use
- [ ] SQL queries use parameterized statements (no string interpolation)
- [ ] File paths are resolved safely (no path traversal)
- [ ] Auth checks are present where needed

### Performance
- [ ] No N+1 queries or unbounded loops over large datasets
- [ ] Heavy operations are async or streamed (not blocking)
- [ ] Database queries use appropriate indexes
- [ ] Large responses are paginated or truncated

### Maintainability
- [ ] Functions do one thing with clear names
- [ ] No magic numbers or hardcoded values that should be config
- [ ] Types and interfaces are defined (not inline object shapes)
- [ ] Dead code and unused imports are removed
- [ ] Comments explain *why*, not *what*

### Project Conventions
- [ ] Follows existing patterns in the codebase
- [ ] File naming and directory structure is consistent
- [ ] Error messages are helpful for debugging
- [ ] Logging is appropriate (not too noisy, not silent on errors)

## Output Format

```markdown
## Code Review: [scope]

### Summary
One paragraph: what the code does, overall quality assessment.

### Issues

#### 🔴 Critical
- [file:line] Description and fix

#### 🟡 Important
- [file:line] Description and suggestion

#### 🔵 Minor
- [file:line] Nit or style suggestion

### What's Good
- Call out well-written code, good patterns, clever solutions

### Recommendations
- Prioritized list of changes, starting with most impactful
```

## Common Patterns in Espen's Stack

| Project Type | Key Things to Check |
|---|---|
| **Pi extensions** | Tool parameter schemas, error returns, signal/abort handling |
| **Eleventy sites** | Template data flow, permalink structure, Tailwind purge config |
| **TanStack apps** | Router setup, query keys, optimistic updates, Clerk auth guards |
| **Infrastructure** | Terraform state safety, Docker layer caching, env var handling |
| **SQLite** | Migration ordering, prepared statements, WAL mode, index coverage |
