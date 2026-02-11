---
name: readme-reviewer
description: >
  Review a codebase and generate or update its README.md according to best practices.
  The skill performs static analysis of the project structure, dependencies, scripts,
  and existing documentation, then produces a comprehensive, accurate README.

  **Triggers — use this skill when:**
  - User asks to "review", "update", "improve", or "generate" a README
  - User says "create a README for this project"
  - User mentions "document this repo", "add documentation"
  - User asks to "fix my README" or "make my README better"
  - User provides a codebase and asks for documentation help

  **Covers:** Any project type — Node.js, Python, Rust, Go, Java, Ruby, PHP,
  monorepos, static sites, CLI tools, libraries, APIs, Docker-based projects,
  and more. Works with both new READMEs (from scratch) and existing ones (update/improve).
---

# README Reviewer & Generator

Analyze a codebase and produce a high-quality README.md that follows industry best practices.

## Philosophy

A README is the front door to a project. It should answer five questions in under 60 seconds:

1. **What** does this project do?
2. **Why** does it exist (and why should I care)?
3. **How** do I get it running?
4. **How** do I use it?
5. **How** can I contribute or get help?

Everything else is secondary. The skill prioritizes accuracy over boilerplate — every claim in the README must be verifiable from the codebase.

---

## Workflow

### Phase 1 — Deep Scan

Before writing a single line of the README, gather facts. Do NOT hallucinate features or commands. Every statement must come from the codebase.

```bash
# 1. Project structure overview
find . -maxdepth 3 -type f | head -80
ls -la

# 2. Package manifest & dependencies
cat package.json 2>/dev/null        # Node.js
cat Cargo.toml 2>/dev/null          # Rust
cat pyproject.toml setup.py setup.cfg requirements.txt 2>/dev/null  # Python
cat go.mod 2>/dev/null              # Go
cat Gemfile 2>/dev/null             # Ruby
cat composer.json 2>/dev/null       # PHP
cat pom.xml build.gradle 2>/dev/null  # Java/Kotlin

# 3. Available scripts & entry points
# Node: extract "scripts" from package.json
# Python: look for __main__.py, cli.py, manage.py, app.py
# Rust/Go: look for main.rs / main.go

# 4. Config files that reveal tooling
ls .github/workflows/ 2>/dev/null   # CI/CD
cat Dockerfile docker-compose.yml 2>/dev/null  # Docker
cat .env.example .env.sample 2>/dev/null       # Environment vars
cat Makefile 2>/dev/null            # Make targets
cat tsconfig.json 2>/dev/null       # TypeScript config
cat .eslintrc* .prettierrc* 2>/dev/null  # Linting

# 5. Existing documentation
cat README.md 2>/dev/null
cat CONTRIBUTING.md 2>/dev/null
cat LICENSE* 2>/dev/null
cat CHANGELOG.md 2>/dev/null
ls docs/ 2>/dev/null

# 6. Tests
ls tests/ test/ __tests__/ spec/ 2>/dev/null
grep -r "test" package.json 2>/dev/null | head -5

# 7. Git info (if available)
git remote -v 2>/dev/null
git log --oneline -5 2>/dev/null
```

**Extract from the scan:**

| Fact | Source |
|------|--------|
| Project name | Directory name, package manifest `name` field |
| One-line description | Manifest `description`, or infer from code |
| Language & runtime | File extensions, manifest, lock files |
| Framework / major deps | Manifest dependencies |
| Install command | Manifest scripts, Makefile, Dockerfile |
| Run / start command | `scripts.start`, `scripts.dev`, entry point |
| Test command | `scripts.test`, pytest, cargo test, etc. |
| Build command | `scripts.build`, Makefile, Dockerfile |
| Environment variables | `.env.example`, config files, code references |
| CI/CD | `.github/workflows/`, `.gitlab-ci.yml`, etc. |
| License | `LICENSE` file, manifest `license` field |
| Existing docs quality | Current README completeness and accuracy |

### Phase 2 — Assess (if updating existing README)

