# gmail (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws gmail <resource> <method> [flags]
```

## Helper Commands

| Command | Description |
|---------|-------------|
| `+send` | Send an email — see [gws-gmail-send.md](gws-gmail-send.md) |
| `+triage` | Unread inbox summary — see [gws-gmail-triage.md](gws-gmail-triage.md) |
| `+reply` | Reply to a message — see [gws-gmail-reply.md](gws-gmail-reply.md) |
| `+reply-all` | Reply-all — see [gws-gmail-reply-all.md](gws-gmail-reply-all.md) |
| `+forward` | Forward a message — see [gws-gmail-forward.md](gws-gmail-forward.md) |
| `+watch` | Watch for new emails — see [gws-gmail-watch.md](gws-gmail-watch.md) |

## API Resources

### users
- `getProfile` — Gets the current user's Gmail profile.
- `stop` — Stop receiving push notifications.
- `watch` — Set up or update push notification watch.
- `drafts` — Operations on drafts.
- `history` — Operations on history.
- `labels` — Operations on labels.
- `messages` — Operations on messages.
- `settings` — Operations on settings.
- `threads` — Operations on threads.

## Discovering Commands

```bash
gws gmail --help
gws schema gmail.<resource>.<method>
```
