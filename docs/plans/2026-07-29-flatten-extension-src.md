# Flatten Extension Source Directories Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Move every `extensions/*/src/` tree into its extension root without changing runtime behavior.

**Architecture:** This is a mechanical repository-layout migration. Preserve every relative path below `src`, move its contents to the extension root, and rewrite only references that explicitly include `src/` in manifests, TypeScript configuration, documentation, or source imports. Then validate that no tracked extension source directory remains and typecheck each extension that declares a typecheck script.

**Tech Stack:** TypeScript, npm, package manifests, TypeScript compiler.

---

### Task 1: Establish the migration baseline

**Files:**
- Inspect: `extensions/*/src/**`
- Inspect: `extensions/*/{package.json,tsconfig.json}`

**Step 1:** Create an isolated worktree on `chore/flatten-extension-src`.

**Step 2:** Detect destination path collisions before moving files.

**Step 3:** Capture all explicit `src/` references for post-migration verification.

### Task 2: Flatten source trees

**Files:**
- Move: `extensions/*/src/**` → `extensions/*/**`
- Modify: `extensions/*/{package.json,tsconfig.json}` where paths reference `src/`
- Modify: repository files with references to moved extension paths, if any

**Step 1:** Move each source tree’s immediate contents into its parent extension directory, preserving nested paths.

**Step 2:** Remove empty `src/` directories.

**Step 3:** Rewrite explicit path references from `src/...` to their corresponding root-relative paths.

### Task 3: Validate the layout

**Files:**
- Inspect: `extensions/*`

**Step 1:** Verify no `extensions/*/src/` directories or tracked files remain.

**Step 2:** Run each affected extension’s `typecheck` script when present.

**Step 3:** Run package-level tests when available and practical; report existing failures separately.

### Task 4: Deliver

**Step 1:** Review the diff for unintended content changes.

**Step 2:** Commit the mechanical migration.

**Step 3:** Push `chore/flatten-extension-src` and create one PR.
