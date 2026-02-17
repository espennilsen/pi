---
name: npmjs
description: >
  npm package maintenance and lifecycle management for monorepo extensions.
  Covers health audits, dependency sync, version bumping, changelog updates,
  pre-publish checks, coordinated publishing, and post-publish verification.

  **Triggers — use this skill when:**
  - User asks to "publish", "release", or "version bump" extensions/packages
  - User says "audit packages", "check package health", "dependency sync"
  - User asks to "update changelogs", "prepare release", "pre-publish check"
  - User mentions "npm publish", "version management", "package lifecycle"
  - User wants to "sync dependencies" or "align versions" across packages
  - User asks "what needs publishing" or "which packages changed"

  **Covers:** Monorepo with multiple npm packages under `extensions/`.
  Each package has its own package.json, CHANGELOG.md, README.md, and version.
  Packages are scoped (e.g. `@e9n/pi-*`) and published individually.
---

# npmjs — Package Maintenance & Lifecycle Management

Manage npm packages in a monorepo: audit health, sync dependencies, bump versions,
update changelogs, run pre-publish checks, and coordinate publishing.

---

## Commands Reference

### Health & Audit

```bash
# List all extension packages with versions and private status
for ext in extensions/pi-*/; do
  name=$(basename "$ext")
  pkg=$(cat "$ext/package.json")
  version=$(echo "$pkg" | jq -r '.version')
  private=$(echo "$pkg" | jq -r '.private // false')
  echo "$name@$version (private: $private)"
done

# Check what's published vs local
for ext in extensions/pi-*/; do
  local_name=$(cat "$ext/package.json" | jq -r '.name')
  local_ver=$(cat "$ext/package.json" | jq -r '.version')
  private=$(cat "$ext/package.json" | jq -r '.private // false')
  [ "$private" = "true" ] && continue
  remote_ver=$(npm view "$local_name" version 2>/dev/null || echo "not published")
  status="✅"
  [ "$local_ver" != "$remote_ver" ] && status="⚠️  local=$local_ver npm=$remote_ver"
  echo "$local_name $status"
done

# Full dependency audit
for ext in extensions/pi-*/; do
  name=$(basename "$ext")
  # Check for missing imports (imported but not declared)
  imports=$(grep -rh "from ['\"]@" "$ext/src/" 2>/dev/null | sed "s/.*from ['\"]//;s/['\"].*//" | grep "^@" | sort -u)
  for imp in $imports; do
    in_deps=$(cat "$ext/package.json" | jq -r --arg p "$imp" '(.dependencies // {})[$p] // (.peerDependencies // {})[$p] // empty')
    [ -z "$in_deps" ] && echo "MISSING: $name imports $imp"
  done
  # Check for unused deps (declared but not imported)
  deps=$(cat "$ext/package.json" | jq -r '.dependencies // {} | keys[]' 2>/dev/null)
  for dep in $deps; do
    grep -rq "from ['\"]$dep\|require(['\"]$dep\|import(['\"]$dep" "$ext/src/" 2>/dev/null || \
      echo "UNUSED: $name has $dep in dependencies"
  done
done

# Check for phantom peer deps
for ext in extensions/pi-*/; do
  name=$(basename "$ext")
  peers=$(cat "$ext/package.json" | jq -r '.peerDependencies // {} | keys[]' 2>/dev/null)
  for peer in $peers; do
    grep -rq "from ['\"]$peer" "$ext/src/" 2>/dev/null || \
      echo "PHANTOM PEER: $name declares $peer but never imports it"
  done
done

# Shared dependency version consistency
echo "=== Dependency Version Report ==="
for ext in extensions/pi-*/; do
  cat "$ext/package.json" | jq -r --arg ext "$(basename "$ext")" \
    '.dependencies // {} | to_entries[] | "\(.key) \(.value) \($ext)"'
done | sort | awk '{
  key=$1; ver=$2; ext=$3
  if (key != prev) { if (prev && count > 1 && versions > 1) print ""; prev=key; count=0; versions=0; delete seen }
  if (!seen[ver]) { seen[ver]=1; versions++ }
  count++
  print "  " ext ": " key "@" ver
}'
```

