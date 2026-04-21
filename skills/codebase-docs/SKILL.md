---
name: codebase-docs
description: >
  Generate and maintain AI-readable markdown documentation for a codebase in docs/.
  Use this skill whenever the user asks to document their codebase, generate project docs,
  create architecture docs, update documentation after code changes, build a knowledge base
  for AI agents, create onboarding docs, map out a codebase, or explain a project structure.
  Also trigger when users say things like "document this repo", "create docs for my project",
  "update the docs", "write architecture documentation", "help AI understand my code",
  "generate a codebase overview", or "maintain docs". This skill is specifically about
  creating structured markdown files in a docs/ directory that serve as a knowledge base —
  NOT about writing inline code comments, README files, or API reference docs from docstrings.
---

# Codebase Documentation Skill

Generate and maintain a structured set of markdown files in `docs/` that give AI agents (and humans) a fast, accurate understanding of a codebase without needing to search through source files.

## Philosophy

The docs you produce are a **map, not the territory**. They should let an AI agent answer questions like "where does authentication happen?", "how does data flow from API to database?", or "what are the key abstractions?" — without reading every file. Optimize for **navigability and accuracy** over exhaustiveness.

## When to Use This Skill

- User asks to document a codebase or project
- User wants to update existing docs after making changes
- User wants AI-friendly project documentation
- User mentions `docs/` directory maintenance
- User wants architecture or structural documentation

## Step 1: Assess the Codebase

Before writing anything, understand what you're documenting.

1. **Read the project root** — check for existing README, package.json/Cargo.toml/pyproject.toml, config files, and any existing `docs/` directory
2. **Map the directory structure** — identify source directories, test directories, config, scripts, assets
3. **Identify the tech stack** — languages, frameworks, key dependencies, build tools
4. **Find entry points** — main files, route definitions, CLI entry points, exported modules
5. **Detect patterns** — architecture style (MVC, microservices, monolith, plugin-based), state management, data layer

If a `docs/` directory already exists, read it first. You'll be updating, not starting from scratch.

## Step 2: Generate the Documentation Set

Create the `docs/` directory with the files described below. Not every project needs every file — use judgment. A small CLI tool doesn't need `data-model.md`, and a pure library doesn't need `deployment.md`.

Refer to `references/doc-templates.md` for the exact templates and structure for each file. Read that file before writing any documentation.

### Required Files (always generate)

| File | Purpose |
|------|---------|
| `docs/OVERVIEW.md` | Project purpose, tech stack, architecture style, key concepts. This is the **entry point** — an AI agent should read this first. |
| `docs/STRUCTURE.md` | Annotated directory tree showing what lives where and why. Maps directories to responsibilities. |
| `docs/ARCHITECTURE.md` | How components connect. Data flow, request lifecycle, key abstractions, dependency graph between modules. |

### Situational Files (generate when relevant)

| File | When to Include | Purpose |
|------|-----------------|---------|
| `docs/DATA_MODEL.md` | Project has a database, ORM, or significant data structures | Schema overview, entity relationships, key types/interfaces |
| `docs/API.md` | Project exposes or consumes APIs | Endpoints, request/response shapes, auth patterns |
| `docs/CONFIGURATION.md` | Non-trivial config (env vars, feature flags, multi-environment) | All configuration knobs, defaults, and where they're used |
| `docs/PATTERNS.md` | Project uses recurring patterns worth documenting | Design patterns, conventions, error handling strategy, logging approach |
| `docs/DEPLOYMENT.md` | Project has deployment infrastructure | Build process, environments, CI/CD, infrastructure overview |
| `docs/DEVELOPMENT.md` | Project has non-obvious dev setup or workflow | Local setup, testing strategy, debugging tips, contribution workflow |
| `docs/GLOSSARY.md` | Domain-specific or project-specific terminology | Term definitions that an AI agent needs to understand the codebase |

### Index File

Always generate `docs/INDEX.md` as the last file. This is a table of contents linking all other docs with one-line descriptions. An AI agent uses this to decide which file to read for a given question.

## Step 3: Writing Guidelines

Follow these principles for every file:

### Structure for Scannability
- Start each file with a 2-3 sentence summary of what it covers
- Use headers (##, ###) to create clear sections
- Keep paragraphs short — 2-4 sentences max
- Use code blocks for file paths, commands, and type signatures
- Use tables for structured comparisons or listings

### Write for AI Agents
- Be explicit about **relationships** — "Module A calls Module B's `process()` method when..."
- Include **file paths** — always reference actual paths like `src/auth/middleware.ts`
- Name **functions and classes** that are key entry points or interfaces
- Describe **data flow** with clear directionality — "User request → Router → Controller → Service → Repository → Database"
- State **assumptions and constraints** — "This service assumes a PostgreSQL connection is available"

### Keep It Maintainable
- Include a `Last updated` date at the top of each file
- Add a brief `## Changes Log` section at the bottom of each file with space for noting updates
- Reference specific file paths so staleness is detectable — if a referenced file moves, the docs are clearly wrong
- Prefer describing **intent and architecture** over implementation details that change frequently

### What NOT to Document
- Don't duplicate what's already in README.md — reference it instead
- Don't document every function — focus on public interfaces and key internal abstractions
- Don't copy-paste code — describe what it does and where to find it
- Don't document generated files or node_modules

## Step 4: Updating Existing Docs

When updating rather than creating from scratch:

1. Read all existing files in `docs/` first
2. Re-scan the codebase to detect changes since the docs were last updated
3. Update affected files only — don't rewrite everything
4. Update the `Last updated` date and add a note to the Changes Log
5. Update `docs/INDEX.md` if any files were added or removed
6. If a documented file has been deleted or moved, update or remove the reference

## Step 5: Validation

After generating or updating docs, do a quick sanity check:

1. Verify all file paths mentioned in docs actually exist
2. Confirm the directory tree in `STRUCTURE.md` matches reality
3. Ensure `INDEX.md` links to all docs that were created
4. Check that cross-references between doc files are correct

## Output

All files go in the `docs/` directory at the project root. Use the exact filenames specified above (UPPERCASE with .md extension). Present the full set to the user when done, summarizing what was created and any areas where the docs might need human review (e.g., business logic descriptions, architectural decisions that aren't obvious from code alone).
