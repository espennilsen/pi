# pi-openrouter

OpenRouter provider extension for [pi](https://github.com/badlogic/pi-mono). Adds OAuth PKCE authentication and dynamic model discovery from OpenRouter's full model catalog.

## Setup

Load the extension:

```bash
pi -e extensions/pi-openrouter
```

Or add to your pi config for persistent loading.

## Authentication

### Option 1: OAuth PKCE (recommended)

```
/login openrouter
```

Opens your browser for one-click authentication. The API key is stored permanently in `~/.pi/agent/auth.json`.

### Option 2: Environment variable

```bash
export OPENROUTER_API_KEY=sk-or-...
```

## Usage

After authentication, OpenRouter models appear in `/model`. The extension fetches the latest model catalog from the API on each session start.

### Commands

| Command | Description |
|---------|-------------|
| `/openrouter` | Show status, registered models count, active patterns |
| `/openrouter models [search]` | List registered models, optionally filter by search term |
| `/openrouter refresh` | Fetch latest models from OpenRouter API |

## Model Filtering

By default, **all 338+ OpenRouter models** are registered. To filter, override in `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (per-project):

```json
{
  "pi-openrouter": {
    "models": [
      "anthropic/*",
      "openai/gpt-5*",
      "google/gemini-*",
      "deepseek/*",
      "meta-llama/llama-4*"
    ]
  }
}
```

After changing settings, run `/openrouter refresh` or restart the session.

## How It Works

1. **Init** — Loads cached model list from disk, filters by settings, registers provider with OAuth
2. **Session start** — Fetches fresh model catalog from OpenRouter API, updates cache, re-registers
3. **`/openrouter refresh`** — Manual refresh for immediate updates

The model cache is stored at `~/.pi/agent/cache/openrouter-models.json`.
