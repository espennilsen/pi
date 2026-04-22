#!/usr/bin/env bash
# find_duplicates.sh — Scan a codebase for DRY violations
# Usage: bash find_duplicates.sh <target_directory> [file_extensions]
# Example: bash find_duplicates.sh ./src "ts,tsx,js,jsx"
# Example: bash find_duplicates.sh ./app "py"
#
# Outputs a structured report of potential duplication to stdout.

set -euo pipefail

TARGET_DIR="${1:-.}"
EXTENSIONS="${2:-}"
MIN_BLOCK_LINES=3
MIN_LINE_LENGTH=20

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: Directory '$TARGET_DIR' does not exist."
  exit 1
fi

# Build find command for file filtering
FIND_CMD="find \"$TARGET_DIR\" -type f"
if [ -n "$EXTENSIONS" ]; then
  IFS=',' read -ra EXTS <<< "$EXTENSIONS"
  FIND_CMD="$FIND_CMD \\(""
  for i in "${!EXTS[@]}"; do
    ext="${EXTS[$i]}"
    if [ "$i" -gt 0 ]; then
      FIND_CMD="$FIND_CMD -o"
    fi
    FIND_CMD="$FIND_CMD -name \"*.$ext\""
  done
  FIND_CMD="$FIND_CMD \\)"
fi

# Exclude common non-source directories
FIND_CMD="$FIND_CMD ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/vendor/*' ! -path '*/__pycache__/*' ! -path '*/dist/*' ! -path '*/build/*' ! -path '*/.next/*' ! -path '*/target/*'"

echo "========================================"
echo "  DRY VIOLATION SCANNER"
echo "========================================"
echo "Target:     $TARGET_DIR"
echo "Extensions: ${EXTENSIONS:-all}"
echo "Min block:  $MIN_BLOCK_LINES lines"
echo "----------------------------------------"
echo ""

