# pi-authentik

`pi-authentik` signs Pi into authentik with OIDC Authorization Code + PKCE, stores session tokens with `pi-secret`, and registers an OpenAI-compatible provider backed by your authenticated LLM endpoint.

## What it does

- Opens authentik in the browser and completes login through a local loopback redirect on `127.0.0.1`
- Uses a public OIDC client with PKCE, so there is no client secret to store in Pi
- Stores the session in `pi-secret` only; there is no plaintext token fallback in this extension
- Validates that the configured LLM base URL is an OpenAI-compatible base URL ending in `/v1`
- Discovers models from `GET <base-url>/models`
- Registers the `authentik` provider and can refresh models on demand

## Requirements

- Pi with this extension enabled
- `pi-secret` available for token storage
- An authentik OIDC provider configured for a loopback redirect
- An OpenAI-compatible API base URL that ends with `/v1`

## Setup

1. Configure authentik. See [AUTHENTIK_SETUP.md](./AUTHENTIK_SETUP.md).
2. Confirm your LLM endpoint format. See [LLM_ENDPOINT_SETUP.md](./LLM_ENDPOINT_SETUP.md).
3. Configure `pi-authentik` in Pi settings or run `/authentik-setup`.
4. Start Pi and run `/authentik-login`.

### Settings-based configuration

`pi-authentik` reads Pi settings, not environment variables.

Global settings example:

```json
{
  "pi-authentik": {
    "authentikHost": "https://auth.example",
    "providerSlug": "pi",
    "clientId": "pi-client",
    "scopes": ["openid", "profile", "email"],
    "enableOfflineAccess": true,
    "llmBaseUrl": "https://llm.example/openai/v1",
    "modelFilters": ["gpt-*", "o3-*"]
  }
}
```

If `enableOfflineAccess` is `true`, the extension adds `offline_access` to the requested scopes and can restore the session with the refresh token on startup.

## Commands

- `/authentik-setup` — interactive first-run setup
- `/authentik-login` — sign in and register the provider
- `/authentik-logout` — clear the stored session and optionally open the authentik logout URL
- `/authentik-status` — show config, endpoint, session, and model status
- `/authentik-endpoint <url>` — set the OpenAI-compatible base URL
- `/authentik-refresh-models` — fetch `/models` again and re-register the provider

## Configuration

Configure under the `pi-authentik` key in Pi settings.

Important values:

- `authentikHost` — base authentik URL, for example `https://auth.example`
- `providerSlug` — provider slug used to derive discovery from `/application/o/<slug>/.well-known/openid-configuration`
- `clientId` — public OIDC client ID
- `scopes` — defaults to `openid profile email`
- `enableOfflineAccess` — when `true`, requests `offline_access`
- `llmBaseUrl` — must be an OpenAI-compatible base URL ending in `/v1`
- `modelFilters` — optional model filters; defaults to `*`
- `discoveryUrl` — optional explicit discovery URL override
- `logoutUrl` — optional explicit logout URL override

A commented example is in [`.env.example`](./.env.example), but it exists only as a migration note; the extension does not read env vars.

## Examples

### Example loopback login flow

1. Run `/authentik-login`
2. Pi starts a local callback server on `127.0.0.1` with a random port
3. Your browser opens authentik
4. Authentik redirects back to `http://127.0.0.1:<port>/callback`
5. Pi exchanges the code, stores tokens in `pi-secret`, fetches `/models`, and registers the provider

### Example endpoint values

- `https://llm.example/v1`
- `https://llm.example/openai/v1`

## Troubleshooting

### "Run /authentik-setup before logging in"

Missing one or more of `authentikHost`, `providerSlug`, or `clientId` in Pi settings.

### "Configure the OpenAI-compatible endpoint before logging in"

Set `llmBaseUrl` in settings or run `/authentik-endpoint <url>`. The value must end with `/v1`.

### Login succeeds but Pi does not restore the session later

Enable `enableOfflineAccess: true` so `offline_access` is requested and a refresh token can be stored.

### Endpoint validation fails

Use the API base URL, not the site root, and make sure it ends in `/v1`.

### No models appear

Check that `GET <llmBaseUrl>/models` works with the same bearer token and that `modelFilters` is not filtering everything unexpectedly.