### Detecting Changed Packages

```bash
# Find extensions with changes since last publish (compare to npm registry)
for ext in extensions/pi-*/; do
  name=$(cat "$ext/package.json" | jq -r '.name')
  private=$(cat "$ext/package.json" | jq -r '.private // false')
  [ "$private" = "true" ] && continue
  version=$(cat "$ext/package.json" | jq -r '.version')
  # Check git diff since last tag or version bump
  last_tag=$(git tag -l "${name}@*" --sort=-creatordate | head -1)
  if [ -z "$last_tag" ]; then
    echo "NEW: $name@$version (never tagged)"
  else
    changes=$(git diff --name-only "$last_tag" -- "$ext" 2>/dev/null | grep -v 'CHANGELOG\|README\|AGENTS' | head -5)
    [ -n "$changes" ] && echo "CHANGED: $name ($last_tag → now)" && echo "$changes" | sed 's/^/  /'
  fi
done

# Simpler: find extensions with uncommitted or recent source changes
for ext in extensions/pi-*/; do
  name=$(basename "$ext")
  # Check for source changes in last N commits
  changes=$(git log --oneline -10 -- "$ext/src/" | head -5)
  [ -n "$changes" ] && echo "$name:" && echo "$changes" | sed 's/^/  /'
done
```

---

## Lifecycle Operations

### 1. Pre-publish Checks

Run these before every publish. All must pass.

```bash
EXTENSION="pi-example"  # Set target

# 1. TypeScript check
cd "extensions/$EXTENSION" && npx tsc --noEmit

# 2. Required files exist
for f in README.md CHANGELOG.md package.json .npmignore; do
  [ -f "extensions/$EXTENSION/$f" ] || echo "MISSING: $f"
done

# 3. Package.json has required fields
cat "extensions/$EXTENSION/package.json" | jq '{
  name: .name,
  version: .version,
  description: .description,
  license: .license,
  author: .author,
  keywords: .keywords,
  files: .files,
  repository: .repository,
  pi: .pi
}' | jq 'to_entries[] | select(.value == null or .value == "") | "MISSING: \(.key)"' -r

# 4. Verify tarball contents (dry run)
cd "extensions/$EXTENSION" && npm pack --dry-run

# 5. No AGENTS.md in tarball (should be in .npmignore)
grep -q "AGENTS.md" "extensions/$EXTENSION/.npmignore" || echo "WARNING: AGENTS.md not in .npmignore"
```

**Batch pre-publish check for all packages:**

```bash
failed=0
for ext in extensions/pi-*/; do
  name=$(basename "$ext")
  private=$(cat "$ext/package.json" | jq -r '.private // false')
  [ "$private" = "true" ] && continue
  echo -n "$name... "
  # Typecheck
  if ! (cd "$ext" && npx tsc --noEmit 2>&1) > /dev/null; then
    echo "❌ typecheck failed"
    failed=$((failed + 1))
    continue
  fi
  # Required fields
  missing=$(cat "$ext/package.json" | jq -r '[
    (if .name == null then "name" else empty end),
    (if .version == null then "version" else empty end),
    (if .description == null then "description" else empty end),
    (if .license == null then "license" else empty end),
    (if .author == null then "author" else empty end),
    (if .files == null then "files" else empty end)
  ] | join(", ")')
  if [ -n "$missing" ]; then
    echo "❌ missing: $missing"
    failed=$((failed + 1))
    continue
  fi
  echo "✅"
done
echo "---"
echo "$failed package(s) with issues"
```

### 2. Version Bumping

#### Single Package

```bash
EXTENSION="pi-example"
BUMP="patch"  # patch | minor | major

cd "extensions/$EXTENSION"
# npm version updates package.json and creates a git tag
npm version $BUMP --no-git-tag-version
# Read new version
new_ver=$(cat package.json | jq -r '.version')
echo "Bumped to $new_ver"
```

#### Bulk Version Bump

