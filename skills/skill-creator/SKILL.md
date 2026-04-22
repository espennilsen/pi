---
name: skill-creator
description: >
  Create, review, and improve skills for Pi agents. A skill is a folder with a
  SKILL.md that teaches an agent specialized workflows, domain knowledge, or
  tool integrations. Use when asked to create a new skill, improve an existing
  skill, review a skill for quality, scaffold a skill from a workflow, or
  convert documentation into a skill. Also triggers on "make a skill for",
  "build a skill", "skill for [topic]", "teach the agent to", or "package this
  workflow as a skill".
---

# Skill Creator

Create effective, well-structured skills for Pi agents. This skill covers the
full lifecycle: planning, scaffolding, writing, validating, and iterating.

Pi implements the [Agent Skills standard](https://agentskills.io/specification).
Skills work across Pi, Claude Code, and the Anthropic API.

## What Is a Skill?

A skill is a folder that teaches an agent how to handle specific tasks:

```
skill-name/
├── SKILL.md           # Required — frontmatter + instructions
├── scripts/           # Optional — executable code (deterministic operations)
├── references/        # Optional — documentation loaded on-demand
└── assets/            # Optional — templates, fonts, icons used in output
```

**Skills are NOT code.** They are structured instructions — like an onboarding
guide for a new team member who happens to be an AI.

## Skill Creation Process

### Step 1: Understand the Use Case

Before writing anything, answer these questions:

1. **What does the user want to accomplish?** (concrete outcome)
2. **What would they say to trigger it?** (natural language phrases)
3. **What steps are involved?** (the workflow)
4. **What does the agent need that it doesn't already know?** (domain knowledge, scripts, reference docs)
5. **What tools does the agent need?** (bash, web_fetch, extensions, MCP)

Ask 2-3 clarifying questions if the use case isn't clear. Get concrete examples
of how the skill would be used before proceeding.

### Step 2: Plan the Skill Contents

For each step in the workflow, decide what belongs where:

| Content type | Where it goes | When to use |
|---|---|---|
| Workflow steps, decisions, guidance | SKILL.md body | Core instructions the agent follows |
| Executable code that's reused | `scripts/` | Deterministic operations, data processing, validation |
| Detailed docs, API refs, schemas | `references/` | Loaded only when the agent needs them |
| Templates, images, boilerplate | `assets/` | Files used in output, not loaded into context |

**Key principle:** Only include what the agent doesn't already know. Claude is
already smart — don't explain how to write Python or use git. Add the domain
knowledge, specific workflows, and tribal knowledge that make this task unique.

### Step 3: Scaffold the Skill

Run the init script to create the directory structure:

```bash
bash scripts/init-skill.sh <skill-name> [target-directory]
```

Default target: current working directory. The script creates the folder with
SKILL.md template and optional subdirectories.

### Step 4: Write the SKILL.md

See [references/writing-guide.md](references/writing-guide.md) for the full
writing guide. Key points:

#### Frontmatter (Level 1 — always in context)

```yaml
---
name: kebab-case-name
description: >
  What it does + when to use it + specific trigger phrases.
  Max 1024 chars. This is the ONLY thing loaded by default.
---
```

The description is the most important part — it determines whether the skill
activates. Include:
- What the skill does (1 sentence)
- When to use it (specific scenarios)
- Trigger phrases users would actually say

**Rules:**
- `name`: kebab-case, lowercase, max 64 chars, must match folder name
- `description`: required, max 1024 chars, no XML angle brackets
- No `claude` or `anthropic` in the name (reserved)

#### Body (Level 2 — loaded when skill activates)

Keep SKILL.md body **under 500 lines / ~5000 words**. This goes into the
agent's context window alongside conversation history, other skills, and
system prompt.

Structure options (pick the best fit):

| Pattern | Best for | Example |
|---|---|---|
| **Workflow** | Sequential processes | Steps 1→2→3 with validation gates |
| **Task-based** | Tool collections | "Merge PDFs" / "Split PDFs" / "Extract text" |
| **Reference** | Standards, guidelines | Brand guide with colors / typography / voice |
| **Capabilities** | Feature sets | Numbered list of related features |

**Writing rules:**
- Use imperative form ("Run the script", not "You should run the script")
- Be specific and actionable (file paths, commands, parameters)
- Include error handling for common failures
- Provide concrete examples over abstract explanations
- Reference bundled files with relative paths: `scripts/validate.sh`, `references/api.md`

#### Bundled Resources (Level 3 — loaded on demand)

```markdown
## Advanced Configuration

For database schema details, see [references/schema.md](references/schema.md).
For deployment patterns by provider, see:
- [references/aws.md](references/aws.md)
- [references/gcp.md](references/gcp.md)
```

The agent reads these files only when it needs them. This is progressive
disclosure — keep SKILL.md lean, push detail into reference files.

**Guidelines:**
- Keep references one level deep from SKILL.md (no deeply nested links)
- For files over 100 lines, add a table of contents at the top
- Scripts can be executed without reading into context (token efficient)
- Assets are used in output, not loaded into context

### Step 5: Validate

Run the validation script:

```bash
python3 scripts/validate.py <path/to/skill-folder>
```

Checks: frontmatter format, naming conventions, description quality, file
structure, broken references, line count.

### Step 6: Iterate

Skills are living documents. After real usage:

1. Note where the agent struggles or goes off-track
2. Tighten instructions for problem areas
3. Add error handling for new edge cases
4. Move content between SKILL.md and references as needed
5. Re-validate after changes

## Review Mode

When asked to review an existing skill, evaluate against this checklist:

### Triggering
- [ ] Description includes what + when + trigger phrases
- [ ] Tested: would the agent load this for the right queries?
- [ ] Tested: would it NOT load for unrelated queries?

### Structure
- [ ] SKILL.md exists with valid frontmatter
- [ ] Name is kebab-case, matches folder name
- [ ] Body under 500 lines
- [ ] Progressive disclosure used (references for detail)
- [ ] No README.md or extraneous docs in the skill folder

### Content Quality
- [ ] Only includes knowledge the agent doesn't already have
- [ ] Instructions are specific and actionable
- [ ] Error handling for common failures
- [ ] Concrete examples provided
- [ ] Scripts tested and working

### Pi-Specific
- [ ] Relative paths use skill directory as root
- [ ] Compatible with Pi's skill loading (`--skill` or discovery)
- [ ] Works alongside other skills (composable)

Report findings as: 🔴 Critical | 🟡 Important | 🔵 Minor | ✅ Good

## Common Mistakes

| Mistake | Fix |
|---|---|
| Description too vague ("Helps with projects") | Add specific triggers and capabilities |
| Everything in SKILL.md (2000+ lines) | Move detail to `references/`, keep body lean |
| Explaining things the agent already knows | Remove — only add novel domain knowledge |
| No trigger phrases in description | Add "Use when..." with natural language examples |
| Inline scripts in SKILL.md | Move to `scripts/`, reference with relative path |
| Magic values without explanation | Document all constants, paths, credentials |
| Missing error handling | Add "If X fails..." for each critical step |
| `README.md` in the skill folder | Delete — all docs go in SKILL.md or references |

## Pi Skill Locations

Skills are discovered from these locations (first match wins on name collision):

- **Global:** `~/.pi/agent/skills/`, `~/.agents/skills/`
- **Project:** `.pi/skills/`, `.agents/skills/` (cwd + ancestors to git root)
- **Settings:** `skills` array in settings.json
- **CLI:** `--skill <path>` (always loads, even with `--no-skills`)
- **Packages:** `skills/` dirs or `pi.skills` in package.json

Skills register as `/skill:name` commands in interactive mode.