# Collect all source files into an array
readarray -t file_array < <(eval "$FIND_CMD" 2>/dev/null | sort)
FILE_COUNT=${#file_array[@]}
TOTAL_LINES=0

if [ "$FILE_COUNT" -eq 0 ]; then
  echo "No matching files found."
  exit 0
fi

for f in "${file_array[@]}"; do
  lines=$(wc -l < "$f")
  TOTAL_LINES=$((TOTAL_LINES + lines))
done

echo "Files found: $FILE_COUNT"
echo "Total lines: $TOTAL_LINES"
echo ""

# ── Section 1: Repeated Lines ──────────────────────────────
echo "========================================"
echo "  1. REPEATED LINES (3+ occurrences)"
echo "========================================"
echo ""

# Find non-trivial lines that appear 3+ times across the codebase
temp_all_lines=$(mktemp)
for f in "${file_array[@]}"; do
  # Strip leading/trailing whitespace, skip short/trivial lines
  # Keep original line numbers by doing it inline
  awk -v file="$f" -v minlen="$MIN_LINE_LENGTH" '
    {
      trimmed = $0
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", trimmed)
      if (length(trimmed) >= minlen && trimmed !~ /^[{}()\[\];,]$/ && trimmed !~ /^(import |from |#include|using |require)/ && trimmed !~ /^\/\// && trimmed !~ /^#/ && trimmed !~ /^\*/) {
        print trimmed "\t" file ":" NR
      }
    }
  ' "$f" >> "$temp_all_lines"
done

# Count and show repeated lines
if [ -s "$temp_all_lines" ]; then
  cut -f1 "$temp_all_lines" | sort | uniq -c | sort -rn | head -30 | while read -r count line; do
    if [ "$count" -ge 3 ]; then
      echo "  [$count occurrences] $line"
      awk -F'\t' -v pattern="$line" '$1 == pattern {print $2}' "$temp_all_lines" | head -5 | sed 's/^/    → /'
      remaining=$((count - 5))
      if [ "$remaining" -gt 0 ]; then
        echo "    → ... and $remaining more"
      fi
      echo ""
    fi
  done
fi
rm -f "$temp_all_lines"

# ── Section 2: Magic Numbers & Repeated Literals ──────────
echo "========================================"
echo "  2. MAGIC NUMBERS & REPEATED LITERALS"
echo "========================================"
echo ""

temp_literals=$(mktemp)
for f in "${file_array[@]}"; do
  # Find repeated string literals (quoted strings)
  grep -noE '"[^"]{4,}"' "$f" 2>/dev/null | \
    awk -F: -v file="$f" '{ print $2 "\t" file ":" $1 }' >> "$temp_literals" || true
  grep -noE "'[^']{4,}'" "$f" 2>/dev/null | \
    awk -F: -v file="$f" '{ print $2 "\t" file ":" $1 }' >> "$temp_literals" || true
  # Find magic numbers (numeric literals not 0 or 1)
  grep -noE '\b[0-9]{2,}\b' "$f" 2>/dev/null | \
    awk -F: -v file="$f" '{ print "NUM:" $2 "\t" file ":" $1 }' >> "$temp_literals" || true
done

if [ -s "$temp_literals" ]; then
  cut -f1 "$temp_literals" | sort | uniq -c | sort -rn | head -20 | while read -r count literal; do
    if [ "$count" -ge 3 ]; then
      echo "  [$count times] $literal"
      awk -F'\t' -v pattern="$literal" '$1 == pattern {print $2}' "$temp_literals" | head -3 | sed 's/^/    → /'
      echo ""
    fi
  done
fi
rm -f "$temp_literals"

# ── Section 3: Similar Function Signatures ────────────────
echo "========================================"
echo "  3. SIMILAR FUNCTION SIGNATURES"
echo "========================================"
echo ""

temp_funcs=$(mktemp)
for f in "${file_array[@]}"; do
  # Match common function/method declarations across languages
  # Exclude control flow keywords to reduce false positives
  grep -nE '^\s*(export\s+)?(async\s+)?function\s+\w+|^\s*(public|private|protected|static|async)?\s*(def |fn |func |void |int |string |bool )?\w+\s*\(' "$f" 2>/dev/null | \
    grep -vE '\b(if|while|for|switch|return|catch)\s*\(' | \
    awk -F: -v file="$f" '{ print $2 "\t" file ":" $1 }' >> "$temp_funcs" || true
done

if [ -s "$temp_funcs" ]; then
  # Normalize function names to find similar patterns
  cut -f1 "$temp_funcs" | sed 's/[[:space:]]*//g' | sort | uniq -c | sort -rn | head -15 | while read -r count sig; do
    if [ "$count" -ge 2 ]; then
      echo "  [$count matches] $sig"
      awk -F'\t' -v pattern="$sig" '{gsub(/[[:space:]]/,"",$1); if ($1 == pattern) print $2}' "$temp_funcs" 2>/dev/null | head -5 | sed 's/^/    → /' || true
      echo ""
    fi
  done
fi
rm -f "$temp_funcs"

# ── Section 4: Duplicate File Similarity ──────────────────
echo "========================================"
echo "  4. HIGHLY SIMILAR FILES"
echo "========================================"
echo ""

file_count=${#file_array[@]}
if [ "$file_count" -le 100 ]; then
  found_similar=false
  for ((i=0; i<file_count; i++)); do
    for ((j=i+1; j<file_count; j++)); do
      f1="${file_array[$i]}"
      f2="${file_array[$j]}"
      lines1=$(wc -l < "$f1")
      lines2=$(wc -l < "$f2")
      # Only compare files of similar size (within 50%)
      if [ "$lines1" -gt 5 ] && [ "$lines2" -gt 5 ]; then
        ratio=$((lines1 > lines2 ? lines1 * 100 / lines2 : lines2 * 100 / lines1))
        if [ "$ratio" -lt 200 ]; then
          common=$(comm -12 <(sort "$f1") <(sort "$f2") | wc -l)
          max_lines=$((lines1 > lines2 ? lines1 : lines2))
          if [ "$max_lines" -gt 0 ]; then
            similarity=$((common * 100 / max_lines))
            if [ "$similarity" -ge 60 ]; then
              echo "  ${similarity}% similar: $f1 ($lines1 lines) ↔ $f2 ($lines2 lines)"
              found_similar=true
            fi
          fi
        fi
      fi
    done
  done
  if [ "$found_similar" = false ]; then
    echo "  No highly similar file pairs found."
  fi
else
  echo "  Skipped (>100 files — use manual analysis for large codebases)"
fi

echo ""
echo "========================================"
echo "  SCAN COMPLETE"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Review findings above for real DRY violations"
echo "  2. Filter out false positives (imports, boilerplate, etc.)"
echo "  3. Perform manual analysis on flagged areas"
echo "  4. Document findings in the plan file"
