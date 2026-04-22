# Skill Patterns

Common patterns for different skill categories. Read this when designing a
skill and you're not sure how to structure it.

## Table of Contents

- [Category 1: Document and Asset Creation](#category-1-document-and-asset-creation)
- [Category 2: Workflow Automation](#category-2-workflow-automation)
- [Category 3: Tool Enhancement](#category-3-tool-enhancement)
- [Sequential Workflow Orchestration](#sequential-workflow-orchestration)
- [Multi-Tool Coordination](#multi-tool-coordination)
- [Iterative Refinement](#iterative-refinement)
- [Context-Aware Tool Selection](#context-aware-tool-selection)
- [Domain-Specific Intelligence](#domain-specific-intelligence)
- [Output Templates](#output-templates)

## Category 1: Document and Asset Creation

For skills that produce consistent, high-quality output (documents, designs,
code, presentations).

**Key techniques:**
- Embedded style guides and brand standards
- Template structures for consistent output
- Quality checklists before finalizing
- Examples of good and bad output

**Structure:**
```markdown
## Output Standards
[Style guide, brand requirements, quality criteria]

## Creation Workflow
### Step 1: Gather Requirements
### Step 2: Generate Draft
### Step 3: Quality Review
[Checklist against standards]
### Step 4: Finalize
```

## Category 2: Workflow Automation

For multi-step processes that benefit from consistent methodology.

**Key techniques:**
- Step-by-step workflow with validation gates
- Templates for common structures
- Built-in review and improvement loops
- Clear success criteria

**Structure:**
```markdown
## Overview
[What this workflow accomplishes]

## Prerequisites
[What's needed before starting]

## Workflow
### Step 1: [Action]
[Instructions with validation]
### Step 2: [Action]
[Instructions with dependencies on Step 1]

## Troubleshooting
[Common failures and fixes]
```

## Category 3: Tool Enhancement

For skills that add workflow guidance on top of tool/extension/MCP access.

**Key techniques:**
- Coordinates multiple tool calls in sequence
- Embeds domain expertise about the tool's API
- Provides context users would otherwise need to specify
- Error handling for common tool failures

**Structure:**
```markdown
## Quick Start
[Most common operation, 3-5 lines]

## Tools Available
[Brief summary of what the underlying tool provides]

## Workflows
### [Common Task 1]
[Steps using the tool, with error handling]
### [Common Task 2]
[Steps using the tool]

## Tips
[Non-obvious best practices]
```

## Sequential Workflow Orchestration

When steps must happen in a specific order:

```markdown
## Onboard New Customer

### Step 1: Create Account
Call: create_customer(name, email, company)
Save: customer_id from response

### Step 2: Setup Payment
Call: setup_payment(customer_id, method)
Wait for: payment verification
If failed: log error, stop, notify user

### Step 3: Create Subscription
Call: create_subscription(customer_id, plan_id)
Requires: Step 2 completed successfully

### Step 4: Send Welcome Email
Call: send_email(customer_id, template="welcome")
```

**Key:** Explicit dependencies, validation at each stage, clear failure handling.

## Multi-Tool Coordination

When a workflow spans multiple tools or services:

```markdown
## Design-to-Development Handoff

### Phase 1: Design Export (Penpot)
1. Export design assets
2. Generate specifications
3. Create asset manifest

### Phase 2: Asset Storage (Git)
1. Create feature branch
2. Commit all assets
3. Generate links

### Phase 3: Task Creation (td)
1. Create implementation tasks
2. Attach asset references
3. Set priorities
```

**Key:** Clear phase separation, data passing between tools, validation before
moving to next phase.

## Iterative Refinement

When output quality improves with revision cycles:

```markdown
## Generate Report

### Draft
1. Gather data
2. Generate first draft
3. Save to working file

### Review
1. Run quality check: `scripts/check.py`
2. Identify issues:
   - Missing sections
   - Inconsistent data
   - Formatting errors

### Refine
1. Address each issue
2. Regenerate affected sections
3. Re-check quality
4. Repeat until passing (max 3 iterations)

### Finalize
1. Apply final formatting
2. Generate summary
3. Save final version
```

**Key:** Explicit quality criteria, bounded iteration (max N cycles), deterministic
validation (scripts over judgment where possible).

## Context-Aware Tool Selection

When the same goal requires different approaches based on input:

```markdown
## Process File

### Determine Approach
1. Check file type and size
2. Select handler:
   - PDF → `scripts/process_pdf.py`
   - Image (< 5MB) → process inline
   - Image (≥ 5MB) → `scripts/process_large_image.py`
   - Text → handle directly

### Execute
Run the selected handler with appropriate parameters.

### Explain
Tell the user why this approach was chosen.
```

**Key:** Clear decision criteria, fallback options, transparency about choices.

## Domain-Specific Intelligence

When the skill adds specialized knowledge beyond tool access:

```markdown
## Financial Compliance Check

### Before Processing
1. Fetch transaction details
2. Apply compliance rules:
   - Sanctions list check
   - Jurisdiction verification
   - Risk assessment (see references/risk-matrix.md)
3. Document compliance decision with rationale

### Processing
IF compliant: proceed with transaction
ELSE: flag for review, create compliance case

### Audit Trail
- Log all checks performed
- Record decisions with timestamps
- Generate audit report
```

**Key:** Domain expertise embedded in logic, compliance/governance built in,
comprehensive documentation for audit.

## Output Templates

### Strict Template (data formats, reports)

```markdown
## Report Structure

ALWAYS use this exact structure:

# [Title]

## Executive Summary
[One paragraph, 3-4 sentences]

## Key Findings
- Finding 1 with data
- Finding 2 with data

## Recommendations
1. Specific, actionable recommendation
2. Specific, actionable recommendation
```

### Flexible Template (creative output)

```markdown
## Report Structure

Suggested format (adapt as needed):

# [Title]

## Summary
[Overview — length depends on complexity]

## Analysis
[Organize sections based on findings]

## Next Steps
[Tailor to context]
```

### Example-Based (style matching)

```markdown
## Commit Message Format

Follow these examples:

Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication

Input: Fixed bug where dates display incorrectly
Output: fix(reports): correct date formatting in timezone conversion

Pattern: type(scope): brief description
```

Examples are often more effective than rules for output format.
