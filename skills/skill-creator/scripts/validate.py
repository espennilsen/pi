#!/usr/bin/env python3
"""
Validate a skill directory against the Agent Skills standard.

Usage:
    python3 validate.py <path/to/skill-folder>

Checks:
    - SKILL.md exists (exact case)
    - YAML frontmatter present and valid
    - name: kebab-case, max 64 chars, matches folder name
    - description: present, max 1024 chars, no angle brackets, has triggers
    - Body size (warns if >500 lines)
    - No README.md in skill folder
    - Referenced files exist
"""

import sys
import re
from pathlib import Path

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


def parse_frontmatter(content):
    """Extract YAML frontmatter from markdown content."""
    if not content.startswith('---'):
        return None, "No YAML frontmatter found (must start with ---)"

    match = re.match(r'^---\r?\n(.*?)\r?\n---(?:\r?\n)?', content, re.DOTALL)
    if not match:
        return None, "Invalid frontmatter format (missing closing ---)"

    text = match.group(1)

    if HAS_YAML:
        try:
            data = yaml.safe_load(text)
            if not isinstance(data, dict):
                return None, "Frontmatter must be a YAML mapping"
            return data, None
        except yaml.YAMLError as e:
            return None, f"Invalid YAML: {e}"
    else:
        # Basic parsing without PyYAML
        data = {}
        current_key = None
        current_val = []

        for line in text.split('\n'):
            kv = re.match(r'^(\w[\w-]*):\s*(.*)', line)
            if kv:
                if current_key:
                    data[current_key] = ' '.join(current_val).strip()
                current_key = kv.group(1)
                current_val = [kv.group(2).strip().strip('>').strip()]
            elif current_key and line.startswith('  '):
                current_val.append(line.strip())

        if current_key:
            data[current_key] = ' '.join(current_val).strip()

        return data, None


def validate(skill_path):
    """Validate a skill directory. Returns (errors, warnings)."""
    errors = []
    warnings = []
    skill_path = Path(skill_path).resolve()

    # Check directory exists
    if not skill_path.is_dir():
        return [f"Not a directory: {skill_path}"], []

    # Check SKILL.md exists (exact case)
    skill_md = skill_path / 'SKILL.md'
    if not skill_md.exists():
        # Check for wrong case
        try:
            skill_path_children = list(skill_path.iterdir())
        except OSError as e:
            errors.append(f"Cannot read skill directory: {e}")
            return errors, warnings
        for f in skill_path_children:
            if f.name.lower() == 'skill.md' and f.name != 'SKILL.md':
                errors.append(f"Found '{f.name}' — must be exactly 'SKILL.md' (case-sensitive)")
                return errors, warnings
        errors.append("SKILL.md not found")
        return errors, warnings

    try:
        skill_md_text = skill_md.read_text()
    except (OSError, UnicodeDecodeError) as e:
        errors.append(f"Cannot read SKILL.md: {e}")
        return errors, warnings
    content = skill_md_text

    # Parse frontmatter
    fm, err = parse_frontmatter(content)
    if err:
        errors.append(err)
        return errors, warnings

    # Validate name
    ALLOWED_KEYS = {'name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'}
    unexpected = set(fm.keys()) - ALLOWED_KEYS
    if unexpected:
        warnings.append(f"Unexpected frontmatter keys: {', '.join(sorted(unexpected))}")

    name = fm.get('name', '')
    if not name:
        errors.append("Missing 'name' in frontmatter")
    elif not isinstance(name, str):
        errors.append(f"'name' must be a string, got {type(name).__name__}")
    else:
        name = name.strip()
        if not re.match(r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?$', name):
            errors.append(f"Name '{name}' must be kebab-case (lowercase, digits, hyphens, no leading/trailing hyphens)")
        if '--' in name:
            errors.append(f"Name '{name}' cannot contain consecutive hyphens")
        if len(name) > 64:
            errors.append(f"Name too long ({len(name)} chars, max 64)")
        if name != skill_path.name:
            warnings.append(f"Name '{name}' doesn't match folder name '{skill_path.name}'")
        if 'claude' in name or 'anthropic' in name:
            errors.append(f"Name cannot contain 'claude' or 'anthropic' (reserved)")

    # Validate description
    desc = fm.get('description', '')
    if not desc:
        errors.append("Missing 'description' in frontmatter")
    elif not isinstance(desc, str):
        errors.append(f"'description' must be a string, got {type(desc).__name__}")
    else:
        desc = desc.strip()
        if len(desc) > 1024:
            errors.append(f"Description too long ({len(desc)} chars, max 1024)")
        if '<' in desc or '>' in desc:
            errors.append("Description cannot contain angle brackets (< >)")
        if len(desc) < 20:
            warnings.append("Description very short — add trigger phrases and capabilities")

        # Check for trigger phrases
        trigger_words = ['use when', 'use for', 'trigger', 'when user', 'when asked',
                         'also trigger', 'use this when', 'use this skill']
        if not any(w in desc.lower() for w in trigger_words):
            warnings.append("Description may lack trigger phrases — add 'Use when...' for better activation")

    # Validate compatibility
    compat = fm.get('compatibility', '')
    if compat and isinstance(compat, str) and len(compat) > 500:
        errors.append(f"Compatibility too long ({len(compat)} chars, max 500)")

    # Check body size
    body_match = re.match(r'^---\r?\n.*?\r?\n---\r?\n?(.*)', content, re.DOTALL)
    if body_match:
        body = body_match.group(1)
        lines = body.strip().split('\n')
        if len(lines) > 500:
            warnings.append(f"Body is {len(lines)} lines (target: <500). Consider moving detail to references/")
        if len(lines) < 5:
            warnings.append("Body is very short — add workflow instructions")

    # Check for README.md (shouldn't exist in skill folder)
    readme = skill_path / 'README.md'
    if readme.exists():
        warnings.append("README.md found — skills shouldn't contain README. Move content to SKILL.md or references/")

    # Check for broken relative references in SKILL.md
    # Strip code blocks first so we don't flag illustrative examples
    content_no_code = re.sub(r'```.*?```', '', content, flags=re.DOTALL)
    content_no_code = re.sub(r'`[^`]+`', '', content_no_code)
    ref_pattern = re.findall(r'\[.*?\]\(((?:scripts|references|assets)/[^)]+)\)', content_no_code)
    for ref in ref_pattern:
        ref_path = skill_path / ref
        try:
            ref_path_resolved = ref_path.resolve()
            skill_path_resolved = skill_path.resolve()
            if not str(ref_path_resolved).startswith(str(skill_path_resolved)):
                errors.append(f"Path traversal detected in reference: '{ref}'")
                continue
            if not ref_path.exists():
                errors.append(f"Broken reference: '{ref}' (file not found)")
        except (OSError, RuntimeError):
            errors.append(f"Cannot resolve reference: '{ref}'")

    # Check for TODO markers
    if 'TODO' in content:
        warnings.append("SKILL.md contains TODO markers — fill them in before use")

    return errors, warnings


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 validate.py <skill-directory>")
        sys.exit(1)

    skill_path = sys.argv[1]
    errors, warnings = validate(skill_path)

    if errors:
        print(f"❌ INVALID — {len(errors)} error(s):\n")
        for e in errors:
            print(f"   🔴 {e}")
    else:
        print("✅ Valid skill!")

    if warnings:
        print(f"\n   {len(warnings)} warning(s):\n")
        for w in warnings:
            print(f"   🟡 {w}")

    if not errors and not warnings:
        print("   No warnings.")

    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
