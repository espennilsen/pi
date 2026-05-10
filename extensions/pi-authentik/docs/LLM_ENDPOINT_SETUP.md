# LLM endpoint setup

`pi-authentik` expects an OpenAI-compatible API base URL. The configured base URL is used directly for provider registration and model discovery.

## Base URL requirements

Set `llmBaseUrl` under the `pi-authentik` key in Pi settings.

It:

- must be an absolute `http` or `https` URL
- must not contain a query string or fragment
- must end with `/v1`

Valid examples:

- `https://llm.example/v1`
- `https://llm.example/openai/v1`

Accepted and normalized examples:

- `https://llm.example/v1/` — normalized to `https://llm.example/v1`

Invalid examples:

- `https://llm.example` — missing `/v1`
- `https://llm.example/openai` — missing `/v1`
- `https://llm.example/v1?foo=bar` — query strings are rejected

## What Pi calls

The extension verifies connectivity by calling:

```text
GET <llmBaseUrl>/models
```

After login, it uses the access token as:

```http
Authorization: Bearer <access-token>
```

## Setup and run

1. Choose the API base URL, not a human-facing web app URL
2. Make sure the API is OpenAI-compatible
3. Set `llmBaseUrl` in Pi settings or run `/authentik-endpoint <url>`
4. Run `/authentik-refresh-models` to refresh model discovery if needed

Settings example:

```json
{
  "pi-authentik": {
    "llmBaseUrl": "https://llm.example/openai/v1",
    "modelFilters": ["gpt-*", "o3-*"]
  }
}
```

## Model filtering

Use `modelFilters` in Pi settings to filter discovered models.

Examples:

- `"modelFilters": ["*"]`
- `"modelFilters": ["gpt-*"]`
- `"modelFilters": ["gpt-*", "o3-*"]`

If filters match nothing, the current implementation falls back to returning all discovered models.

## Troubleshooting

### "LLM base URL must end with /v1"

Use the API base URL and include `/v1`, for example `https://llm.example/openai/v1`.

### Connectivity test fails

Check that `GET <llmBaseUrl>/models` works from the Pi machine and that the API accepts the bearer token issued after authentik login.

### Models endpoint works outside Pi but not in Pi

Verify that the API expects the same OpenAI-compatible authorization header and that any reverse-proxy path preserves the `/v1` prefix.
