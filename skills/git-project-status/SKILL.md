---
name: git-project-status
description: |
  Generate comprehensive status reports for git repositories. Analyzes commits, codebase structure, type errors, branch health, dependency status, GitHub PRs/issues/CI, working tree changes, and optionally integrates with `td` (task management CLI) if a `.todos` folder is present.

  **TRIGGERS - Use this skill when:**
  - User asks for the status of a git project or repo
  - User asks "what's going on in [project]" or "give me an overview of [repo]"
  - User wants a project summary, progress report, or codebase overview
  - User asks about recent commits, code structure, or project health
  - User says "check my project" or "project status"

  **Output:** A rich, structured text report covering overview, branches, commit history, codebase breakdown, GitHub activity, dependency health, issues/errors, working tree changes, task management, and summary.
---

# Git Project Status Skill

Generate a comprehensive status report for one or more git repositories.

## Usage

**Path resolution (in priority order):**
1. **Full path provided** — use it directly
2. **Only a project name mentioned** (e.g. "check pi-crm-personal") — look in `/Users/espen/Dev/<project-name>`
3. **No path or name specified** — use the current working directory (`.`)

Never ask the user for a path — resolve it using the rules above and run the report. The skill produces a structured report for each repo.

## Report Structure

Each report MUST include these sections in order. Sections marked **(Conditional)** are only included when the relevant tool/data is available.

---

### 1. Overview
- Project name (from directory name or package.json/Cargo.toml/pyproject.toml)
- Version (from package manifest if available)
- Brief description (from README.md first paragraph, or package manifest description)
- When the project was started (first commit date)
- Current branch and whether working tree is clean/dirty
- Repo visibility (public/private) — if GitHub origin is detected

### 2. Branches
- Current branch name (highlighted with `*`)
- List all local branches with:
  - How far ahead/behind the default branch (main/master) each branch is
  - Last commit date on each branch
- Flag stale branches (no commits in >30 days) with ⚠
- Show total branch count

Format example:

  Branches (4 total)
    * feature/typescript-refactor  +12 ahead, 3 behind main  (last: 2h ago)
      main                         up to date                 (last: 3d ago)
      fix/webhook-retry            +2 ahead                   (last: 5d ago)
      old/experiment               +1 ahead                   (last: 45d ago) ⚠ stale

### 3. Progress (Commit History)
- Total commit count
- Date range of commits
- A table of recent commits (up to 5) showing:
  - Short hash (6 chars)
  - Commit message (first line, truncated to fit column)

Format as a simple two-column list — hash followed by message. Truncate long messages with "…".

  d7bd8b  feat: Integrate pi-crm-personal extension
  e0469f  deps: Add pi-crm-personal as file: dependency
  6638a4  fix(heartbeat): normalize db health-check path in checklist
  8770c4  chore: update agent name note and add start:tui script
  bedca7  Merge 'hannah/td-2f5211-workon' — workon tool, cross-proj…

### 4. Codebase Overview
- Total lines of code and total number of source files
- Language breakdown by percentage of lines (show as a compact bar or list)

Format example:

  Codebase (3,420 lines across 18 files)
    TypeScript  82%  ████████████████░░░░  2,804 lines
    HTML         9%  ██░░░░░░░░░░░░░░░░░░    308 lines
    SQL          5%  █░░░░░░░░░░░░░░░░░░░    171 lines
    Shell        4%  █░░░░░░░░░░░░░░░░░░░    137 lines

**Counting rules:**
- Group by language, not file extension (e.g. .ts and .tsx both count as TypeScript, .js and .jsx as JavaScript)
- Always exclude: node_modules, .git, vendor, dist, build, target, __pycache__, .next, .nuxt, coverage, lock files
- Also exclude generated files (*.min.js, *.map, *.d.ts)
- Use a simple bar visualization (█ and ░) — 20 chars wide, proportional to percentage

### 5. GitHub Activity (Conditional)
**Only include this section if the git remote origin points to GitHub (github.com) AND the `gh` CLI is available and authenticated.**

Detect GitHub origin:
```bash
git remote get-url origin 2>/dev/null | grep -q "github.com"
```

Check `gh` is available and authenticated:
```bash
gh auth status 2>/dev/null
```

If both conditions are met, include:

#### Open Pull Requests
```bash
gh pr list --state open --json number,title,headRefName,author,reviewDecision,statusCheckRollup,updatedAt --limit 20
```
Show for each PR:
- PR number and title
- Branch name
- Author
- Review status (APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or pending)
- CI check status (passing ✅, failing ❌, pending ⏳)

