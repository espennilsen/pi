---
name: node-docs
description: >
  Write and improve documentation for ComfyUI nodes in per-node JSON files.
  Use when asked to document nodes, write node descriptions, add tips to nodes,
  improve node docs, enrich node content, fill in empty node descriptions, or
  batch-write documentation for new/updated nodes. Also triggers on "write docs
  for nodes", "document the new nodes", "improve node tips", "fill in node
  descriptions", "enrich nodes", or "node content pass".
---

# Node Documentation Writer

Write original, beginner-friendly documentation for ComfyUI nodes. Each node
is stored as an individual JSON file. Use the embedded docs as a reference
source but always rewrite content — never copy-paste.

## File Structure

Node data is split into per-node JSON files organized by section and category:

```
src/data/nodes/
  _metadata.json                              — metadata + schema_version
  comfy_nodes/<category>/<NodeName>.json      — core ComfyUI nodes (476)
  partner_nodes/<category>/<NodeName>.json    — API/partner nodes (177)
  subgraph_blueprints/<category>/<Name>.json  — subgraph blueprints (36)
  extensions/<category>/<NodeName>.json       — extension nodes (1)
```

The top-level directories (`comfy_nodes`, `partner_nodes`, `subgraph_blueprints`,
`extensions`) match the tree pane sections. Below that, the category path matches
the node's `category` field with spaces replaced by hyphens.

### Key files

- **Per-node data:** `src/data/nodes/<section>/<category>/<NodeName>.json`
- **Metadata:** `src/data/nodes/_metadata.json`
- **Export data:** `exports/comfyui_nodes_2026-03-14_0-17-0.json` (structural source of truth)
- **Embedded docs:** `embedded-docs/comfyui_embedded_docs/docs/<NodeName>/en.md` (reference only)
- **Update plan:** `exports/NODE_UPDATE_PLAN.md` (progress tracking)

### Finding a node file

To locate a node's JSON file:
```bash
find src/data/nodes -name 'KSampler.json'
# → src/data/nodes/comfy_nodes/sampling/KSampler.json
```

To search across all nodes:
```bash
rg '"documentation_complete": false' src/data/nodes/ -l
```

## Content Fields to Write

For each node, write these fields:

| Field | What to write | Length |
|---|---|---|
| `description` | Technical but clear explanation of what the node does | 50–200 chars |
| `beginner_description` | Plain-language explanation for someone new to ComfyUI | 100–400 chars |
| `tips.general_tips` | Practical advice any user should know | 2–5 tips |
| `tips.beginner_tips` | "Start here" guidance with specific values and settings | 2–4 tips |
| `tips.advanced_tips` | Power-user techniques, edge cases, combo strategies | 1–4 tips (skip for simple nodes) |
| `use_cases` | Concrete scenarios with context | 2–4 use cases |
| `common_errors` | Real problems users hit, with actionable fixes | 1–4 errors |
| `complexity_level` | `"beginner"`, `"intermediate"`, or `"advanced"` | — |
| `documentation_complete` | Set `true` when all content fields are filled | — |

## Writing Standards

### Voice & Audience

- Write for people learning ComfyUI, not ML researchers
- Use active voice: "Connect to VAE Decode" not "Should be connected to"
- Explain WHY, not just WHAT: "Lower CFG (4–6) gives the model more creative
  freedom" not "CFG controls guidance strength"
- Use analogies for complex concepts: "Think of it like adjusting the contrast
  on a photo" not "Modifies the latent tensor distribution"

### description

One or two sentences. Technical but accessible. State what the node does and
its role in a workflow.

**Good:** "Loads a Stable Diffusion checkpoint file containing the model
weights, text encoder, and VAE needed for image generation."

**Bad:** "Checkpoint loader node." (too short, says nothing)
**Bad:** Copy-pasting the export's `description` field verbatim.

### beginner_description

Explain the node as if the reader has used ComfyUI for a week. Avoid jargon
or explain it inline. Say what it does in practical terms.

**Good:** "This node loads the AI model that generates your images. Think of
it as picking which artist you want to work with — different checkpoints
produce different styles, from photorealistic to anime to oil paintings."

**Bad:** "Loads checkpoint files for diffusion model inference." (jargon)
**Bad:** Repeating `description` with slightly different words.

### tips

Each tip must be **specific and actionable**. Include concrete values, settings,
node names, or workflows.

**Good tip:** "Start with euler sampler, 25 steps, CFG 7.5 — this works
reliably for most models and gives good results in about 10 seconds."

**Bad tip:** "Experiment with different settings to find what works best."
(vague, unhelpful)

**Good tip:** "For Flux models, set CFG to 1.0 and use the FluxGuidance node
instead — Flux uses guidance differently than SD 1.5 or SDXL."

**Bad tip:** "Different models may require different settings." (obvious)

### use_cases

Use an array of objects with `scenario` and `context`:

```json
[
  {
    "scenario": "Text-to-image generation",
    "context": "The most common workflow — connect Empty Latent Image as input with denoise 1.0 to generate from scratch"
  }
]
```

### common_errors

Use an array of objects with `symptom` and `solution`:

```json
[
  {
    "symptom": "Black or completely blank images",
    "solution": "CFG scale too high (>15). Lower to 7–9 range. Also check that model, VAE, and conditioning are all connected."
  }
]
```

## How to Use Embedded Docs

The embedded docs at `embedded-docs/comfyui_embedded_docs/docs/<NodeName>/en.md`
are a **reference source**, not a template.

1. Read the embedded doc to understand what the node does
2. Read the input/output tables to understand parameters
3. Note any tips, notes, or gotchas mentioned
4. **Write your own content** — informed by the doc but in your own words
5. Strip any "AI-generated" disclaimer lines

What to extract from embedded docs:
- Technical understanding of what the node does
- Parameter ranges, defaults, and constraints
- Specific tips or warnings the doc mentions
- How the node fits into workflows

What NOT to do:
- Copy the intro paragraph as `beginner_description`
- Copy input/output tables as tips
- Use the same phrasing or structure

## Workflow

### Batch documenting nodes

When asked to document a set of nodes (e.g. "document the new audio nodes"):

1. Find target nodes: `find src/data/nodes -name '*.json' -path '*audio*'`
2. Group nodes by category for context
3. For each node:
   a. Read the per-node JSON file
   b. Read the embedded doc if it exists: `embedded-docs/comfyui_embedded_docs/docs/<NodeName>/en.md`
   c. Read the export entry for structural context: check `exports/comfyui_nodes_*.json`
   d. Write all content fields
   e. Set `documentation_complete: true`
4. Write updated JSON back to the **same per-node file** (edit in place)
5. Update progress in `exports/NODE_UPDATE_PLAN.md` if relevant

### Improving existing nodes

When asked to improve node docs:

1. Identify nodes with weak content:
   - `documentation_complete: false`
   - Empty `beginner_description`
   - Generic tips like "Experiment with settings"
   - Empty `use_cases` or `common_errors`
   - `description` under 50 chars
2. Rewrite weak fields following the standards above
3. Keep existing good content — don't rewrite what's already well-written

### Quality check

To find nodes needing work:
```bash
# Incomplete nodes
rg '"documentation_complete": false' src/data/nodes/ -l | wc -l

# Nodes where beginner_description copies description
python3 -c "
import json, os
for root, dirs, files in os.walk('src/data/nodes'):
    for f in files:
        if not f.endswith('.json') or f == '_metadata.json': continue
        path = os.path.join(root, f)
        try:
            with open(path) as fh: d = json.load(fh)
        except json.JSONDecodeError:
            print(f'BAD_JSON: {path}')
            continue
        except UnicodeDecodeError:
            continue
        desc = d.get('description','')
        bdesc = d.get('beginner_description','')
        if desc and desc == bdesc:
            print(f'LAZY: {d.get(\"name\",f)}  ({path})')
"

# Nodes missing tips
python3 -c "
import json, os
for root, dirs, files in os.walk('src/data/nodes'):
    for f in files:
        if not f.endswith('.json') or f == '_metadata.json': continue
        path = os.path.join(root, f)
        try:
            with open(os.path.join(root, f)) as fh: d = json.load(fh)
        except json.JSONDecodeError:
            print(f'BAD_JSON: {path}')
            continue
        except UnicodeDecodeError:
            continue
        if not d.get('tips',{}).get('general_tips'):
            print(d.get('name', f))
"
```

## Category-Specific Guidance

### API nodes (`api node/...`) — found in `partner_nodes/`

- Always mention: requires API key, uses cloud processing, may have costs
- Note the provider and what type of media it handles
- Mention rate limits or size restrictions if the embedded doc says
- Don't write advanced_tips unless there's something genuinely advanced

### Dataset nodes (`dataset/...`)

- Explain how it fits into a training data pipeline
- Mention what formats it accepts/produces
- Note batch processing behavior

### Sampling nodes (`sampling/...`)

- Explain what the sampler/scheduler does in practical terms
- Give recommended starting values
- Note which models it works best with
- Compare to common alternatives (euler vs dpm++ etc.)

### Latent nodes (`latent/...`)

- Always mention: "Connect to VAE Decode to see the result as an image"
- Explain the latent space concept briefly for beginners
- Note resolution requirements if applicable

### Audio nodes (`audio/...`)

- Explain the audio format requirements
- Note sample rate / channel constraints
- Describe how it fits into audio workflows

## Subagent Usage

For large batches (50+ nodes), use parallel subagents grouped by category.
Each subagent gets a category batch and writes docs for all nodes in that group.
This keeps context focused and produces more consistent output within a category.

**Coordination:** The subagents should write their results to per-node JSON files
(different files per node, so no write conflicts) rather than editing a single shared
plan file. A single coordinator agent can update `exports/NODE_UPDATE_PLAN.md`
after all workers complete.
