# docs (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws docs <resource> <method> [flags]
```

## Helper Commands

| Command | Description |
|---------|-------------|
| `+write` | Append text to a document — see [gws-docs-write.md](gws-docs-write.md) |

## API Resources

### documents
- `batchUpdate` — Applies one or more updates to the document.
- `create` — Creates a blank document using the title given.
- `get` — Gets the latest version of the specified document.

## Discovering Commands

```bash
gws docs --help
gws schema docs.<resource>.<method>
```
