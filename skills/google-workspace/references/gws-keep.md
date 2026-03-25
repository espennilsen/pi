# keep (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws keep <resource> <method> [flags]
```

## API Resources

### media
- `download` — Gets an attachment. Use `alt=media` query parameter.

### notes
- `create` — Creates a new note.
- `delete` — Deletes a note. Caller must have OWNER role.
- `get` — Gets a note.
- `list` — Lists notes with pagination.
- `permissions` — Note permission operations.

## Discovering Commands

```bash
gws keep --help
gws schema keep.<resource>.<method>
```
