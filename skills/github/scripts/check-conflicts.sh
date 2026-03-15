#!/usr/bin/env bash
# Check for remaining merge conflict markers in tracked files.
#
# Usage: bash scripts/check-conflicts.sh [path...]
#
# With no args, checks all tracked files in the repo (excluding node_modules).
# With paths, checks only those files/directories.
#
# Exit code: 0 = clean, 1 = conflicts found
set -euo pipefail

if [ $# -gt 0 ]; then
  targets=("$@")
else
  # All tracked files, excluding node_modules (bash 3.2-compatible)
  targets=()
  while IFS= read -r f; do targets+=("$f"); done < <(git ls-files | grep -v node_modules)
fi

if [ ${#targets[@]} -eq 0 ]; then
  echo "✅ No files to check."
  exit 0
fi

# Search for conflict markers (must be at start of line)
matches=$(grep -Ern "^<<<<<<< |^=======$|^>>>>>>> " -- "${targets[@]}" 2>/dev/null || true)

if [ -z "$matches" ]; then
  echo "✅ No conflict markers found."
  exit 0
else
  count=$(echo "$matches" | wc -l | tr -d ' ')
  echo "❌ Found ${count} conflict marker(s):"
  echo ""
  echo "$matches"
  exit 1
fi
