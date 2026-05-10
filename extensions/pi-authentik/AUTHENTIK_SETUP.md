# Authentik setup

This extension uses authentik through OIDC Authorization Code + PKCE with a loopback redirect. Pi acts as a public client, so you configure a client ID but do **not** put a client secret into the extension.

## Required settings

Configure these values under the `pi-authentik` key in Pi settings:

- `authentikHost` — for example `https://auth.example`
- `providerSlug` — the provider/application slug Pi uses for discovery
- `clientId` — the public client ID issued by authentik

By default Pi derives discovery from:

```text
https://<authentik-host>/application/o/<provider-slug>/.well-known/openid-configuration
```

If needed, you can override that with `discoveryUrl`.

## Create or update the provider

Configure the authentik provider/application as a standard OIDC public client:

- Flow: Authorization Code
- PKCE: enabled, `S256`
- Client type: public
- Redirect URIs: allow loopback redirect URLs

## Loopback redirect URI setup

Pi starts a temporary local callback server bound to `127.0.0.1` on a random port and uses `/callback` as the path.

Allow loopback redirect URIs that match this shape:

```text
http://127.0.0.1:<random-port>/callback
```

If Authentik’s provider UI lets you configure **one regular expression** instead of enumerating URIs, use this pattern (matches Pi’s callback exactly: `127.0.0.1`, any port, path `/callback`):

```regexp
^http://127\.0\.0\.1:\d+/callback$
```

That is anchored: scheme `http`, host `127.0.0.1` only (not `localhost` or `[::1]`), **one or more digits** for the port, path **`/callback`** with no trailing slash.

Important notes:


- The port is chosen dynamically
- The callback server shuts down immediately after the callback is handled

## Scopes

Default scopes requested by Pi:

- `openid`
- `profile`
- `email`

Optional scope:

- `offline_access` — enable this when you want Pi to store a refresh token and restore the session automatically on startup

Set `enableOfflineAccess: true` in Pi settings if you want the extension to append `offline_access` automatically.

## Logout

If discovery returns `end_session_endpoint`, Pi uses it during `/authentik-logout` with `id_token_hint`.

If your deployment needs a fixed logout URL, set `logoutUrl` in Pi settings.

## Pi setup and run

After authentik is configured:

1. Add the `pi-authentik` config to Pi settings or run `/authentik-setup`
2. Start Pi
3. Run `/authentik-login`
4. Complete login in the browser
5. Pi stores the session in `pi-secret` and registers the provider

## Troubleshooting

### Redirect mismatch

Make sure Authentik accepts callbacks that match `http://127.0.0.1:<random-port>/callback` (see the anchored regex above if your provider only accepts patterns).

### Missing refresh token

Enable `offline_access` in authentik and set `enableOfflineAccess: true` in Pi settings.

### Discovery fetch fails

Check `authentikHost`, `providerSlug`, and any reverse-proxy path prefixes. If necessary, set `discoveryUrl` explicitly.
