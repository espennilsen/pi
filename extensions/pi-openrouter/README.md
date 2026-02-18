# @e9n/pi-openrouter

OpenRouter provider for [pi](https://github.com/espennilsen/pi) — access 338+ models via a unified API with OAuth PKCE authentication.

## Features

- OAuth PKCE authentication via `/login openrouter-oauth`
- Dynamic model discovery from OpenRouter API
- Local model caching for offline use
- Glob-pattern filtering to customize which models appear

## Authentication

### OAuth (recommended)

```
/login openrouter-oauth
```

Opens your browser for one-click authentication. The API key is stored permanently in `~/.pi/agent/auth.json`.

> Note: The key will appear in your OpenRouter API keys list as "OAuth: $YOUR_SITE_NAME" (derived from your callback URL).

### API key (manual)

If you have an OpenRouter API key, add it to `~/.pi/agent/auth.json`:

```json
{
  "openrouter-oauth": {
    "access": "sk-or-..."
  }
}
```

## Model Filtering

By default, all 338+ OpenRouter models are registered. To filter, add to `~/.pi/agent/settings.json`:

```json
{
  "pi-openrouter": {
    "models": ["anthropic/*", "openai/gpt-5*", "google/gemini-*"]
  }
}
```

Patterns use glob syntax (`*` matches any characters).

## Commands

| Command | Description |
|---------|-------------|
| `/openrouter` | Show status and model count |
| `/openrouter refresh` | Fetch latest models from API |

## Install

```bash
pi install npm:@e9n/pi-openrouter
```

## License

MIT
