---
name: pi-model-router
description: LLM-classified model routing for pi — shims into subprocesses (cron, heartbeat, subagent) and interactive sessions to select the optimal model based on task complexity
---

## Overview

Automatic model routing extension for pi. Classifies incoming prompts by complexity using a cheap/fast LLM and switches the active model before the first LLM call. Runs as a **shim** — loads inside subprocesses spawned by pi-cron, pi-heartbeat, and pi-subagent without requiring any changes to those extensions.

Uses pi's built-in model registry for auth, endpoint resolution, and model discovery. No separate API keys or configuration needed — just reference any model already configured in pi.

**Stack:** TypeScript · Node.js `fetch` · pi extension API (`before_agent_start`, `setModel`, `setThinkingLevel`, `modelRegistry`)

## Architecture

```
src/
├── index.ts        # Entry — hooks before_agent_start, orchestrates routing
├── classifier.ts   # LLM classifier — calls a model via pi's registry to determine tier
├── cache.ts        # In-memory classification cache with TTL and LRU eviction
├── rules.ts        # Static override matching (regex patterns on prompts)
├── resolver.ts     # Maps tier → Model object via modelRegistry
└── settings.ts     # Settings loader (global + project merge)
```

Logging uses pi-logger via `pi.events.emit("log", { channel: "pi-model-router", ... })` — no custom logger needed.

## How It Works

1. Extension loads inside a subprocess (or TUI session)
2. Hooks `before_agent_start` — receives the prompt before the first LLM call
3. **Resolution chain** (first match wins):
   a. Static override — regex match on prompt text
   b. Cache hit — prompt hash with TTL
   c. LLM classification — calls a cheap model via pi's model registry
4. Maps the resulting tier (`simple` | `medium` | `complex`) to a model + thinking level
5. Calls `pi.setModel()` and `pi.setThinkingLevel()` to switch before the LLM call

## Key Design Decisions

- **Shim pattern**: No changes to pi-cron, pi-heartbeat, or pi-subagent. The router is added to their extension lists in settings.json and runs inside the subprocess.
- **Leverages pi's model registry**: Classifier model is resolved via `ctx.modelRegistry` — same auth, same API keys, same provider config. No duplicate key management.
- **Provider-aware API calls**: Supports OpenAI-compatible (openai, minimax, groq, openrouter, xai, etc.), Anthropic Messages, and Google Generative AI formats based on `model.api`.
- **Mode-aware**: In interactive TUI (`ctx.hasUI`), behavior is configurable — `off` (default), `suggest` (notification only), or `auto` (full switch). Subprocess mode is always `auto`.
- **Cache-first**: Classifications are cached by prompt hash. Identical or near-identical prompts skip the classifier. TTL configurable (default: 7 days).
- **Graceful degradation**: If the classifier fails (network, API error, timeout, no API key), falls back to the `default` tier. Never blocks or errors the actual task.

## Settings

```json
"pi-model-router": {
  "classifier": {
    "model": "claude-haiku-4-5",
    "timeoutMs": 5000
  },
  "tiers": {
    "simple":  { "model": "claude-haiku-4-5",  "thinking": "off" },
    "medium":  { "model": "claude-sonnet-4-5",  "thinking": "low" },
    "complex": { "model": "claude-opus-4-6",    "thinking": "high" }
  },
  "overrides": [
    { "match": "blog|draft|write.*post",         "tier": "complex" },
    { "match": "status|health|check|ping|list",  "tier": "simple" }
  ],
  "cache": {
    "enabled": true,
    "ttlHours": 168,
    "maxEntries": 500
  },
  "default": "medium",
  "interactive": "off"
}
```

### Settings Reference

- `classifier.model` — Model pattern for classification (resolved via pi's model registry, e.g. `"claude-haiku-4-5"`, `"minimax/MiniMax-M1"`, `"gemini-2.0-flash"`)
- `classifier.timeoutMs` — Timeout for classifier calls (default: `5000`)
- `tiers` — Maps tier names to `{ model, thinking }` targets (model patterns resolved via registry)
- `overrides` — Array of `{ match: regex, tier: string }` for static prompt-based routing
- `cache.enabled` — Enable classification caching (default: `true`)
- `cache.ttlHours` — Cache entry TTL in hours (default: `168` = 7 days)
- `cache.maxEntries` — Max cache entries before LRU eviction (default: `500`)
- `default` — Fallback tier when classification fails (default: `"medium"`)
- `interactive` — TUI behavior: `"off"` (default), `"suggest"` (notify only), `"auto"` (full switch)

## Commands

- `/model-router` — toggle on/off
- `/model-router on|off` — explicit enable/disable
- `/model-router status` — show state, mode, tiers, cache size
- `/model-router suggest|auto` — switch interactive mode at runtime

## Events

- Emits: `model-router:routed` (after model switch — includes `tier`, `source`, `model`, `thinking`, `switched`, `latencyMs`, `cached`)
- Emits: `model-router:suggested` (in suggest mode — includes `tier`, `source`, `model`, `thinking`, `latencyMs`)
- Listens: `before_agent_start` (pi lifecycle event)

## Integration

### With pi-cron (zero code changes)

Add to the cron extension list in settings.json:

```json
"pi-cron": {
  "extensions": ["pi-model-router", ...]
}
```

### With pi-heartbeat (zero code changes)

Add to the heartbeat extension list in settings.json:

```json
"pi-heartbeat": {
  "extensions": ["pi-model-router", ...]
}
```

### With pi-subagent

Include in the extensions array when spawning subagents:

```json
{ "agent": "worker", "task": "...", "extensions": ["pi-model-router"] }
```

### In TUI

Install as a regular extension. Set `"interactive": "suggest"` for advisory notifications or `"off"` to disable in TUI.

## Classifier Prompt

The classification prompt is minimal (~100 tokens in, ~30 tokens out):

```
Classify this task's complexity. Return ONLY JSON: {"tier":"simple"|"medium"|"complex"}

simple = status checks, health pings, lookups, data retrieval, short answers
medium = analysis, code review, moderate coding, summarization, planning
complex = long-form writing, blog posts, multi-step reasoning, architecture, creative work

Task: {first 500 chars of prompt}
```

## Conventions

- Never block or error the parent task — if classification fails, use the default tier
- Cache key is a hash of the first 500 characters of the prompt (normalized whitespace)
- Classifier timeout is aggressive (5s default) — fail fast, fall back to default
- Log all routing decisions via extension logger for observability
- Model resolution uses `ctx.modelRegistry` with fuzzy matching on model ID/name
- API format is auto-detected from `model.api` — no manual provider configuration needed
