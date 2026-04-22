# Skill Writing Guide

Detailed guidance for writing effective SKILL.md files. Read this when you need
to write or significantly revise a skill.

## Table of Contents

- [The Description Field](#the-description-field)
- [Body Structure Patterns](#body-structure-patterns)
- [Progressive Disclosure](#progressive-disclosure)
- [Degrees of Freedom](#degrees-of-freedom)
- [Scripts vs Instructions](#scripts-vs-instructions)
- [Working with References](#working-with-references)
- [Working with Assets](#working-with-assets)
- [Anti-Patterns](#anti-patterns)
- [Examples](#examples)

## The Description Field

The description is the single most important piece of a skill. It's the ONLY
content always in the agent's system prompt — everything else loads on demand.

### Structure

```
[What it does] + [When to use it] + [Key capabilities/file types]
```

### Good Descriptions

```yaml
# Specific, actionable, includes triggers
description: >
  Analyzes Figma design files and generates developer handoff documentation.
  Use when user uploads .fig files, asks for "design specs", "component
  documentation", or "design-to-code handoff".

# Includes trigger phrases users would actually say
description: >
  Manages Linear project workflows including sprint planning, task creation,
  and status tracking. Use when user mentions "sprint", "Linear tasks",
  "project planning", or asks to "create tickets".

# Clear value prop with file types
description: >
  Extracts text and tables from PDF files, fills PDF forms, and merges
  multiple PDFs. Use when working with PDF documents.
```

### Bad Descriptions

```yaml
# Too vague — won't trigger correctly
description: Helps with projects.

# Missing triggers — agent doesn't know WHEN to use it
description: Creates sophisticated multi-page documentation systems.

# Too technical, no user context
description: Implements the Project entity model with hierarchical relationships.
```

### Testing Your Description

Ask the agent: "When would you use the [skill-name] skill?" It will quote the
description back. If the answer doesn't match your intent, revise.

### Negative Triggers

For skills that might over-trigger, add exclusions:

```yaml
description: >
  Advanced data analysis for CSV files. Use for statistical modeling,
  regression, clustering. Do NOT use for simple data exploration or
  basic charting (those don't need this skill).
```

## Body Structure Patterns

### Pattern 1: Workflow (sequential processes)

Best for multi-step procedures with a specific order.

```markdown
## Workflow

### Step 1: Validate Input
Run `scripts/validate.sh` to check format.
If validation fails, report the specific error.

### Step 2: Process Data
[Instructions with decision points]

### Step 3: Generate Output
[Instructions with quality checks]
```

Key techniques: explicit step ordering, dependencies between steps, validation
at each stage, rollback instructions for failures.

### Pattern 2: Task-Based (tool collections)

Best when the skill offers different independent operations.

```markdown
## Quick Start
[Most common operation]

## Merge PDFs
[Steps for merging]

## Split PDFs
[Steps for splitting]

## Extract Text
[Steps for extraction]
```

### Pattern 3: Decision Tree (conditional workflows)

Best when the approach depends on context.

```markdown
## Determine Approach

1. Check the input type:
   - **PDF file** → Follow "PDF Processing" below
   - **Image file** → Follow "Image Processing" below
   - **Text file** → Handle directly, no special processing

## PDF Processing
[Steps]

## Image Processing
[Steps]
```

### Pattern 4: Iterative Refinement

Best when output quality improves with iteration.

```markdown
## Generate Draft
1. Create initial output
2. Save to temporary location

## Quality Check
1. Run `scripts/check.py`
2. Review against criteria:
   - [ ] All sections present
   - [ ] No placeholder text
   - [ ] Data validated

## Refine
1. Address each issue
2. Re-run quality check
3. Repeat until passing
```

## Progressive Disclosure

The three-level system minimizes context window usage:

| Level | Content | Size target | Loaded when |
|---|---|---|---|
| 1. Frontmatter | name + description | ~100 words | Always |
| 2. SKILL.md body | Core instructions | <500 lines / <5000 words | Skill triggers |
| 3. Bundled files | Detail, scripts, assets | Unlimited | Agent decides |

### When to Split Content

Move content from SKILL.md to references when:
- SKILL.md exceeds 500 lines
- A section is only relevant to specific sub-tasks
- Detailed API docs, schemas, or specifications
- Framework-specific variations (aws.md, gcp.md, azure.md)
- Content that's useful 20% of the time

### Linking to References

Always explain WHAT the reference contains and WHEN to read it:

```markdown
## Database Operations

For simple queries, use the patterns below.

For complex joins and aggregations, see
[references/advanced-queries.md](references/advanced-queries.md) which covers
window functions, CTEs, and performance optimization.
```

Bad (no context for when to read it):
```markdown
See [references/stuff.md](references/stuff.md) for more information.
```

### Reference File Structure

For files over 100 lines, add a table of contents:

```markdown
# API Reference

## Table of Contents
- [Authentication](#authentication)
- [Endpoints](#endpoints)
- [Error Codes](#error-codes)
- [Rate Limits](#rate-limits)

## Authentication
...
```

## Degrees of Freedom

Match instruction specificity to the task's fragility:

### High Freedom (guidelines)

When multiple approaches work and context varies:

```markdown
## Writing Style
- Keep paragraphs short (2-4 sentences)
- Use active voice
- Adapt tone to the audience
```

### Medium Freedom (patterns with parameters)

When a preferred approach exists but variation is acceptable:

```markdown
## File Naming
Use the pattern: `YYYY-MM-DD-{slug}.md`
The slug should be lowercase, hyphenated, derived from the title.
```

### Low Freedom (exact scripts)

When operations are fragile, error-prone, or must be consistent:

```markdown
## Rotate PDF
Run exactly:
\`\`\`bash
python3 scripts/rotate_pdf.py --input {file} --degrees {angle} --output {output}
\`\`\`
Do not attempt to rotate PDFs any other way.
```

**Rule of thumb:** Use high freedom for creative tasks, low freedom for
data-sensitive or destructive operations.

## Scripts vs Instructions

### When to Use Scripts

- Same code rewritten every time → put in `scripts/`
- Operation must be deterministic (data processing, validation)
- Complex logic that's error-prone in natural language
- Performance-sensitive operations

### When to Use Instructions

- Context-dependent decisions
- Creative or judgment-based tasks
- Simple operations the agent can do inline
- One-off operations that vary each time

### Script Best Practices

```python
#!/usr/bin/env python3
"""
Brief description of what this script does.

Usage:
    python3 scripts/process.py --input <file> --output <dir>
"""
# Scripts should be self-documenting with --help
# Include error handling and clear exit codes
# Test before including in the skill
```

Scripts can be executed WITHOUT loading into context — they're token-efficient.
But the agent may read them for understanding or patching.

## Working with References

### Good Reference Candidates

- API documentation (endpoints, parameters, auth)
- Database schemas (tables, relationships, types)
- Domain knowledge (policies, regulations, standards)
- Detailed workflow guides (only needed for complex cases)
- Framework-specific patterns (one file per framework)

### Bad Reference Candidates (keep in SKILL.md instead)

- Core workflow steps (the main thing the skill does)
- Critical warnings or gotchas
- Decision trees for choosing approach
- Configuration the agent always needs

## Working with Assets

Assets are files used in output — NOT loaded into context.

### Good Asset Candidates

- Document templates (.docx, .pptx, .xlsx)
- Boilerplate project directories
- Images, icons, logos
- Font files
- Sample data for testing

### Using Assets in Instructions

```markdown
## Create Report

1. Copy the template from `assets/report-template.docx`
2. Fill in the sections using the gathered data
3. Save to the output directory
```

## Anti-Patterns

### The Knowledge Dump

❌ Putting everything the agent could possibly need into SKILL.md

✅ Only include what the agent doesn't already know. Challenge each paragraph:
"Does this justify its token cost?"

### The README Trap

❌ Including README.md, CHANGELOG.md, INSTALLATION_GUIDE.md

✅ A skill is for the agent, not humans. All docs go in SKILL.md or references.

### The Inline Script

❌ 200-line code blocks inside SKILL.md

✅ Move to `scripts/`, reference with: `Run scripts/process.py`

### The Vague Description

❌ `description: Helps with data processing`

✅ Include WHAT + WHEN + trigger phrases

### Over-Explaining the Obvious

❌ "Git is a version control system. To commit changes, use `git commit`..."

✅ Skip what the agent already knows. Focus on YOUR specific conventions.

## Examples

### Minimal Skill (guidelines only)

```
code-style/
└── SKILL.md
```

```yaml
---
name: code-style
description: >
  Enforce team coding standards for TypeScript projects. Use when writing
  or reviewing TypeScript code, or when asked about code style.
---
```

### Medium Skill (workflow + script)

```
pdf-forms/
├── SKILL.md
└── scripts/
    ├── analyze_form.py
    └── fill_form.py
```

### Full Skill (all resource types)

```
design-system/
├── SKILL.md
├── scripts/
│   └── extract_tokens.py
├── references/
│   ├── color-theory.md
│   └── wcag-guidelines.md
└── assets/
    └── swatch-template.svg
```
