---
name: dry-code-review
description: >
  Perform a comprehensive DRY (Don't Repeat Yourself) code review on a codebase.
  Identifies duplicated code, repeated logic, redundant patterns, and opportunities
  for abstraction. Use this skill whenever the user asks to review code for
  duplication, reduce repetition, apply DRY principles, refactor for reusability,
  find copy-pasted code, deduplicate logic, or audit code quality with a focus on
  redundancy. Also trigger when users say things like "clean up my code", "find
  repeated patterns", "too much boilerplate", "reduce code duplication", or
  "refactor for maintainability". Works on any language or framework.
---

# DRY Code Review Skill

Perform a structured, thorough code review focused on the DRY (Don't Repeat Yourself) principle. The review is planned and tracked via a markdown file in `plans/`.

## Overview

The DRY principle states: "Every piece of knowledge must have a single, unambiguous, authoritative representation within a system." This skill systematically finds violations and recommends fixes.

## Workflow

### Phase 1: Setup & Discovery

1. **Create the tracking plan** in `plans/dry-review-<project-name>.md` using the template below
2. **Inventory the codebase**: List all source files, their languages, sizes, and roles
3. **Identify scope**: Confirm with the user which directories/files to include or exclude (e.g., skip `node_modules`, `vendor`, generated files, test fixtures)

### Phase 2: Automated Scanning

Run the scanning script to find likely duplication:

```bash
bash /path/to/dry-code-review/scripts/find_duplicates.sh <target_directory> [extensions]
```

The script detects:
- Identical or near-identical code blocks (3+ lines repeated)
- Repeated string literals and magic numbers
- Similar function signatures across files
- Repeated boilerplate and configuration patterns

Import/dependency lines are intentionally excluded from the duplicate-lines scan so they don't dominate the output.

### Phase 3: Manual Analysis

After automated scanning, perform deeper analysis by reading the codebase. Look for these DRY violation categories:

#### Category 1: Literal Duplication
- Copy-pasted code blocks (exact or near-exact)
- Repeated string literals / magic numbers
- Duplicate configuration values

#### Category 2: Structural Duplication
- Functions/methods that do the same thing with minor variations
- Repeated conditional logic (same if/else chains)
- Similar class structures that could share a base class or mixin
- Repeated error handling patterns

#### Category 3: Logical Duplication
- Same business logic expressed differently in multiple places
- Repeated validation rules
- Duplicate data transformation pipelines
- Same algorithm implemented in multiple places

#### Category 4: Cross-Cutting Duplication
- Repeated boilerplate across files (logging, auth checks, error wrappers)
- Similar API endpoint handlers
- Repeated test setup/teardown code
- Duplicate build/deploy configuration

### Phase 4: Findings & Recommendations

For each finding, document:

1. **ID**: Sequential identifier (DRY-001, DRY-002, ...)
2. **Category**: Which of the 4 categories above
3. **Severity**: 🔴 High (5+ repetitions or core logic) / 🟡 Medium (2-4 repetitions) / 🟢 Low (minor or cosmetic)
4. **Locations**: File paths and line numbers of all occurrences
5. **Description**: What is duplicated and why it matters
6. **Recommendation**: Specific refactoring approach
7. **Effort**: S / M / L estimate

#### Common Refactoring Recommendations

- **Extract Function/Method**: Pull repeated logic into a shared function
- **Extract Constant/Config**: Replace magic numbers and repeated literals
- **Create Base Class/Mixin**: Share behavior across similar classes
- **Use Higher-Order Functions**: Wrap repeated patterns (decorators, middleware)
- **Create Shared Utility Module**: Centralize cross-cutting concerns
- **Use Templates/Generics**: Parameterize structural duplication
- **Apply Strategy Pattern**: Replace repeated conditional branches
- **Consolidate Configuration**: Single source of truth for settings

### Phase 5: Summary & Prioritization

Update the plan file with:
- Total findings count by category and severity
- A prioritized action list (quick wins first, then high-impact refactors)
- Estimated effort for full remediation
- Risk notes (what could break if refactored carelessly)

## Plan File Template

The plan file MUST be created at `plans/dry-review-<project-name>.md` using this structure:

```markdown
# DRY Code Review: <Project Name>

## Review Metadata
- **Date**: YYYY-MM-DD
- **Reviewer**: Claude (AI-assisted)
- **Scope**: <directories/files reviewed>
- **Languages**: <languages found>
- **Total Files Scanned**: <count>
- **Total Lines of Code**: <count>

## Status
- [ ] Phase 1: Setup & Discovery
- [ ] Phase 2: Automated Scanning
- [ ] Phase 3: Manual Analysis
- [ ] Phase 4: Findings & Recommendations
- [ ] Phase 5: Summary & Prioritization

## Scope Definition
### Included
- <list of included paths>

### Excluded
- <list of excluded paths and reasons>

## Findings

### Summary
| Category               | 🔴 High | 🟡 Medium | 🟢 Low | Total |
|------------------------|---------|----------|--------|-------|
| Literal Duplication    |         |          |        |       |
| Structural Duplication |         |          |        |       |
| Logical Duplication    |         |          |        |       |
| Cross-Cutting          |         |          |        |       |
| **Total**              |         |          |        |       |

### Detailed Findings

#### DRY-001: <Title>
- **Category**: <category>
- **Severity**: 🔴/🟡/🟢
- **Locations**:
  - `path/to/file1.ts:L10-L25`
  - `path/to/file2.ts:L30-L45`
- **Description**: <what is duplicated>
- **Recommendation**: <how to fix>
- **Effort**: S/M/L

<!-- Repeat for each finding -->

## Prioritized Action Plan

### Quick Wins (Small effort, immediate value)
1. <action item>

### High-Impact Refactors (Medium/Large effort)
1. <action item>

### Nice-to-Have (Low priority)
1. <action item>

## Risk Notes
- <things to watch out for when refactoring>

## Review Log
- YYYY-MM-DD: Review initiated
- YYYY-MM-DD: <phase completed>
```

## Important Guidelines

- **Don't over-DRY**: Not all repetition is bad. Flag but note when duplication is acceptable (e.g., test readability, intentional denormalization, simple 2-line patterns)
- **Respect boundaries**: Code that looks similar but serves different domains may rightfully be separate (bounded contexts)
- **Consider churn**: Frequently modified code benefits more from DRY than stable code
- **Preserve clarity**: A refactoring that makes code harder to read is not an improvement
- **Track progress**: Update the plan file checkboxes as each phase completes
- **Be specific**: Always include file paths and line numbers, never vague references
