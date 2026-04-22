# Plan: DRY Code Review Skill

## Objective
Create a reusable Claude skill that performs structured code reviews focused on the DRY (Don't Repeat Yourself) principle. The skill should be able to analyze any codebase, find duplication, and provide actionable refactoring recommendations — all tracked in a markdown plan file.

## Status: ✅ Complete (Initial Version)

## Deliverables

| Deliverable | Status | Path |
|---|---|---|
| SKILL.md | ✅ Done | `dry-code-review/SKILL.md` |
| Scanning script | ✅ Done | `dry-code-review/scripts/find_duplicates.sh` |
| This plan | ✅ Done | `plans/dry-code-review-plan.md` |

## Skill Design

### Trigger Phrases
The skill should activate when users say things like:
- "Review my code for duplication"
- "Apply DRY principles to this codebase"
- "Find repeated code / copy-pasted logic"
- "Reduce code duplication"
- "Refactor for reusability"
- "Audit code quality" (with focus on redundancy)
- "Clean up my code"
- "Too much boilerplate"
- "Deduplicate"

### 5-Phase Workflow
1. **Setup & Discovery** — Inventory files, define scope, create plan file
2. **Automated Scanning** — Run `find_duplicates.sh` for quick wins
3. **Manual Analysis** — Deep read of codebase across 4 violation categories
4. **Findings & Recommendations** — Structured findings with severity, locations, and fix suggestions
5. **Summary & Prioritization** — Prioritized action plan with effort estimates

### DRY Violation Categories
1. **Literal Duplication** — Copy-pasted code, repeated strings, magic numbers
2. **Structural Duplication** — Similar functions/classes with minor variations
3. **Logical Duplication** — Same business logic expressed differently
4. **Cross-Cutting Duplication** — Repeated boilerplate (logging, auth, error handling)

### Key Design Decisions
- **Plan-driven**: Every review creates a tracking markdown file in `plans/` so progress is visible and persistent
- **Severity levels**: 🔴 High / 🟡 Medium / 🟢 Low to help prioritize
- **Anti-over-DRY**: Skill explicitly warns against refactoring that hurts readability or crosses bounded contexts
- **Language-agnostic**: Works on any language; the script handles common patterns, and manual analysis fills the gaps
- **Effort estimates**: Each finding gets S/M/L sizing for planning

## Implementation Notes

### `find_duplicates.sh` capabilities
- Finds lines repeated 3+ times across the codebase
- Detects magic numbers and repeated string literals
- Identifies similar function signatures
- Compares file-level similarity (≤100 files)
- Auto-excludes `node_modules`, `.git`, `vendor`, `dist`, `build`, etc.
- Accepts target directory and optional file extension filter

### Plan file template
Each review generates a structured markdown file with:
- Review metadata (date, scope, languages, file/line counts)
- Phase checklist for progress tracking
- Findings table with category breakdown
- Detailed per-finding documentation (ID, category, severity, locations, recommendation, effort)
- Prioritized action plan (quick wins → high-impact → nice-to-have)
- Risk notes for safe refactoring

## Future Improvements
- [ ] Add language-specific analyzers (e.g., AST-based for JS/TS/Python)
- [ ] Add a `--json` output mode to the scanner for programmatic processing
- [ ] Create a summary report generator that produces a polished final document
- [ ] Add support for comparing against a baseline (track DRY improvements over time)
- [ ] Add integration with git blame to identify who introduced duplication and when
- [ ] Create threshold configs per project (some projects tolerate more repetition)

## Review Log
- 2026-02-25: Skill created — SKILL.md, find_duplicates.sh, and plan file