#### Open Issues
```bash
gh issue list --state open --json number,title,labels,assignees,createdAt --limit 20
```
Show for each issue:
- Issue number and title
- Labels
- Assignee (if any)

#### Recent Merged PRs
```bash
gh pr list --state merged --json number,title,mergedAt,author --limit 5
```
Show the 5 most recently merged PRs with merge date.

#### CI/CD Status
```bash
gh run list --limit 5 --json databaseId,displayTitle,status,conclusion,headBranch,createdAt
```
Show the 5 most recent workflow runs with:
- Workflow name
- Branch
- Status/conclusion (success ✅, failure ❌, in_progress ⏳, cancelled ⊘)
- When it ran

If `gh` is not available or not authenticated, skip this entire section silently (do not show an error or placeholder).

### 6. Dependencies Health (Conditional)
**Only include if the project has a dependency manifest.**

Check for outdated packages based on project type:

- **Node.js** (package.json exists):
  ```bash
  npm outdated --json 2>/dev/null
  ```
  Show: package name, current version, wanted version, latest version. Highlight major version bumps.

- **Rust** (Cargo.toml exists):
  ```bash
  cargo outdated 2>/dev/null
  ```

- **Python** (requirements.txt or pyproject.toml exists):
  ```bash
  pip list --outdated --format=json 2>/dev/null
  ```

- **Go** (go.mod exists):
  ```bash
  go list -u -m all 2>/dev/null
  ```

Format as a compact table if there are outdated deps:

  Dependencies (3 outdated of 24 total)
    typescript      5.3.3  →  5.6.2  (major)
    eslint          8.56.0 →  8.57.0 (minor)
    @types/node     20.11  →  20.14  (minor)

If all dependencies are up to date, say "All N dependencies are up to date."
If the outdated check tool is not available, skip gracefully.

### 7. Issues / Errors
Run appropriate type-checking or linting commands based on the project type:
- **TypeScript**: `npx tsc --noEmit 2>&1` (if tsconfig.json exists)
- **Python**: `python -m py_compile` on source files, or `mypy` if configured
- **Rust**: `cargo check 2>&1` (if Cargo.toml exists)
- **Go**: `go vet ./...` (if go.mod exists)

If no errors are found, say "No type errors or lint issues detected."

If errors are found:
- Count them
- List unique error types with file locations
- Provide a brief analysis of the root cause

**IMPORTANT**: Install dependencies first if needed (check for node_modules, etc.) but do so silently. If type-checking tools aren't available or fail to install, skip this section gracefully and note it.

### 8. TODO / FIXME / HACK Markers
Scan all source files for common debt markers:
```bash
grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.py" --include="*.rs" --include="*.go" \
  -E "(TODO|FIXME|HACK|XXX|WORKAROUND|TEMP)(\(|:| )" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build
```

Format as a compact list grouped by marker type:

  Code Markers (7 found)
    TODO (4):
      src/db.ts:42        — add migration rollback support
      src/tool.ts:118     — handle edge case for empty contacts
      src/web.ts:55       — add pagination
      src/web.ts:201      — rate limiting
    FIXME (2):
      src/registry.ts:88  — race condition on concurrent register
      src/tool.ts:340     — incorrect type cast
    HACK (1):
      src/db.ts:167       — temporary workaround for SQLite locking

If none found, say "No TODO/FIXME/HACK markers found."

### 9. Test Status (Conditional)
**Only include if a test runner is detected.**

Detect test configuration:
- **Node.js**: check for `jest`, `vitest`, `mocha` in package.json scripts or devDependencies
- **Rust**: `cargo test` (always available)
- **Python**: check for `pytest`, `unittest` config
- **Go**: `go test ./...` (always available)

Run the test suite and report:
```bash
# Node.js example:
npx vitest run --reporter=verbose 2>&1  # or npm test
```

Show:
- Total tests, passed ✅, failed ❌, skipped ⏭
- If coverage is available, show overall coverage percentage
- List any failing test names

Format example:

  Tests (vitest)
    32 passed ✅  2 failed ❌  1 skipped ⏭
    Failures:
      src/db.test.ts > migrations > should rollback on error
      src/tool.test.ts > actions > should validate contact fields
    Coverage: 74% lines (if available)

