# chat (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws chat <resource> <method> [flags]
```

## Helper Commands

| Command | Description |
|---------|-------------|
| `+send` | Send a message to a space — see [gws-chat-send.md](gws-chat-send.md) |

## API Resources

### customEmojis
- `create`, `delete`, `get`, `list` — Custom emoji management.

### media
- `download` — Downloads media.
- `upload` — Uploads an attachment.

### spaces
- `completeImport`, `create`, `delete`, `findDirectMessage`, `get`, `list`, `patch`, `search`, `setup` — Space management.
- `members` — Space member operations.
- `messages` — Space message operations.
- `spaceEvents` — Space event operations.

### users
- `spaces` — User space operations.

## Discovering Commands

```bash
gws chat --help
gws schema chat.<resource>.<method>
```