```bash
BUMP="patch"  # Same bump for all

for ext in extensions/pi-*/; do
  name=$(basename "$ext")
  private=$(cat "$ext/package.json" | jq -r '.private // false')
  [ "$private" = "true" ] && continue
  old_ver=$(cat "$ext/package.json" | jq -r '.version')
  cd "$ext" && npm version $BUMP --no-git-tag-version && cd - > /dev/null
  new_ver=$(cat "$ext/package.json" | jq -r '.version')
  echo "$name: $old_ver → $new_ver"
done
```

#### Selective Bump (only changed packages)

Identify which packages have source changes since their last publish, then bump only those.
Use the "Detecting Changed Packages" commands above first.

### 3. Changelog Updates

Before publishing, update CHANGELOG.md for each package being released.

#### Per-Package Changelog

```bash
EXTENSION="pi-example"
NEW_VERSION="0.2.0"
DATE=$(date +%Y-%m-%d)

# Get commits since last version entry in CHANGELOG
last_ver=$(grep -m1 '## \[' "extensions/$EXTENSION/CHANGELOG.md" | sed 's/## \[\(.*\)\].*/\1/')
# Get relevant commits
git log --oneline -- "extensions/$EXTENSION/src/" | head -20
```

Then manually write a changelog entry following Keep a Changelog format.
Insert after the `## [Unreleased]` or first `## [` line:

```markdown
## [0.2.0] - 2026-02-17

### Added
- Description of new features

### Changed
- Description of changes

### Fixed
- Description of bug fixes
```

**Rules:**
- Imperative mood: "Add", "Fix", "Remove" — not past tense
- User-facing changes only — skip CI, refactors, typos
- Be specific: "Fix crash when saving empty file" not "Fix save bug"
- Link PRs/issues where applicable: `(#42)`
- Mark breaking changes: `**BREAKING:** Remove deprecated endpoint`

### 4. Publishing

#### Single Package

```bash
EXTENSION="pi-example"
cd "extensions/$EXTENSION" && npm publish --access public
```

#### Bulk Publish

```bash
# Publish all non-private packages
for ext in extensions/pi-*/; do
  name=$(basename "$ext")
  private=$(cat "$ext/package.json" | jq -r '.private // false')
  [ "$private" = "true" ] && echo "⏭️  $name (private)" && continue
  echo -n "📦 $name... "
  result=$(cd "$ext" && npm publish --access public 2>&1)
  if echo "$result" | grep -q "^\+"; then
    echo "✅"
  else
    echo "❌"
    echo "$result" | grep "npm error" | head -3
  fi
done
```

#### Publish Only Changed Packages

```bash
for ext in extensions/pi-*/; do
  name=$(cat "$ext/package.json" | jq -r '.name')
  local_ver=$(cat "$ext/package.json" | jq -r '.version')
  private=$(cat "$ext/package.json" | jq -r '.private // false')
  [ "$private" = "true" ] && continue
  remote_ver=$(npm view "$name" version 2>/dev/null || echo "none")
  if [ "$local_ver" != "$remote_ver" ]; then
    echo -n "📦 $name@$local_ver (was $remote_ver)... "
    result=$(cd "$ext" && npm publish --access public 2>&1)
    echo "$result" | grep -q "^\+" && echo "✅" || echo "❌"
  fi
done
```

#### OTP Handling

If npm requires OTP, add `--otp=<code>` to publish commands.
For bulk publish with OTP, the token is time-based (30s window) — publish quickly or use automation tokens.

### 5. Post-publish Verification

```bash
# Verify all packages are published with correct versions
for ext in extensions/pi-*/; do
  name=$(cat "$ext/package.json" | jq -r '.name')
  local_ver=$(cat "$ext/package.json" | jq -r '.version')
  private=$(cat "$ext/package.json" | jq -r '.private // false')
  [ "$private" = "true" ] && continue
  remote_ver=$(npm view "$name" version 2>/dev/null || echo "NOT FOUND")
  if [ "$local_ver" = "$remote_ver" ]; then
    echo "✅ $name@$remote_ver"
  else
    echo "❌ $name local=$local_ver npm=$remote_ver"
  fi
done

# Verify tarball contents for a specific package
npm view @e9n/pi-example --json | jq '{version, dist, files: .dist.fileCount}'

# Test install in a temp dir
tmpdir=$(mktemp -d)
cd "$tmpdir" && npm init -y && npm install @e9n/pi-example && ls node_modules/@e9n/pi-example/
rm -rf "$tmpdir"
```