If no test runner is detected, skip this section silently.
**IMPORTANT**: Run tests with a timeout. If tests hang or take longer than 60 seconds, kill the process and note "Tests timed out after 60s."

### 10. Secrets Exposure Check
Quick scan for potentially leaked secrets in tracked files:
```bash
# Check for common secret patterns in tracked files
git grep -lnE "(PRIVATE_KEY|SECRET_KEY|API_KEY|PASSWORD|TOKEN|Bearer )['\"]?=" -- '*.ts' '*.js' '*.py' '*.env*' '*.json' '*.yaml' '*.yml' 2>/dev/null
# Check if .env files are tracked
git ls-files | grep -E "^\.env"
# Check if common sensitive files are in .gitignore
```

Report:
- Whether `.env` files are tracked (⚠ warning if they are)
- Any files containing patterns that look like hardcoded secrets
- Whether `.gitignore` covers common sensitive patterns (.env, *.pem, *.key)

Format example:

  Secrets Check
    ⚠ .env is tracked in git — should be in .gitignore
    ⚠ src/config.ts:12 — contains hardcoded API_KEY pattern
    ✅ .gitignore covers: .env, *.pem, *.key

If everything looks clean: "✅ No secrets exposure detected."

### 11. Uncommitted Changes (Conditional)
**Only include this section if the working tree is dirty (has uncommitted changes).**

Show a breakdown of:
- **Staged changes** (ready to commit):
  ```bash
  git diff --cached --stat
  ```
- **Unstaged changes** (modified but not staged):
  ```bash
  git diff --stat
  ```
- **Untracked files**:
  ```bash
  git ls-files --others --exclude-standard
  ```

Format example:

  Uncommitted Changes
    Staged (2 files):
      M src/tool.ts          (+15, -3)
      A src/newfile.ts        (+42)
    Unstaged (1 file):
      M src/db.ts             (+8, -2)
    Untracked (1 file):
      src/experimental.ts

If the working tree is clean, skip this section entirely.

### 12. Task Management (Conditional)
**Only include this section if a `.todos` directory exists in the project root.**

Run `td usage` and include the output, covering:
- Current session info
- Work session details
- Focused issue
- In-progress issues
- Issues awaiting review

Format this under a "Task Management" heading.

### 13. Summary
A 2-3 sentence summary covering:
- Overall project maturity/stage
- Working tree status (clean/dirty, uncommitted changes count)
- Key action items (errors to fix, PRs awaiting review, outdated deps, stale branches, CI failures, etc.)

### 14. Recommended Next Steps
A prioritized, numbered list of 3–5 concrete actions derived from the report findings. Only include items backed by actual findings — do not invent generic advice.

Draw from these categories (in rough priority order):
- ❌ Fix failing CI / tests / type errors
- 🔍 Review pending PRs or td issues awaiting review
- 🔒 Fix secrets exposure or .gitignore gaps
- 📦 Update outdated dependencies (major bumps first)
- 🧹 Clean up stale/merged branches
- 📝 Address TODO/FIXME/HACK markers
- 🚀 Start next high-priority task (from td or GitHub issues)

Format example:

  Recommended Next Steps
    1. 🔍 Review P0 issue td-31b69b "CRM plugin architecture"
    2. 🔒 Add *.pem and *.key to .gitignore
    3. 📦 Evaluate better-sqlite3 major upgrade (11 → 12)
    4. 🧹 Delete 8 merged branches
    5. 🚀 Start td-b02d69 "pi-crm-personal extension"

---

## Implementation Steps

When executing this skill, follow these steps:

