---
name: agents-md-manager
description: Audit, generate, update, and lint AGENTS.md files across all projects. Use when asked to check project context files, scaffold AGENTS.md for new projects, update stale ones, or run a cross-project audit.
---

# AGENTS.md Manager

Maintain AGENTS.md project context files across all ~/Dev projects.

## Available Operations

### 1. Audit — Cross-project health check

Scan all projects and report AGENTS.md / .pi/ / td status:

```bash
# Use the project_init tool in batch mode
```

Use `project_init` with `action: "batch"` to get a full overview. Then provide a table:

| Project | Stack | AGENTS.md | .pi/ | td | Status |
|---------|-------|-----------|------|-----|--------|

Flag projects that:
- Have code but no AGENTS.md (needs init)
- Have AGENTS.md but no .pi/ or td (partially set up)
- Are fully ready ✅

### 2. Generate — Create AGENTS.md for a project

Use `project_init` with `action: "detect"` first to preview, then `action: "init"` to create.

After auto-generation, review and **enhance** the output by:
- Reading README.md for project description and purpose
- Checking package.json scripts for accurate quick-start commands
- Looking at src/ structure for meaningful directory descriptions
- Adding project-specific conventions found in configs (ESLint rules, Prettier settings)
- Adding deployment info if found (Dockerfile, CI workflows, deploy scripts)

### 3. Update — Refresh specific sections

When a project has changed significantly:

1. Read current AGENTS.md
2. Run `project_init` with `action: "detect"` to get fresh stack profile
3. Compare detected state against documented state
4. Update only stale sections, preserving manual edits in other sections

Key sections to check:
- **Stack:** Dependencies changed?
- **Quick Start:** New scripts added/removed?
- **Directory Layout:** New top-level dirs?
- **Conventions:** Linting/formatting tools changed?
- **Key Files:** New config files?

Use the `edit` tool for surgical updates — don't rewrite the entire file.

### 4. Sync Check — Detect drift

Compare AGENTS.md claims against reality:

```bash
# Check if referenced directories exist
# Verify scripts in package.json match what's documented
# Confirm referenced config files exist
# Check if new top-level dirs aren't documented
```

For each project with AGENTS.md:
1. Read the AGENTS.md
2. Run `project_init detect` to get current profile
3. Compare:
   - Listed directories vs actual directories
   - Documented scripts vs actual package.json scripts
   - Referenced config files vs files on disk
   - Stack description vs detected stack
4. Report drift items with suggested fixes

### 5. Lint — Quality check

Check AGENTS.md files for common issues:
- **Missing sections:** No quick start, no directory layout
- **Stale paths:** References to directories/files that don't exist
- **Generic content:** Boilerplate without project-specific detail
- **Missing td mandate:** No task management section
- **No description:** Missing project purpose/overview
- **Broken commands:** Script references that don't match package.json

Report with severity:
- 🔴 Critical: Missing or empty AGENTS.md in active project
- 🟡 Important: Stale content, missing key sections
- 🔵 Minor: Formatting, generic descriptions

## Batch Mode

When operating on multiple projects:
1. Start with audit to identify which projects need attention
2. Process projects by priority (active first, stale/archived last)
3. Show a summary of changes before applying
4. Always ask before writing to files

## Integration with Other Tools

- Use `project_init` for stack detection and initial generation
- Use `workon` to switch context when doing deep updates
- Use `td` to track large-scale AGENTS.md update campaigns
- Use `read` and `edit` for surgical file modifications