### 6. Git Tagging

After publishing, tag the release in git:

```bash
# Tag individual package releases
EXTENSION="pi-example"
VERSION=$(cat "extensions/$EXTENSION/package.json" | jq -r '.version')
NAME=$(cat "extensions/$EXTENSION/package.json" | jq -r '.name')
git tag "${NAME}@${VERSION}"
git push origin "${NAME}@${VERSION}"

# Bulk tag all packages at current versions
for ext in extensions/pi-*/; do
  name=$(cat "$ext/package.json" | jq -r '.name')
  version=$(cat "$ext/package.json" | jq -r '.version')
  private=$(cat "$ext/package.json" | jq -r '.private // false')
  [ "$private" = "true" ] && continue
  tag="${name}@${version}"
  if ! git tag -l "$tag" | grep -q .; then
    git tag "$tag"
    echo "Tagged $tag"
  fi
done
git push origin --tags
```

### 7. Dependency Sync

Align shared dependency versions across all packages.

```bash
# Find all shared dependencies and their version ranges
echo "=== Shared Dependency Versions ==="
for ext in extensions/pi-*/; do
  cat "$ext/package.json" | jq -r --arg ext "$(basename "$ext")" \
    '.dependencies // {} | to_entries[] | "\(.key)|\(.value)|\($ext)"'
done | sort -t'|' -k1,1 | awk -F'|' '
{
  if ($1 != prev) {
    if (NR > 1 && count > 1) print ""
    prev = $1; count = 0; delete vers
  }
  count++
  vers[$2] = vers[$2] ? vers[$2] ", " $3 : $3
}
END {
  # Use the commands output to identify mismatches
}
'

# To update a specific dependency across all extensions:
DEP="better-sqlite3"
NEW_VERSION="^12.6.2"
for ext in extensions/pi-*/; do
  has_dep=$(cat "$ext/package.json" | jq -r --arg d "$DEP" '.dependencies[$d] // empty')
  if [ -n "$has_dep" ]; then
    cat "$ext/package.json" | jq --arg d "$DEP" --arg v "$NEW_VERSION" \
      '.dependencies[$d] = $v' > "$ext/package.json.tmp" && mv "$ext/package.json.tmp" "$ext/package.json"
    echo "Updated $(basename $ext): $DEP → $NEW_VERSION"
  fi
done
```

---

## Full Release Workflow

When doing a release, follow these steps in order:

1. **Audit** — Run health checks, verify deps, identify changed packages
2. **Bump** — Version bump changed packages (patch/minor/major as appropriate)
3. **Changelog** — Update CHANGELOG.md for each bumped package
4. **Check** — Run batch pre-publish checks (typecheck, required fields, tarball)
5. **Commit** — `git add -A && git commit -m "release: bump <packages>"`
6. **Publish** — Bulk publish changed packages
7. **Verify** — Post-publish version check
8. **Tag** — Git tag each published version
9. **Push** — `git push origin <branch> --tags`

---

## Conventions

- **Scope:** All packages under `@e9n/` npm scope
- **Versioning:** SemVer — patch for fixes, minor for features, major for breaking
- **Private packages:** Have `"private": true` in package.json, skipped by all publish commands
- **Changelogs:** Keep a Changelog format, ISO 8601 dates
- **Tags:** `@e9n/pi-example@1.2.3` format
- **Tarballs:** Should contain `src/`, `package.json`, `README.md`, `CHANGELOG.md` plus any extra content (skills/, prompts/, HTML files). Never `AGENTS.md`, `node_modules/`, `tsconfig.json`.
- **Peer deps:** Pi core packages (`@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, `@sinclair/typebox`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-tui`) always in `peerDependencies` with `"*"` range