```bash
# 1. Navigate to project (default: current working directory)
cd <project_path_or_.>

# 2. Verify it's a git repo
git rev-parse --is-inside-work-tree

# 3. Get project metadata
# - Read package.json / Cargo.toml / pyproject.toml for name, version, description
# - Read first paragraph of README.md for description fallback
# - Get current branch: git branch --show-current
# - Get working tree status: git status --porcelain

# 4. Get branch info
git branch --format='%(refname:short) %(committerdate:relative)'
# For each branch, get ahead/behind vs default branch:
git rev-list --left-right --count main...branch-name
# Identify default branch:
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'

# 5. Get commit history
git log --oneline --no-decorate -n 5
git rev-list --count HEAD
git log --reverse --format="%ai" | head -1  # first commit date
git log -1 --format="%ai"                    # latest commit date

# 6. Analyze codebase — language breakdown
# Count lines per file extension, excluding generated/vendor dirs
# Group by language (e.g. .ts + .tsx = TypeScript)
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
  -o -name "*.py" -o -name "*.rs" -o -name "*.go" -o -name "*.rb" \
  -o -name "*.java" -o -name "*.c" -o -name "*.cpp" -o -name "*.h" \
  -o -name "*.sh" -o -name "*.sql" -o -name "*.html" -o -name "*.css" \) \
  -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" \
  -not -path "*/build/*" -not -path "*/target/*" -not -path "*/__pycache__/*" \
  -not -path "*/.next/*" -not -path "*/coverage/*" \
  -not -name "*.min.*" -not -name "*.map" -not -name "*.d.ts" \
  -exec wc -l {} + | sort -rn

# 7. Check for GitHub remote and gh CLI
GITHUB_ORIGIN=$(git remote get-url origin 2>/dev/null | grep "github.com")
GH_AVAILABLE=$(gh auth status 2>&1 && echo "yes" || echo "no")
if [ -n "$GITHUB_ORIGIN" ] && [ "$GH_AVAILABLE" = "yes" ]; then
  gh pr list --state open --json number,title,headRefName,author,reviewDecision,statusCheckRollup,updatedAt --limit 20
  gh issue list --state open --json number,title,labels,assignees,createdAt --limit 20
  gh pr list --state merged --json number,title,mergedAt,author --limit 5
  gh run list --limit 5 --json databaseId,displayTitle,status,conclusion,headBranch,createdAt
fi

# 8. Check dependencies
# Node.js: npm outdated --json 2>/dev/null
# Rust: cargo outdated 2>/dev/null
# Python: pip list --outdated --format=json 2>/dev/null
# Go: go list -u -m all 2>/dev/null

# 9. Check for errors (language-specific)
# TypeScript: npx tsc --noEmit 2>&1
# Python: mypy or py_compile
# Rust: cargo check
# Go: go vet ./...

# 10. Scan for TODO/FIXME/HACK markers
grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  --include="*.py" --include="*.rs" --include="*.go" \
  -E "(TODO|FIXME|HACK|XXX|WORKAROUND|TEMP)(\(|:| )" . \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build

# 11. Run tests (if test runner detected, with 60s timeout)
# Node.js: timeout 60 npx vitest run --reporter=verbose 2>&1 || timeout 60 npm test 2>&1
# Rust: timeout 60 cargo test 2>&1
# Python: timeout 60 pytest --tb=short 2>&1
# Go: timeout 60 go test ./... 2>&1

# 12. Check for secrets exposure
git grep -lnE "(PRIVATE_KEY|SECRET_KEY|API_KEY|PASSWORD|TOKEN|Bearer )['\"]?=" -- '*.ts' '*.js' '*.py' '*.env*' '*.json' '*.yaml' '*.yml' 2>/dev/null
git ls-files | grep -E "^\.env"

# 13. Get uncommitted changes detail (if dirty)
if [ -n "$(git status --porcelain)" ]; then
  git diff --cached --stat         # staged
  git diff --stat                  # unstaged
  git ls-files --others --exclude-standard  # untracked
fi

# 14. Check for .todos directory and run td usage if present
if [ -d ".todos" ]; then
  td usage 2>&1
fi

# 15. Compile and format report
```

## Formatting Guidelines

- **NEVER** wrap section output in triple-backtick (```) code fences. All report sections must be plain text with Unicode formatting only.
- Use Unicode box-drawing characters for tables (┌ ┬ ┐ ├ ┼ ┤ └ ┴ ┘ │ ─)
- Use em-dash (—) for inline descriptions
- Keep the report compact but comprehensive
- Use relative time descriptions ("started yesterday", "2 weeks ago") alongside dates
- Indent sub-items with 2 spaces and a dash prefix
- All section headers use single space + bold or clear labels
- Use status icons consistently: ✅ passing/success, ❌ failing/error, ⏳ pending/in-progress, ⊘ cancelled, ⚠ warning/stale

## Multiple Projects

If the user provides multiple paths, generate a separate report for each project with a clear separator between them. Optionally provide a summary table at the end comparing projects.

## Example Output

See the user's example in the conversation for the target format and level of detail. Match that style closely:
- "Here's the status of [project-name]:" as the header
- Section labels in bold or clearly marked
- Commit table with box-drawing characters
- Codebase with line counts and descriptions
- Issues with specific error details
- GitHub PRs/issues with status icons
- Dependencies with version arrows
- Summary paragraph at the end