If a README already exists, evaluate it against the quality checklist (see below). Identify:

- **Missing sections** — required sections that don't exist
- **Stale information** — commands or versions that don't match the current codebase
- **Inaccurate claims** — features described that don't exist in code
- **Poor structure** — walls of text, missing headers, broken links
- **Missing quick-start** — no way for a newcomer to get running fast

Present findings to the user as a brief assessment before rewriting.

### Phase 3 — Write / Rewrite

Generate the README using the structure below. Adapt sections to the project type — not every project needs every section. A 50-line CLI tool doesn't need an architecture diagram.

---

## README Structure (Canonical Order)

Use this as the reference structure. Include sections that apply; skip those that don't.

### 1. Title & Badges (required)
```markdown
# Project Name

[![License](badge-url)](license-url)
[![CI](badge-url)](ci-url)
[![Version](badge-url)](package-url)
```

- Project name as H1 — must match the repo/package name
- Badges: only include badges that are real and resolve (CI status, version, license, coverage)
- Do NOT invent badge URLs. Only add badges if you can determine the actual URLs from the CI config, package registry, etc.

### 2. One-liner / Tagline (required)
A single sentence (or short paragraph) explaining what this project does in plain language. No jargon. A non-technical person should understand the gist.

### 3. Key Features (if applicable)
A short bullet list (3–7 items) of what makes this project useful or unique. Only list features that actually exist in the codebase.

### 4. Quick Start (required for apps/tools)
The fastest path from zero to working. Should be copy-pasteable.

```markdown
## Quick Start

\```bash
git clone <repo-url>
cd <project>
npm install
npm run dev
\```
```

- Use the actual commands from the project (verify they exist in package.json / Makefile / etc.)
- Include prerequisite versions if they matter (e.g., "Requires Node.js >= 18")
- If env vars are needed, show how to set them up

### 5. Installation (required)
Detailed installation instructions. May overlap with Quick Start for simple projects.

- System prerequisites (runtime versions, OS requirements, external services)
- Package manager install command (npm, pip, cargo, etc.)
- Building from source (if applicable)
- Docker-based setup (if Dockerfile exists)

### 6. Usage (required)
How to actually use the project after installation.

- **CLI tools**: show 2–3 common command examples with expected output
- **Libraries/packages**: show import + basic usage code snippet
- **APIs**: show a sample request/response
- **Web apps**: describe how to access (URL, default credentials if any)

### 7. Configuration (if applicable)
Document all configuration options:

- Environment variables (table format: name, description, default, required?)
- Config files and their format
- Command-line flags

If an `.env.example` exists, reference it and explain each variable.

```markdown
| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | — | Yes |
| `PORT` | Server port | `3000` | No |
```

### 8. Project Structure (if applicable)
A simplified directory tree showing the most important files/folders. Useful for medium-to-large projects. Keep it under 20 lines.

```markdown
## Project Structure

\```
├── src/
│   ├── index.ts        # Entry point
│   ├── routes/         # API route handlers
│   └── models/         # Database models
├── tests/              # Test suite
├── docker-compose.yml  # Local development stack
└── package.json
\```
```

### 9. API Reference / Documentation (if applicable)
- For libraries: link to full API docs or include a summary of main exports
- For APIs: link to OpenAPI/Swagger docs or list key endpoints
- For complex projects: link to a `docs/` folder or external site

### 10. Development (recommended)
How to contribute as a developer:

- How to run in development mode
- How to run tests
- How to lint / format
- How to build for production
- Branch/PR conventions (if described in CONTRIBUTING.md, link to it)

### 11. Deployment (if applicable)
- How to deploy (platform-specific instructions if CI/CD configs exist)
- Docker deployment
- Environment-specific notes

### 12. Tech Stack (optional)
A brief list of the main technologies used. Useful for larger projects.

### 13. Roadmap (optional)
Link to issues/milestones or list planned features. Only if the project actively maintains one.

### 14. Contributing (recommended)
- Link to CONTRIBUTING.md if it exists
- Or a brief "PRs welcome" with basic guidelines
- How to report bugs

