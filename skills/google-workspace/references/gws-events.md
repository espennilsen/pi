# events (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws events <resource> <method> [flags]
```

## Helper Commands

| Command | Description |
|---------|-------------|
| `+subscribe` | Subscribe to events — see [gws-events-subscribe.md](gws-events-subscribe.md) |
| `+renew` | Renew subscriptions — see [gws-events-renew.md](gws-events-renew.md) |

## API Resources

### subscriptions
- `create` — Creates a Google Workspace subscription.
- `delete` — Deletes a subscription.
- `get` — Gets subscription details.
- `list` — Lists subscriptions.
- `patch` — Updates or renews a subscription.
- `reactivate` — Reactivates a suspended subscription.

## Discovering Commands

```bash
gws events --help
gws schema events.<resource>.<method>
```
