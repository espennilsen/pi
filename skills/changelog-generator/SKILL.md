---
name: changelog-generator
description: >
  Parse git history and produce or update a CHANGELOG.md following the Keep a Changelog
  convention. Supports Conventional Commits, basic prefix conventions, and unstructured
  commit messages. Intelligently categorizes changes, detects breaking changes, links
  to PRs/issues, and handles both initial generation and incremental updates.

  **Triggers — use this skill when:**
  - User asks to "generate", "create", "update", or "write" a changelog
  - User mentions "CHANGELOG", "changelog", "release notes"
  - User says "document changes", "what changed since last release"
  - User wants to "prepare a release" and needs a changelog entry
  - User asks to "clean up" or "reformat" an existing changelog

  **Covers:** Any git-based project. Handles Conventional Commits (feat/fix/chore),
  Angular convention, basic prefixes (Add/Fix/Remove), and freeform commit messages.
  Outputs Keep a Changelog format with optional Common Changelog enhancements.
---

# Changelog Generator

Parse a project's git history and produce a high-quality CHANGELOG.md following
the [Keep a Changelog](https://keepachangelog.com/) convention.

## Philosophy

A changelog is for **humans**, not machines. It answers: "What meaningful changes
happened between version X and version Y?" Raw commit logs fail at this because
they contain noise — typo fixes, merge commits, CI tweaks, and refactors that
don't affect users. This skill filters signal from noise and writes entries that
a user or contributor can actually understand.

---

## Workflow

### Phase 1 — Repository Analysis

Before generating anything, understand the project's commit and versioning patterns.

```bash
# 1. Check if we're in a git repo
git rev-parse --is-inside-work-tree 2>/dev/null

# 2. Get all tags (versions) sorted by date
git tag --sort=-creatordate | head -30

# 3. Detect versioning scheme
# SemVer: v1.2.3 or 1.2.3
# CalVer: 2025.01, 2025-01-15
# Other: named releases, build numbers
git tag --sort=-creatordate | head -10

# 4. Detect commit convention
# Sample recent commits to identify the pattern
git log --oneline -30

# 5. Check for existing changelog
cat CHANGELOG.md 2>/dev/null
cat HISTORY.md 2>/dev/null
cat CHANGES.md 2>/dev/null

# 6. Check for existing config that hints at convention
cat .commitlintrc* commitlint.config.* 2>/dev/null  # Commitlint
cat .czrc .cz.toml 2>/dev/null                       # Commitizen
cat cliff.toml 2>/dev/null                            # git-cliff
cat .versionrc* 2>/dev/null                           # standard-version

# 7. Get remote URL for PR/issue links
git remote get-url origin 2>/dev/null

# 8. Package manifest for current version
cat package.json 2>/dev/null | grep '"version"'
cat pyproject.toml 2>/dev/null | grep 'version'
cat Cargo.toml 2>/dev/null | grep '^version'
```

**Extract from the analysis:**

| Fact | How to determine |
|------|-----------------|
| Commit convention | Pattern match on recent commits (see detection rules below) |
| Versioning scheme | Tag format analysis |
| Latest version/tag | Most recent tag |
| Remote URL | `git remote get-url origin` — needed for PR/issue links |
| Existing changelog | Check for CHANGELOG.md or variants |
| Unreleased commits | Commits since the latest tag |

### Phase 2 — Commit Convention Detection

Analyze the last 30–50 commits to detect which convention is in use. Apply these rules in order:

**Conventional Commits / Angular**
```
Pattern: ^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:
Example: feat(auth): add OAuth2 support
Example: fix!: resolve race condition in queue
```
→ If >50% of commits match this pattern, use Conventional Commits parsing.

**Basic Prefix**
```
Pattern: ^(Add|Fix|Remove|Update|Change|Deprecate|Security)[: ]
Example: Add user export feature
Example: Fix login redirect loop
```
→ If >50% of commits match this pattern, use basic prefix parsing.

**Freeform / No Convention**
→ If neither pattern dominates, use AI-assisted categorization (see Phase 3).

Report the detected convention to the user before proceeding.

### Phase 3 — Commit Extraction & Categorization

Extract commits for the target range and categorize them.

```bash
# All commits since last tag (for Unreleased section)
git log $(git describe --tags --abbrev=0 2>/dev/null)..HEAD \
  --pretty=format:"%H|%s|%b|%an|%ae|%aI" 2>/dev/null

# Commits between two tags (for a specific version)
git log v1.1.0..v1.2.0 \
  --pretty=format:"%H|%s|%b|%an|%ae|%aI"

# If no tags exist, get all commits
git log --pretty=format:"%H|%s|%b|%an|%ae|%aI"

# Get PR/merge info if available
git log --merges --oneline -20
```

#### Category Mapping

Map commits to Keep a Changelog categories:

| Keep a Changelog Category | Conventional Commits types | Basic prefixes | Description |
|---------------------------|---------------------------|----------------|-------------|
| **Added** | `feat` | Add, Create, Implement | New features |
| **Changed** | `refactor`, `perf`, `style` | Change, Update, Refactor, Improve | Changes to existing functionality |
| **Deprecated** | — (detect from message) | Deprecate | Soon-to-be removed features |
| **Removed** | — (detect from message) | Remove, Delete, Drop | Removed features |
| **Fixed** | `fix` | Fix, Resolve, Correct | Bug fixes |
| **Security** | — (detect from message) | Security | Vulnerability fixes |

#### Entries to SKIP (noise filtering)

Do NOT include these in the changelog unless they have user-facing impact:

- Merge commits (`Merge branch...`, `Merge pull request...`) — extract the PR title instead
- CI/CD changes (`ci:`, `build:`, changes only to `.github/workflows/`)
- Chore commits (`chore:`, dependency bumps without breaking changes)
- Typo fixes in code comments
- Formatting/linting-only changes (`style:` that don't affect behavior)
- Version bump commits (`chore: bump version to...`)
- Commits that only touch test files (unless adding test coverage is noteworthy)

#### Freeform Commit Categorization

When commits don't follow a convention, categorize by analyzing the message content:

- Contains "add", "new", "create", "implement", "introduce" → **Added**
- Contains "fix", "resolve", "correct", "patch", "bug" → **Fixed**
- Contains "remove", "delete", "drop" → **Removed**
- Contains "deprecate" → **Deprecated**
- Contains "security", "vulnerability", "CVE" → **Security**
- Contains "update", "change", "refactor", "improve", "optimize" → **Changed**
- If unclear, use the diff to determine: new files = Added, deleted files = Removed, modified = Changed

#### Breaking Change Detection

Flag breaking changes regardless of convention:

- Conventional: `!` after type/scope, or `BREAKING CHANGE:` in footer
- Message content: "breaking", "incompatible", "migration required"
- SemVer major bump between tags
- Removal of public API functions/endpoints

Mark breaking entries with **BREAKING:** prefix in the changelog.

### Phase 4 — Entry Writing

Transform raw commit data into human-readable changelog entries.

#### Writing Rules

1. **Write for the user, not the developer.** "Add dark mode support" not "feat(ui): implement dark-mode toggle via CSS custom properties in ThemeProvider"
2. **Use imperative mood.** "Add", "Fix", "Remove" — not "Added", "Fixed", "Removed"
3. **One entry per meaningful change.** Squash related commits into a single entry
4. **Include references.** Link to PR numbers and issues: `(#123)`, `([#123](url))`
5. **Credit authors for external contributions.** `(@username)` for non-core contributors
6. **Lead with impact.** Put the most important changes first within each category
7. **Be specific.** "Fix crash when uploading files larger than 10MB" not "Fix upload bug"
8. **Keep entries to one line.** If you need more, the change probably needs multiple entries or a migration guide

#### Entry Format

```markdown
- Add dark mode support with automatic system preference detection (#142)
- **BREAKING:** Remove deprecated `v1/users` endpoint; use `v2/users` instead (#138)
- Fix memory leak in WebSocket connection handler (#145)
```

### Phase 5 — Assemble the Changelog

#### File Format (Keep a Changelog)

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Description of new feature (#PR)

### Fixed
- Description of bug fix (#PR)

## [1.2.0] - 2025-09-15

### Added
- Add OAuth2 authentication support (#89)
- Add CSV export for user data (#92)

### Changed
- Improve query performance for large datasets (#91)

### Fixed
- Fix timezone handling in scheduled reports (#88)
- Fix incorrect pagination count on filtered results (#90)

### Removed
- **BREAKING:** Remove legacy XML API endpoint (#87)

## [1.1.0] - 2025-06-01

### Added
- ...

[Unreleased]: https://github.com/user/repo/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/user/repo/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/user/repo/compare/v1.0.0...v1.1.0
```

#### Critical Format Rules

1. **H1 for title.** `# Changelog` — only one H1
2. **H2 for versions.** `## [1.2.0] - 2025-09-15` — square brackets around version, ISO date
3. **H3 for categories.** `### Added`, `### Changed`, etc. — only use categories that have entries
4. **Comparison links at the bottom.** Every version heading must have a corresponding comparison link
5. **Unreleased section at top.** Always present, even if empty (remove if the project prefers not to have it)
6. **Newest version first.** Reverse chronological order
7. **ISO 8601 dates.** `YYYY-MM-DD` — no exceptions
8. **Empty categories.** Do NOT include a category heading if there are no entries under it

---

## Operating Modes

### Mode A: Generate from Scratch

No existing changelog. Generate the full history.

1. Get all tags sorted chronologically
2. For each tag pair (oldest to newest), extract and categorize commits
3. Assemble full changelog
4. If there are many tags (>10), ask the user if they want all history or just recent versions

```bash
# Get tags in chronological order
git tag --sort=creatordate

# Get date of a tag
git log -1 --format=%aI v1.0.0
```

### Mode B: Update Existing Changelog

A CHANGELOG.md already exists. Add new entries.

1. Parse the existing changelog to find the latest documented version
2. Determine the commit range: latest documented version → HEAD (or → new tag)
3. Generate entries only for the new range
4. Insert the new version section after `## [Unreleased]` (or at the top if no Unreleased)
5. Update comparison links at the bottom
6. Preserve all existing content exactly as-is

**Never modify existing entries** unless the user explicitly asks for a reformat.

### Mode C: Reformat / Clean Up

User has a messy or inconsistent changelog. Rewrite to match the standard.

1. Parse all existing entries
2. Re-categorize under Keep a Changelog headings
3. Fix date formats to ISO 8601
4. Add missing comparison links
5. Fix heading hierarchy
6. Show a diff/summary of changes to the user before writing

### Mode D: Prepare Release

User wants to create a changelog entry for an upcoming release.

1. Extract commits since the last tag
2. Categorize and write entries
3. Ask the user for the new version number (or suggest one based on changes: major if breaking, minor if features, patch if only fixes)
4. Move entries from `## [Unreleased]` to the new version section
5. Update comparison links
6. Optionally suggest a SemVer bump

---

## Handling Edge Cases

### No Tags
If the project has no tags, treat all commits as unreleased. Ask the user if they want to:
- Generate a single `## [Unreleased]` section
- Create a `## [0.1.0]` retroactively from the initial commit

### Monorepo
If the project is a monorepo with multiple packages:
- Ask which package to generate for
- Filter commits by path: `git log -- packages/package-name/`
- Consider separate changelogs per package

### Squash Merges
If the project uses squash merges, the PR title becomes the commit message. These are often well-written and can be used directly as changelog entries.

### Very Large History
If there are >500 commits to process:
- Process in batches by tag range
- Ask the user if they want full history or just the last N versions
- For initial generation, suggest starting from the latest 3-5 versions

### Pre-1.0 Projects
For projects that haven't reached 1.0:
- Minor bumps may contain breaking changes (per SemVer spec)
- Still flag breaking changes but note the pre-1.0 context

---

## Quality Checklist

After generating, verify:

### Format
- [ ] Single H1 (`# Changelog`)
- [ ] Each version is H2 with brackets and ISO date: `## [X.Y.Z] - YYYY-MM-DD`
- [ ] Categories are H3: `### Added`, `### Changed`, etc.
- [ ] No empty categories (remove heading if no entries)
- [ ] Comparison links at bottom for every version
- [ ] Newest version first (reverse chronological)
- [ ] Unreleased section present at top

### Content
- [ ] Every entry starts with imperative verb
- [ ] PR/issue references included where available
- [ ] Breaking changes clearly marked with **BREAKING:**
- [ ] No noise commits (merge commits, version bumps, CI-only changes)
- [ ] Entries are specific and user-facing
- [ ] Related commits are squashed into single entries

### Accuracy
- [ ] Version numbers match actual git tags
- [ ] Dates match tag creation dates
- [ ] Comparison links use correct tag names
- [ ] No commits are attributed to the wrong version

---

## Anti-Patterns to Avoid

1. **Dump of commit messages** — A changelog is not `git log --oneline`. Curate and rewrite.
2. **"Bug fixes and improvements"** — This tells the user nothing. Be specific.
3. **Including every single commit** — Filter noise. Only user-facing changes matter.
4. **Inconsistent tense** — Always imperative mood: "Add", "Fix", "Remove"
5. **Missing links** — Always include comparison links at the bottom
6. **Invented version numbers** — Only use versions that correspond to actual tags
7. **Reformatting existing entries** — When updating, never touch historical entries unless asked
8. **Skipping the preamble** — Always include the "format is based on" reference lines

---

## Output

The final output should be:

1. **Convention report**: What commit convention was detected, how many commits processed
2. **The CHANGELOG.md file**: Written to the project root, ready to commit
3. **Summary**: Number of versions documented, total entries, any commits that were ambiguous or skipped

Always write the changelog as a file so the user can review and commit it directly.