### 15. License (required if LICENSE file exists)
State the license and link to the LICENSE file.

```markdown
## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
```

### 16. Acknowledgments / Credits (optional)
Credit major dependencies, inspiration, or contributors.

---

## Quality Checklist

After writing the README, verify every item:

### Accuracy
- [ ] Every command shown actually works (exists in scripts/Makefile/etc.)
- [ ] Version requirements match what's in the codebase
- [ ] Features listed actually exist in the code
- [ ] Environment variables match `.env.example` or code references
- [ ] License matches the actual LICENSE file
- [ ] No placeholder text remains (no "TODO", "lorem ipsum", "[your-name]")

### Completeness
- [ ] A newcomer can go from zero to running in under 5 minutes with only the README
- [ ] All prerequisites are listed
- [ ] Both install AND usage are covered
- [ ] If Docker is available, Docker instructions are included

### Style
- [ ] Title is H1, sections are H2, subsections are H3 (consistent hierarchy)
- [ ] Code blocks specify the language (```bash, ```python, etc.)
- [ ] No walls of text — paragraphs are short, lists are used for scanability
- [ ] Links work (relative links to files in the repo use correct paths)
- [ ] Consistent formatting (backticks for inline code, bold for emphasis)
- [ ] No emojis in section headers (keep it professional unless the project's style uses them)

### Tone
- [ ] Written for the reader, not the author
- [ ] Concise — no filler phrases ("In order to", "Please note that")
- [ ] Technical but approachable
- [ ] Active voice preferred

---

## Project Type Adaptations

Not all READMEs are equal. Adapt based on what the project is:

### Library / Package
- Emphasize: Installation via package manager, API usage examples, TypeDoc/Sphinx links
- De-emphasize: Deployment, project structure

### CLI Tool
- Emphasize: Installation, command examples with output, flags/options table
- De-emphasize: API reference, project structure

### Web Application
- Emphasize: Quick start with Docker, environment setup, screenshots/demo link
- De-emphasize: API usage examples (unless it's also an API)

### API Service
- Emphasize: Authentication, endpoint documentation, request/response examples
- De-emphasize: UI screenshots

### Monorepo
- Emphasize: Project structure, per-package summaries with links, shared tooling
- De-emphasize: Single install command (may need per-package)

---

## Anti-Patterns to Avoid

These are common README mistakes. Never do these:

1. **Invented commands** — Never write `npm run deploy` if it doesn't exist in package.json
2. **Aspirational features** — Only document what exists, not what's planned
3. **Giant tables of contents** — Only add a TOC if the README exceeds ~200 lines
4. **Badge overload** — Max 5-6 badges. Only include ones that are real and useful
5. **Undated screenshots** — Screenshots get stale. Mention the version they depict
6. **Copy-paste from other projects** — Every sentence must be specific to THIS project
7. **"This project is a..." openers** — Start with what it does, not what it is
8. **Placeholder sections** — Never leave a section that says "Coming soon" or "TBD"

---

## Output Format

The final output should be:

1. **Assessment** (if updating): A brief summary of what was found and what's changing
2. **The README.md file**: Written to the project root, ready to commit
3. **Verification notes**: Any commands you couldn't verify, assumptions made, or suggestions for the user to confirm

Always write the README as a file (not just in chat) so the user can review and use it directly.

---

## Example Assessment Output

When reviewing an existing README, present findings like this:

```
## README Assessment

**Overall**: The README covers basics but has gaps that would frustrate a new contributor.

### ✅ What's Good
- Clear project description
- License section present

### ⚠️ Issues Found
- Install instructions reference `yarn` but the lock file is `pnpm-lock.yaml`
- Missing: environment variable documentation (project uses 8 env vars)
- `npm run test` is listed but the actual script is `npm run test:unit`
- No quick-start section — takes 4 scrolls to find how to run locally

### 📋 Sections to Add
- Quick Start
- Configuration / Environment Variables
- Project Structure (15+ directories with no map)

Shall I proceed with the rewrite?
```
