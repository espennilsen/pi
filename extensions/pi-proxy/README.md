# pi-proxy

Route all LLM API calls through a configurable proxy server.

When enabled, requests to Anthropic, OpenAI, Google, xAI, OpenRouter, Groq, and Mistral are redirected through your proxy instead of going directly to provider APIs.

## Setup

Add to your **global** `~/.pi/agent/settings.json`:

```json
{
  "pi-proxy": {
    "baseUrl": "https://proxy.example.com"
  }
}
```

That's it. All provider requests will now route through `https://proxy.example.com/{provider}`:

| Provider | Proxied URL |
|----------|-------------|
| Anthropic | `https://proxy.example.com/anthropic` |
| OpenAI | `https://proxy.example.com/openai` |
| Google | `https://proxy.example.com/google` |
| xAI | `https://proxy.example.com/xai` |
| OpenRouter | `https://proxy.example.com/openrouter` |
| Groq | `https://proxy.example.com/groq` |
| Mistral | `https://proxy.example.com/mistral` |

If `baseUrl` is not set or empty, the extension does nothing — requests go directly to providers as usual.

## Custom Headers

Add headers to all proxied requests (global settings only):

```json
{
  "pi-proxy": {
    "baseUrl": "https://proxy.example.com",
    "headers": {
      "X-Proxy-Auth": "MY_PROXY_TOKEN"
    }
  }
}
```

Header values can be environment variable names (resolved at request time by pi) or literal strings.

## Per-Provider Overrides

Customize the path for specific providers, or disable proxying for a provider. This works in both global and project settings:

```json
{
  "pi-proxy": {
    "providers": {
      "anthropic": "/v1/anthropic",
      "google": false
    }
  }
}
```

- **String** — custom path suffix (e.g. `"/v1/anthropic"` → `https://proxy.example.com/v1/anthropic`)
- **`false`** — skip proxying for that provider (requests go directly to the provider API)

## Security

- **`baseUrl` and `headers` are global-only** — project-level `.pi/settings.json` cannot override them, preventing a malicious repo from redirecting LLM traffic
- **HTTPS required** — `baseUrl` must use `https://`. `http://` is only allowed for `localhost` / `127.0.0.1` (local dev proxies)
- Project settings can only configure `providers` (path overrides and exclusions)
