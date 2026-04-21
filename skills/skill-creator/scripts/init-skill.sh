#!/usr/bin/env bash
# init-skill.sh — Scaffold a new skill directory
#
# Usage:
#   bash scripts/init-skill.sh <skill-name> [target-directory]
#
# Examples:
#   bash scripts/init-skill.sh pdf-processor
#   bash scripts/init-skill.sh pdf-processor ~/.pi/agent/skills
#   bash scripts/init-skill.sh my-tool .pi/skills
#
# Creates:
#   <target>/<skill-name>/
#   ├── SKILL.md          (template with TODOs)
#   ├── scripts/          (empty, ready for executable code)
#   └── references/       (empty, ready for documentation)

set -euo pipefail

SKILL_NAME="${1:-}"
TARGET_DIR="${2:-.}"

if [[ -z "$SKILL_NAME" ]]; then
  echo "Usage: bash init-skill.sh <skill-name> [target-directory]"
  echo ""
  echo "Skill name must be kebab-case (lowercase, hyphens, digits only)."
  exit 1
fi

# Validate skill name
if ! [[ "$SKILL_NAME" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo "❌ Invalid skill name: '$SKILL_NAME'"
  echo "   Must be kebab-case: lowercase letters, digits, hyphens."
  echo "   No leading/trailing hyphens, no consecutive hyphens."
  exit 1
fi

if [[ ${#SKILL_NAME} -gt 64 ]]; then
  echo "❌ Skill name too long (${#SKILL_NAME} chars, max 64)"
  exit 1
fi

SKILL_DIR="$TARGET_DIR/$SKILL_NAME"

if [[ -d "$SKILL_DIR" ]]; then
  echo "❌ Directory already exists: $SKILL_DIR"
  exit 1
fi

# Create structure
mkdir -p "$SKILL_DIR"/{scripts,references}

# Generate SKILL.md
cat > "$SKILL_DIR/SKILL.md" << 'TEMPLATE'
---
name: SKILL_NAME_PLACEHOLDER
description: >
  TODO: What this skill does (1 sentence). Use when [specific trigger
  scenarios]. Also triggers on "[phrase 1]", "[phrase 2]", "[phrase 3]".
---

# TODO: Skill Title

TODO: Brief overview (1-2 sentences). What does this skill enable?

## Workflow

### Step 1: TODO
TODO: First major step with specific instructions.

### Step 2: TODO
TODO: Next step. Include error handling for common failures.

## Tips

- TODO: Non-obvious best practices
- TODO: Common mistakes to avoid
TEMPLATE

# Replace placeholder with actual name
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s/SKILL_NAME_PLACEHOLDER/$SKILL_NAME/" "$SKILL_DIR/SKILL.md"
else
  sed -i "s/SKILL_NAME_PLACEHOLDER/$SKILL_NAME/" "$SKILL_DIR/SKILL.md"
fi

echo "✅ Skill scaffolded: $SKILL_DIR/"
echo ""
echo "   $SKILL_DIR/"
echo "   ├── SKILL.md        ← edit this (TODOs marked)"
echo "   ├── scripts/        ← add executable code"
echo "   └── references/     ← add detailed docs"
echo ""
echo "Next: Edit SKILL.md — fill in the description and workflow."
