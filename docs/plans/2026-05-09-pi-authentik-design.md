# pi-authentik Design

## Goal
Build a production-ready `pi-authentik` extension for Pi Coding Agent that authenticates desktop users against authentik with OIDC Authorization Code + PKCE, stores tokens securely via `pi-secret`, prompts for an OpenAI-compatible LLM base URL ending in `/v1`, validates connectivity, and registers a dynamic Pi model provider using the authentik bearer token against the protected LLM endpoint.

## Scope
- Flat extension layout under `extensions/pi-authentik/` (no nested `src/` directory)
- First-run interactive setup command only (`/authentik-setup`)
- Commands for sign-in, sign-out, configure/retest endpoint, and session status
- OIDC discovery, loopback callback on `127.0.0.1`, PKCE S256, state + nonce validation, JWKS-based ID token verification
- Optional refresh token support when `offline_access` is enabled and a refresh token is returned
- Dynamic model discovery from `{LLM_BASE_URL}/models`
- Optional model glob filtering; if filters are absent or match nothing, register all discovered models
- Reusable OpenAI-compatible client with pluggable auth strategy

## Non-goals for v1
- Embedded webview auth
- Client secret support
- Browser-based settings UI
- Hardcoded deployment values or single-tenant assumptions
- Trusting unverified JWT claims

## Architecture
`pi-authentik` owns both authentication and provider registration. Startup loads settings and env overrides, restores any stored token session, attempts refresh if needed, validates the configured LLM base URL, fetches models from the protected endpoint, applies optional filters, and registers a Pi provider using `authHeader: true`.

Modules will live at the extension root:
- `index.ts` — extension entry, lifecycle, commands, provider registration
- `types.ts` — shared types for config, discovery, tokens, session, models
- `settings.ts` — merge env vars + Pi settings, canonicalize values, expose defaults
- `settings-store.ts` — persist non-secret config back to Pi global settings
- `auth-config.ts` — derive discovery/logout URLs from host + provider slug
- `pkce.ts` — verifier/challenge/state/nonce generation
- `discovery.ts` — fetch and validate OIDC metadata + JWKS URL
- `callback-server.ts` — temporary `127.0.0.1` loopback HTTP server on random port
- `jwt.ts` — verify ID tokens with `jose` against JWKS, issuer, audience, expiry, nonce
- `token-store.ts` — secure token persistence through `globalThis.__piSecret`
- `auth-client.ts` — login, code exchange, refresh, session assembly
- `logout.ts` — local token removal + provider logout URL generation
- `endpoint-validator.ts` — LLM base URL normalization/validation and `/models` connectivity test
- `llm-client.ts` — OpenAI-compatible client for `/models`, `/chat/completions`, optional `/responses`
- `models.ts` — map OpenAI-compatible model payloads into Pi provider model configs + filtering
- `first-run.ts` — interactive setup flow and helpful prompts/errors
- `logger.ts` — redacted extension logging helpers

## Config Model
Normal settings plus env overrides:
- `AUTHENTIK_HOST`
- `AUTHENTIK_PROVIDER_SLUG`
- `AUTHENTIK_CLIENT_ID`
- `AUTHENTIK_SCOPES`
- `AUTHENTIK_DISCOVERY_URL`
- `AUTHENTIK_LOGOUT_URL`
- `LLM_BASE_URL`
- `AUTH_STORAGE_BACKEND`
- `PI_AUTHENTIK_MODELS` (optional glob filters array/string in settings)

Validation rules:
- `LLM_BASE_URL` must be absolute `http:` or `https:`
- must end in `/v1` after normalization
- canonical storage drops trailing slash after `/v1`
- if missing `/v1`, setup offers auto-fix
- discovery URL derived from `{host}/application/o/{slug}/.well-known/openid-configuration` unless explicitly configured
- scopes default to `openid profile email`; `offline_access` appended only when explicitly enabled

## Auth Flow
1. User runs `/authentik-setup` or `/authentik-login`.
2. Extension loads config and discovery metadata.
3. Loopback callback server binds to `127.0.0.1:0` and returns a callback URL.
4. PKCE verifier/challenge, state, and nonce are generated.
5. Default browser opens the authorization URL.
6. Callback server receives `code` and `state`; mismatches fail closed.
7. Extension exchanges code for tokens at discovered token endpoint.
8. `id_token` is verified with `jose` + remote JWKS; `iss`, `aud`, `exp`, and `nonce` are enforced.
9. Access token, optional refresh token, expiry, and user claims are stored via `pi-secret`.
10. Provider models are refreshed from the configured LLM endpoint using `Authorization: Bearer <access_token>`.

## Provider + Model Discovery
The registered provider will point to the configured `LLM_BASE_URL` and declare `api: "openai-completions"`. Model discovery calls `GET {LLM_BASE_URL}/models` through `llm-client.ts`. Returned models are mapped into Pi provider model configs using reasonable defaults when an OpenAI-compatible endpoint omits cost/context metadata.

Filtering behaves like `pi-openrouter`:
- configurable glob patterns
- if no patterns are configured, include all models
- if patterns are configured but match nothing, fall back to all models instead of exposing zero models

## UX
Commands:
- `/authentik-setup`
- `/authentik-login`
- `/authentik-logout`
- `/authentik-status`
- `/authentik-endpoint` (show/edit/retest current LLM endpoint)
- optional `/authentik-refresh-models`

Status behavior:
- unauthenticated: “Sign in with authentik” guidance via command help/status
- missing LLM URL: prompt to run setup/configure endpoint
- authenticated: show current user identity, token expiry, endpoint, and model count

Setup flow prompts for:
- authentik host
- provider slug
- client ID
- scopes (default `openid profile email`)
- whether to enable refresh tokens (`offline_access`)
- LLM base URL including `/v1`

## Security
- Native app public client only; no client secret ever stored or embedded
- Browser auth only; no embedded webview
- Tokens, auth codes, refresh tokens, and PKCE verifier redacted from logs
- No plaintext token storage except explicit insecure dev mode if later added
- JWT claims used only after signature verification
- Callback server listens only on `127.0.0.1` and shuts down immediately after handling the callback

## Testing Strategy
Unit tests:
- PKCE generation shape
- callback parameter/state validation
- OIDC discovery URL derivation
- JWT verification claim checks with generated test keys
- token expiry/refresh decision logic
- LLM endpoint normalization and `/v1` validation
- model filter fallback behavior
- OpenAI-compatible response mapping

Integration-ish tests with stub HTTP servers:
- loopback callback server happy path and timeout/error path
- discovery + JWKS fetch against local stub
- `/models` connectivity test and canonical URL storage
- token-store behavior with mocked `pi-secret`

## Open Questions / implementation notes
- Need to confirm the exact provider auth callback shape expected by Pi’s `registerProvider(...oauth...)` API, since OIDC refresh must be driven through that interface or through a startup refresh path.
- Need to inspect whether Pi exposes settings write helpers; if not, `settings-store.ts` will update the global settings JSON directly and atomically.
- Need to verify whether Pi provider model configs require costs/context for all models or accept conservative defaults.
