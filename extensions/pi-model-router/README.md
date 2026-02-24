# @e9n/pi-model-router

Automatic model routing for [pi](https://github.com/espennilsen/pi) — classifies prompts by complexity and selects the optimal model before each LLM call.

## Why

Pi subprocesses (cron jobs, heartbeat, subagents) use whatever model is set globally. A health check ping doesn't need Opus. A blog post doesn't belong on Haiku. This extension makes model selection automatic.

## How It Works

1. Loads as an extension inside any pi subprocess (or TUI session)
2. Intercepts prompts via the `before_agent_start` hook
3. Classifies task complexity using a cheap model from pi's model registry
4. Switches the active model and thinking level before the first LLM call

**Resolution chain** (first match wins):

```
Static override → Cache hit → LLM classifier → Default tier
```

**Zero changes to other extensions.** Just add `pi-model-router` to their extension lists.

Uses pi's built-in model registry for everything — same API keys, same providers, same auth. No duplicate configuration.

## Install

```bash
pi install npm:@e9n/pi-model-router
```

## Configuration

Add to your settings.json:

```json
{
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
}
```

### Classifier

The classifier calls a cheap/fast model to determine prompt complexity. Use any model already configured in pi:

| Model | Cost per call | Latency |
|-------|--------------|---------|
| `claude-haiku-4-5` | ~$0.0001 | ~0.5s |
| `minimax/MiniMax-M1` | ~$0.0001 | ~1s |
| `gemini-2.0-flash` | ~$0.00005 | ~0.5s |
| `groq/llama-3.3-70b` | free tier | ~0.3s |

The model is resolved via pi's model registry — same API keys and providers you already have configured. Supports OpenAI-compatible, Anthropic, and Google API formats automatically.

### Tiers

Map complexity tiers to models and thinking levels:

```json
"tiers": {
  "simple":  { "model": "claude-haiku-4-5",  "thinking": "off" },
  "medium":  { "model": "claude-sonnet-4-5",  "thinking": "low" },
  "complex": { "model": "claude-opus-4-6",    "thinking": "high" }
}
```

### Static Overrides

Skip the classifier for known patterns. Each entry is a regex matched against the prompt:

```json
"overrides": [
  { "match": "blog|draft|write.*post", "tier": "complex" },
  { "match": "status|health|check",    "tier": "simple" }
]
```

### Interactive Mode

Controls behavior in TUI sessions:

| Mode | Behavior |
|------|----------|
| `"off"` | Don't touch the model in TUI (default) |
| `"suggest"` | Show a notification if a different model might be better |
| `"auto"` | Full auto-switch (same as subprocess mode) |

Subprocess mode (`pi -p`) is always `"auto"`.

## Integration

### With pi-cron

```json
"pi-cron": {
  "extensions": ["pi-model-router"]
}
```

All cron jobs automatically get the right model. A daily blog post routes to Opus. A health check routes to Haiku.

### With pi-heartbeat

```json
"pi-heartbeat": {
  "extensions": ["pi-model-router", ...]
}
```

### With pi-subagent

Include when spawning subagents:

```json
{ "agent": "worker", "task": "...", "extensions": ["pi-model-router"] }
```

## Cache

Classifications are cached in memory to avoid repeated classifier calls for identical prompts.

- **Key**: SHA-256 hash of first 500 characters (normalized whitespace)
- **TTL**: 7 days (configurable)
- **Eviction**: LRU when `maxEntries` exceeded

## Commands

| Command | Description |
|---------|-------------|
| `/model-router` | Toggle routing on/off |
| `/model-router on` | Enable routing |
| `/model-router off` | Disable routing |
| `/model-router status` | Show current state, mode, tiers, cache size |
| `/model-router suggest` | Switch to suggest mode (notify only) |
| `/model-router auto` | Switch to auto mode (full model switch) |

## Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `model-router:routed` | Emitted | After model switch — includes `tier`, `source`, `model`, `thinking`, `switched`, `latencyMs`, `cached` |
| `model-router:suggested` | Emitted | In suggest mode — includes `tier`, `source`, `model`, `thinking`, `latencyMs` |

## License

MIT
